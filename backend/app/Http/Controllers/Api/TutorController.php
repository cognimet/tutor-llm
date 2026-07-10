<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessChatTurn;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Models\StudentProgressLog;
use App\Services\AiClient;
use App\Services\CurriculumResolver;
use App\Services\EventTracker;
use App\Services\MindService;
use App\Services\ProgressService;
use App\Services\TokenMeter;
use App\Services\TopicProgressService;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TutorController extends Controller
{
    // Recent turns kept verbatim in the prompt are token-budgeted; older turns
    // are condensed into chat_sessions.summary (rolled up by ProcessChatTurn).
    private const HISTORY_TOKEN_BUDGET = 3000;

    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MindService $mindService,
        protected AiClient $ai,
        protected TokenMeter $meter,
        protected EventTracker $events,
        protected CurriculumResolver $resolver,
        protected TopicProgressService $topicProgress,
    ) {}

    /** Roll a topic's Learn progress forward after a completed turn (best-effort). */
    protected function bumpTopicProgress($user, ChatSession $session): void
    {
        try { $this->topicProgress->recordChatTurn($user, $session); }
        catch (\Throwable) { /* progress is a cache — never break the chat turn */ }
    }

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
            'topic_id'            => ['nullable', 'exists:topics,id'],
            'topic_name'          => ['required', 'string', 'max:160'],
            'chapter_name'        => ['nullable', 'string', 'max:160'],
            'subject_name'        => ['nullable', 'string', 'max:160'],
            'selected_note_ids'   => ['nullable', 'array'],
            'selected_note_ids.*' => ['integer'],
            // Syllabus Quest launch config (persisted so the chosen teaching
            // style + companion persona survive reloads and later turns).
            'quest_style'         => ['nullable', 'string', 'in:teach,socratic,quiz,exam'],
            'tutor_vibe'          => ['nullable', 'string', 'in:coach,adventure,comic'],
            'fresh'               => ['nullable', 'boolean'],
        ]);

        // Notes the student picked in the Notebook Hub — this session stays
        // grounded in exactly these uploaded notes (see notesContextFor + the
        // strict grounding prompt). Empty/absent means a normal topic session.
        $selectedNoteIds = ! empty($data['selected_note_ids'])
            ? array_values(array_unique(array_map('intval', $data['selected_note_ids'])))
            : null;

        // Launch config: only treated as "set" when present (so re-entering a
        // topic without re-picking doesn't wipe the existing choice).
        $questStyle = $data['quest_style'] ?? null;
        $tutorVibe  = $data['tutor_vibe'] ?? null;

        if (empty($data['fresh'])) {
            // One persistent chat per topic: resume the richest existing thread
            // (most messages), so legacy duplicates never strand a student on an
            // empty session. Newest wins ties.
            $existing = $request->user()->chatSessions()
                ->when(
                    ! empty($data['topic_id']),
                    fn ($q) => $q->where('topic_id', $data['topic_id']),
                    fn ($q) => $q->where('topic_name', $data['topic_name'])->whereNull('topic_id'),
                )
                ->withCount('messages')
                ->orderByDesc('messages_count')
                ->orderByDesc('id')
                ->first();

            if ($existing) {
                // Re-entering the topic with a fresh note selection re-scopes the
                // existing chat to those notes; a fresh launch config (style/vibe)
                // likewise re-tunes it. Each is only overwritten when provided.
                $patch = [];
                if ($selectedNoteIds !== null) $patch['selected_note_ids'] = $selectedNoteIds;
                if ($questStyle !== null)      $patch['quest_style'] = $questStyle;
                if ($tutorVibe !== null)       $patch['tutor_vibe'] = $tutorVibe;
                if ($patch) $existing->update($patch);
                return response()->json(['session' => $existing->load('messages')]);
            }
        }

        $session = $request->user()->chatSessions()->create([
            'topic_id'          => $data['topic_id'] ?? null,
            'title'             => $data['topic_name'],
            'topic_name'        => $data['topic_name'],
            'chapter_name'      => $data['chapter_name'] ?? null,
            'subject_name'      => $data['subject_name'] ?? null,
            'selected_note_ids' => $selectedNoteIds,
            'quest_style'       => $questStyle,
            'tutor_vibe'        => $tutorVibe,
            'last_message_at'   => now(),
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
        // Explicit per-message notes win; otherwise fall back to the notes this
        // session was launched with (Study-from-notes grounding).
        $noteIds = ! empty($data['note_ids']) ? $data['note_ids'] : ($session->selected_note_ids ?? []);
        $notesContext = $this->notesContextFor($user, $noteIds);

        $session->messages()->create([
            'role' => 'user', 'content' => $data['message'],
            'meta' => $noteIds ? ['note_ids' => array_values($noteIds)] : null,
        ]);

        $subjectId = $this->resolver->subjectId($user, $session->topic_id, $session->subject_name);
        ['summary' => $summary, 'history' => $history] = $this->conversationContextFor($session);

        $reply = $this->tutor->explain(
            $user,
            $session->topic_name ?? $session->title,
            $session->chapter_name ?? '',
            $session->subject_name ?? '',
            $history,
            $data['message'],
            $data['mode'] ?? 'teach',
            $notesContext,
            $summary,
            $subjectId,
            $session->tutor_vibe,
        );

        $message = $session->messages()->create(['role' => 'tutor', 'content' => $reply]);
        $session->update(['last_message_at' => now()]);
        $this->progress->recordActivity($user, topicsStudied: 0, questionsAnswered: 0);
        $this->bumpTopicProgress($user, $session);

        // Same post-turn processing as the streaming path: extract mind signals,
        // mirror state to the graph, and log the action (previously skipped here).
        $topic = $session->topic_name ?? $session->title;
        $this->postTurn($user, $topic, $session->topic_id, $data['message'], $reply, $session->id, $data['mode'] ?? 'teach');

        return response()->json([
            'message' => $message,
            'mind' => $this->mindService->mind($user, $topic, $session),
        ]);
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
        // Explicit per-message notes win; otherwise fall back to the notes this
        // session was launched with (Study-from-notes grounding).
        $noteIds = ! empty($data['note_ids']) ? $data['note_ids'] : ($session->selected_note_ids ?? []);
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

        // Re-attach whatever notes rode with the original question, falling back
        // to the session's launch-time note selection (Study-from-notes grounding).
        $regenNoteIds = ! empty($lastUser->meta['note_ids']) ? $lastUser->meta['note_ids'] : ($session->selected_note_ids ?? []);
        $notesContext = $this->notesContextFor($user, $regenNoteIds);

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

    /**
     * Log a progressive "continue" reveal or a Progress Gate answer attempt, so a
     * storybook lesson's micro-progress survives a refresh / leaving the chat.
     * (Auto-ticking a matching study-plan task is handled client-side via
     * planner/cover when the gate is first cleared, so it isn't repeated here.)
     */
    public function logProgress(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate([
            'type'       => ['required', 'string', 'in:read_continue,quiz_attempt'],
            'target_id'  => ['required', 'string', 'max:160'],
            'is_correct' => ['nullable', 'boolean'],
            'metadata'   => ['nullable', 'array'],
        ]);

        // Serial attempt number per gate (1 = first try); read-continue clicks stay 1.
        $attemptNumber = 1;
        if ($data['type'] === 'quiz_attempt') {
            $attemptNumber = StudentProgressLog::where('user_id', $request->user()->id)
                ->where('chat_session_id', $session->id)
                ->where('type', 'quiz_attempt')
                ->where('target_id', $data['target_id'])
                ->count() + 1;
        }

        $log = StudentProgressLog::create([
            'user_id'         => $request->user()->id,
            'chat_session_id' => $session->id,
            'type'            => $data['type'],
            'target_id'       => $data['target_id'],
            'is_correct'      => $data['is_correct'] ?? null,
            'attempt_number'  => $attemptNumber,
            'metadata'        => $data['metadata'] ?? [],
        ]);

        return response()->json([
            'success'        => true,
            'attempt_number' => $attemptNumber,
            'is_correct'     => $log->is_correct,
        ]);
    }

    /**
     * Return every progress log for a session so the chat can re-hydrate its
     * Progress Gates and progressive reveals on load.
     */
    public function getProgressState(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $logs = StudentProgressLog::where('chat_session_id', $session->id)
            ->orderBy('created_at')
            ->get(['type', 'target_id', 'is_correct', 'attempt_number', 'metadata']);

        return response()->json([
            'session_id' => $session->id,
            'logs'       => $logs,
        ]);
    }

    /* ------------------------------------------------------------------ */

    /**
     * Stream a tutor reply for $prompt over SSE, persisting the final message.
     * Emits `delta` events with incremental text and a final `done` event with
     * the saved message id.
     */
    protected function streamReply(ChatSession $session, $user, string $prompt, string $mode = 'teach', string $notesContext = ''): StreamedResponse
    {
        ['summary' => $summary, 'history' => $history] = $this->conversationContextFor($session);

        $topic   = $session->topic_name ?? $session->title;
        $chapter = $session->chapter_name ?? '';
        $subject = $session->subject_name ?? '';
        $subjectId = $this->resolver->subjectId($user, $session->topic_id, $subject);
        $tutorVibe = $session->tutor_vibe; // companion archetype persona overlay

        $response = new StreamedResponse(function () use ($session, $user, $prompt, $history, $summary, $topic, $chapter, $subject, $subjectId, $mode, $notesContext, $tutorVibe) {
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
                $mode, $notesContext, $summary, $subjectId, $tutorVibe,
            );

            // If streaming produced nothing (e.g. transient upstream error),
            // fall back to the retrying non-streaming path so the student still
            // gets an answer.
            if ($full === '') {
                $full = $this->tutor->explain($user, $topic, $chapter, $subject, $history, $prompt, $mode, $notesContext, $summary, $subjectId, $tutorVibe);
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
            $this->bumpTopicProgress($user, $session);

            $emit('done', ['id' => $message->id, 'created_at' => $message->created_at->toIso8601String()]);

            // After the reply is delivered, extract structured signals, mirror
            // state to the GraphRAG mind, log the action, then push the refreshed
            // "mind" to the panel. Never let any of this break the chat turn.
            $this->postTurn($user, $topic, $session->topic_id, $prompt, $full, $session->id, $mode);
            try {
                $emit('mind', ['mind' => $this->mindService->mind($user, $topic, $session)]);
            } catch (\Throwable $e) {
                Log::warning('mind panel refresh failed', ['error' => $e->getMessage()]);
            }
        });

        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache');
        $response->headers->set('X-Accel-Buffering', 'no'); // disable proxy buffering
        $response->headers->set('Connection', 'keep-alive');

        return $response;
    }

    /**
     * Shared post-turn processing for BOTH the streaming and non-streaming
     * paths: extract mind signals, mirror state to the GraphRAG mind, log the
     * event, roll up the conversation summary, and decay stale memory.
     *
     * This used to run INLINE after the answer streamed — a second (grade-routed)
     * LLM call plus a graph write that held the request open. It is now queued so
     * the request returns as soon as the answer is delivered.
     */
    protected function postTurn($user, string $topic, ?int $topicId, string $prompt,
                                string $reply, ?int $sessionId, string $mode = 'teach'): void
    {
        ProcessChatTurn::dispatch($user->id, $topic, $topicId, $prompt, $reply, $sessionId, $mode);
    }

    /**
     * Token-budgeted conversation context for the prompt:
     *   - `summary`: the rolling summary of older turns (ProcessChatTurn maintains it)
     *   - `history`: the most recent turns past the summary, trimmed to a token
     *     budget (oldest dropped first; they get folded into the summary later).
     *
     * Only loads the unsummarised tail (id > summary_upto_id), so prompt cost no
     * longer grows with total conversation length. The trailing user message is
     * the prompt we pass separately, so it's dropped here to avoid duplication.
     */
    protected function conversationContextFor(ChatSession $session): array
    {
        $cut = (int) ($session->summary_upto_id ?? 0);

        $messages = $session->messages()
            ->where('id', '>', $cut)
            ->orderBy('id')
            ->get(['role', 'content']);

        if ($messages->isNotEmpty() && $messages->last()->role === 'user') {
            $messages = $messages->slice(0, -1);
        }

        // Keep the most recent turns within the token budget (estimate ~4 chars/token).
        $window = [];
        $tokens = 0;
        foreach ($messages->reverse() as $m) {
            $tokens += (int) ceil(mb_strlen((string) $m->content) / 4);
            if ($tokens > self::HISTORY_TOKEN_BUDGET && ! empty($window)) {
                break;
            }
            array_unshift($window, ['role' => $m->role, 'content' => $m->content]);
        }

        return ['summary' => (string) ($session->summary ?? ''), 'history' => $window];
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
