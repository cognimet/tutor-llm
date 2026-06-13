<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Services\AiClient;
use App\Services\MindService;
use App\Services\ProgressService;
use App\Services\TokenMeter;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TutorController extends Controller
{
    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MindService $mindService,
        protected AiClient $ai,
        protected TokenMeter $meter,
    ) {}

    // List the student's chat sessions (most recent first).
    // Accepts an optional ?topic_id= query param to scope results to one topic.
    public function sessions(Request $request)
    {
        $sessions = $request->user()->chatSessions()
            ->when($request->filled('topic_id'), fn ($q) => $q->where('topic_id', $request->integer('topic_id')))
            ->withCount('messages')
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->get();

        return response()->json(['sessions' => $sessions]);
    }

    // Open a topic-scoped session, resuming the existing one when possible so we
    // don't orphan an empty session on every visit. Pass fresh=true to force a
    // brand-new chat for the topic.
    public function startSession(Request $request)
    {
        $data = $request->validate([
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['required', 'string', 'max:160'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'fresh'        => ['nullable', 'boolean'],
        ]);

        if (empty($data['fresh'])) {
            $existing = $request->user()->chatSessions()
                ->when(
                    ! empty($data['topic_id']),
                    fn ($q) => $q->where('topic_id', $data['topic_id']),
                    fn ($q) => $q->where('topic_name', $data['topic_name'])->whereNull('topic_id'),
                )
                ->orderByDesc('id')
                ->first();

            if ($existing) {
                return response()->json(['session' => $existing->load('messages')]);
            }
        }

        $session = $request->user()->chatSessions()->create([
            'topic_id'        => $data['topic_id'] ?? null,
            'title'           => $data['topic_name'],
            'topic_name'      => $data['topic_name'],
            'chapter_name'    => $data['chapter_name'] ?? null,
            'subject_name'    => $data['subject_name'] ?? null,
            'last_message_at' => now(),
        ]);

        // Seed a friendly opening message.
        $session->messages()->create([
            'role' => 'tutor',
            'content' => "Hi! I'm your tutor for **{$session->topic_name}**. "
                . "Ask me anything about this topic — I'll explain step by step. Where should we start? 🦉",
        ]);

        return response()->json(['session' => $session->load('messages')], 201);
    }

    public function show(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);
        return response()->json(['session' => $session->load('messages')]);
    }

    // Rename a chat (shown in the session list; topic scoping is unchanged).
    public function update(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate(['title' => ['required', 'string', 'max:160']]);
        $session->update(['title' => $data['title']]);

        return response()->json(['session' => $session]);
    }

    // The tutor's "mind" for this session's topic: live mastery, misconceptions,
    // memory, next step (Chat Page Spec §6).
    public function mind(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        return response()->json([
            'mind' => $this->mindService->mind($request->user(), $session->topic_name ?? $session->title, $session),
        ]);
    }

    // Snap-a-doubt (architecture doc): problem photo -> OCR -> text, which the
    // client then sends through the normal tutor pipeline.
    public function snap(Request $request)
    {
        $request->validate([
            'image' => ['required', 'image', 'mimes:jpeg,png,webp,gif', 'max:8192'],
        ]);

        $user = $request->user();
        $b64 = base64_encode(file_get_contents($request->file('image')->getRealPath()));

        $text = $this->ai->ocr($b64);
        $this->meter->record($user, 'snap', $this->ai->lastUsage ?: ['model' => 'tesseract'], ['kind' => 'ocr']);

        if (trim($text) === '') {
            return response()->json([
                'text' => '',
                'message' => "I couldn't read any text in that photo. Try a clearer, well-lit shot.",
            ], 422);
        }

        return response()->json(['text' => $text]);
    }

    // Send a message and get the AI tutor's reply (non-streaming JSON).
    public function send(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate([
            'message'    => ['required', 'string', 'max:4000'],
            'mode'       => ['nullable', 'in:teach,socratic,quiz,exam,eli10'],
            'note_ids'   => ['nullable', 'array'],
            'note_ids.*' => ['integer'],
        ]);

        $user = $request->user();
        $noteIds = $data['note_ids'] ?? [];
        $notesContext = $this->notesContextFor($user, $noteIds);

        $session->messages()->create([
            'role' => 'user', 'content' => $data['message'],
            'meta' => $noteIds ? ['note_ids' => array_values($noteIds)] : null,
        ]);

        $reply = $this->tutor->explain(
            $user,
            $session->topic_name ?? $session->title,
            $session->chapter_name ?? '',
            $session->subject_name ?? '',
            $this->historyFor($session),
            $data['message'],
            $data['mode'] ?? 'teach',
            $notesContext,
        );

        $message = $session->messages()->create(['role' => 'tutor', 'content' => $reply]);
        $session->update(['last_message_at' => now()]);
        $this->progress->recordActivity($user, topicsStudied: 0, questionsAnswered: 0);

        return response()->json(['message' => $message]);
    }

    // Send a message and stream the AI tutor's reply over SSE.
    public function stream(Request $request, ChatSession $session): StreamedResponse
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate([
            'message'    => ['required', 'string', 'max:4000'],
            'mode'       => ['nullable', 'in:teach,socratic,quiz,exam,eli10'],
            'note_ids'   => ['nullable', 'array'],
            'note_ids.*' => ['integer'],
        ]);

        $user = $request->user();
        $noteIds = $data['note_ids'] ?? [];
        $notesContext = $this->notesContextFor($user, $noteIds);

        $session->messages()->create([
            'role' => 'user', 'content' => $data['message'],
            'meta' => $noteIds ? ['note_ids' => array_values($noteIds)] : null,
        ]);

        return $this->streamReply($session, $user, $data['message'], $data['mode'] ?? 'teach', $notesContext);
    }

    // Discard the last tutor reply and stream a fresh answer to the last question.
    public function regenerate(Request $request, ChatSession $session): StreamedResponse
    {
        $this->authorizeSession($request, $session);

        $mode = $request->validate(['mode' => ['nullable', 'in:teach,socratic,quiz,exam,eli10']])['mode'] ?? 'teach';
        $user = $request->user();

        // reorder() clears the relation's default orderBy('id') so we truly get
        // the most recent message, not the oldest.
        $last = $session->messages()->reorder('id', 'desc')->first();
        if ($last && $last->role === 'tutor') {
            $last->delete();
        }

        $lastUser = $session->messages()->where('role', 'user')->reorder('id', 'desc')->first();
        abort_unless($lastUser, 422, 'Nothing to regenerate yet.');

        // Re-attach whatever notes rode with the original question.
        $notesContext = $this->notesContextFor($user, $lastUser->meta['note_ids'] ?? []);

        return $this->streamReply($session, $user, $lastUser->content, $mode, $notesContext);
    }

    // Record 👍 / 👎 feedback on a tutor message.
    public function feedback(Request $request, ChatMessage $message)
    {
        abort_unless($message->session->user_id === $request->user()->id, 403, 'Not your message.');

        $data = $request->validate([
            'rating' => ['required', 'in:up,down,none'],
        ]);

        $meta = $message->meta ?? [];
        $meta['rating'] = $data['rating'] === 'none' ? null : $data['rating'];
        $message->update(['meta' => $meta]);

        return response()->json(['ok' => true, 'rating' => $meta['rating']]);
    }

    /* ------------------------------------------------------------------ */

    /**
     * Stream a tutor reply for $prompt over SSE, persisting the final message.
     * Emits `delta` events with incremental text and a final `done` event with
     * the saved message id.
     */
    protected function streamReply(ChatSession $session, $user, string $prompt, string $mode = 'teach', string $notesContext = ''): StreamedResponse
    {
        $history = $this->historyFor($session);

        $topic   = $session->topic_name ?? $session->title;
        $chapter = $session->chapter_name ?? '';
        $subject = $session->subject_name ?? '';

        $response = new StreamedResponse(function () use ($session, $user, $prompt, $history, $topic, $chapter, $subject, $mode, $notesContext) {
            $emit = function (string $event, array $payload) {
                echo "event: {$event}\n";
                echo 'data: ' . json_encode($payload) . "\n\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                @flush();
            };

            $full = $this->tutor->explainStream(
                $user, $topic, $chapter, $subject, $history, $prompt,
                fn (string $delta) => $emit('delta', ['text' => $delta]),
                $mode, $notesContext,
            );

            // If streaming produced nothing (e.g. transient upstream error),
            // fall back to the retrying non-streaming path so the student still
            // gets an answer.
            if ($full === '') {
                $full = $this->tutor->explain($user, $topic, $chapter, $subject, $history, $prompt, $mode, $notesContext);
                if ($full !== '') {
                    $emit('delta', ['text' => $full]);
                }
            }

            if ($full === '') {
                $emit('error', ['message' => 'The tutor is briefly unavailable. Please try again.']);
                return;
            }

            $message = $session->messages()->create(['role' => 'tutor', 'content' => $full]);
            $session->update(['last_message_at' => now()]);
            $this->progress->recordActivity($user, topicsStudied: 0, questionsAnswered: 0);

            $emit('done', ['id' => $message->id, 'created_at' => $message->created_at->toIso8601String()]);

            // After the reply is delivered, extract structured signals (cheap
            // grade-routed call) and push the refreshed "mind" to the panel.
            try {
                $this->tutor->extractSignals($user, $topic, $prompt, $full, $session->id);
                $emit('mind', ['mind' => $this->mindService->mind($user, $topic, $session)]);
            } catch (\Throwable $e) {
                // The mind is an enhancement — never let it break a chat turn.
                \Illuminate\Support\Facades\Log::warning('mind update failed', ['error' => $e->getMessage()]);
            }
        });

        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache');
        $response->headers->set('X-Accel-Buffering', 'no'); // disable proxy buffering
        $response->headers->set('Connection', 'keep-alive');

        return $response;
    }

    /**
     * Conversation history as [['role'=>..,'content'=>..], ...].
     *
     * The trailing user message is the prompt we pass separately to the tutor,
     * so we drop it here to avoid sending the same question to the model twice.
     */
    protected function historyFor(ChatSession $session): array
    {
        $messages = $session->messages()
            ->orderBy('id')
            ->get(['role', 'content']);

        if ($messages->isNotEmpty() && $messages->last()->role === 'user') {
            $messages = $messages->slice(0, -1);
        }

        return $messages
            ->map(fn ($m) => ['role' => $m->role, 'content' => $m->content])
            ->values()
            ->toArray();
    }

    protected function authorizeSession(Request $request, ChatSession $session): void
    {
        abort_unless($session->user_id === $request->user()->id, 403, 'Not your session.');
    }

    /**
     * Build a budget-capped context block from the notes the student attached
     * (owned + ready only). Prefers each note's summary, falls back to its raw
     * extracted text. Returns '' when nothing usable is attached.
     */
    protected function notesContextFor($user, array $noteIds): string
    {
        $noteIds = array_values(array_filter(array_map('intval', $noteIds)));
        if (empty($noteIds)) {
            return '';
        }

        $notes = $user->notes()
            ->whereIn('id', $noteIds)
            ->where('status', 'ready')
            ->get(['title', 'summary', 'extracted_text']);

        $budget = 6000; // chars across all attached notes
        $parts = [];
        foreach ($notes as $n) {
            $body = trim((string) ($n->summary ?: $n->extracted_text));
            if ($body === '') continue;
            $body = mb_substr($body, 0, $budget);
            $parts[] = "[{$n->title}]\n{$body}";
            $budget -= mb_strlen($body);
            if ($budget <= 0) break;
        }

        return implode("\n\n", $parts);
    }
}
