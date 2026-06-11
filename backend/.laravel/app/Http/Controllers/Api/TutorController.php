<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Services\MasteryService;
use App\Services\ProgressService;
use App\Services\TokenMeter;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TutorController extends Controller
{
    public const MODES = ['teach', 'socratic', 'quiz', 'exam', 'eli10'];

    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MasteryService $mastery,
        protected TokenMeter $meter,
    ) {}

    // List the student's chat sessions (most recent first).
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

    // Open a topic-scoped session, resuming the existing one when possible.
    public function startSession(Request $request)
    {
        $data = $request->validate([
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['required', 'string', 'max:160'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'mode'         => ['nullable', 'in:' . implode(',', self::MODES)],
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
                // Resume exactly where the student left off (spec D8).
                return response()->json(['session' => $existing->load('messages')]);
            }
        }

        $session = $request->user()->chatSessions()->create([
            'topic_id'        => $data['topic_id'] ?? null,
            'title'           => $data['topic_name'],
            'topic_name'      => $data['topic_name'],
            'chapter_name'    => $data['chapter_name'] ?? null,
            'subject_name'    => $data['subject_name'] ?? null,
            'mode'            => $data['mode'] ?? 'teach',
            'state'           => 'learning',
            'last_message_at' => now(),
        ]);

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

    // The "shows its mind" panel payload: live mastery, misconceptions,
    // memory, next step (Chat Page Spec §6) + the student's credit meter.
    public function mind(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        return response()->json([
            'mind' => $this->mastery->mind($request->user(), $session->topic_name ?? $session->title, $session),
            'usage' => $this->meter->summary($request->user()),
        ]);
    }

    // Switch tutor mode (Teach / Socratic / Quiz / Exam / ELI10).
    public function setMode(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate(['mode' => ['required', 'in:' . implode(',', self::MODES)]]);
        $session->update(['mode' => $data['mode']]);

        return response()->json(['session' => $session]);
    }

    // Send a message and get the AI tutor's reply (non-streaming JSON).
    public function send(Request $request, ChatSession $session)
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate([
            'message' => ['required', 'string', 'max:4000'],
            'mode'    => ['nullable', 'in:' . implode(',', self::MODES)],
        ]);

        $user = $request->user();
        $this->applyMode($session, $data['mode'] ?? null);

        $session->messages()->create(['role' => 'user', 'content' => $data['message']]);

        $out = $this->tutor->turn($user, $this->turnContext($session), $this->historyFor($session), $data['message']);

        $message = $this->finishTurn($session, $user, $out);
        abort_if(! $message, 503, 'The tutor is briefly unavailable. Please try again.');

        return response()->json([
            'message' => $message,
            'mind' => $this->mastery->mind($user, $session->topic_name ?? $session->title, $session->fresh()),
            'usage' => $this->meter->summary($user),
        ]);
    }

    // Send a message and stream the AI tutor's reply over SSE.
    public function stream(Request $request, ChatSession $session): StreamedResponse
    {
        $this->authorizeSession($request, $session);

        $data = $request->validate([
            'message' => ['required', 'string', 'max:4000'],
            'mode'    => ['nullable', 'in:' . implode(',', self::MODES)],
        ]);

        $user = $request->user();
        $this->applyMode($session, $data['mode'] ?? null);
        $session->messages()->create(['role' => 'user', 'content' => $data['message']]);

        return $this->streamReply($session, $user, $data['message']);
    }

    // Discard the last tutor reply and stream a fresh answer.
    public function regenerate(Request $request, ChatSession $session): StreamedResponse
    {
        $this->authorizeSession($request, $session);

        $user = $request->user();

        $last = $session->messages()->reorder('id', 'desc')->first();
        if ($last && $last->role === 'tutor') {
            $last->delete();
        }

        $lastUser = $session->messages()->where('role', 'user')->reorder('id', 'desc')->first();
        abort_unless($lastUser, 422, 'Nothing to regenerate yet.');

        return $this->streamReply($session, $user, $lastUser->content);
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
     * Stream a tutor reply over SSE. Emits:
     *   delta {text}     incremental reply text
     *   mind  {...}      refreshed right-panel payload + credit meter
     *   done  {id, ...}  saved message id
     */
    protected function streamReply(ChatSession $session, $user, string $prompt): StreamedResponse
    {
        $history = $this->historyFor($session);
        $ctx = $this->turnContext($session);

        $response = new StreamedResponse(function () use ($session, $user, $prompt, $history, $ctx) {
            $emit = function (string $event, array $payload) {
                echo "event: {$event}\n";
                echo 'data: ' . json_encode($payload) . "\n\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                @flush();
            };

            $out = $this->tutor->turnStream(
                $user, $ctx, $history, $prompt,
                fn (string $delta) => $emit('delta', ['text' => $delta]),
            );

            if (($out['reply'] ?? '') === '') {
                $emit('error', ['message' => 'The tutor is briefly unavailable. Please try again.']);
                return;
            }

            $message = $this->finishTurn($session, $user, $out);

            $emit('mind', [
                'mind' => $this->mastery->mind($user, $session->topic_name ?? $session->title, $session->fresh()),
                'usage' => $this->meter->summary($user),
            ]);

            $emit('done', ['id' => $message->id, 'created_at' => $message->created_at->toIso8601String()]);
        });

        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache');
        $response->headers->set('X-Accel-Buffering', 'no');
        $response->headers->set('Connection', 'keep-alive');

        return $response;
    }

    /**
     * Persist the tutor message, apply the turn's structured meta (mastery
     * signal, misconceptions, next step — spec D9), and meter the tokens.
     */
    protected function finishTurn(ChatSession $session, $user, array $out): ?ChatMessage
    {
        if (($out['reply'] ?? '') === '') {
            return null;
        }

        $meta = $out['meta'] ?? [];
        $topic = $session->topic_name ?? $session->title;

        $message = $session->messages()->create([
            'role' => 'tutor',
            'content' => $out['reply'],
            'meta' => array_filter([
                'concept_tags' => $meta['concept_tags'] ?? null,
                'detected_misconception' => $meta['detected_misconception'] ?? null,
                'suggested_render' => $meta['suggested_render'] ?? null,
                'tokens' => ($out['usage']['prompt_tokens'] ?? 0) + ($out['usage']['completion_tokens'] ?? 0),
            ]),
        ]);

        // Live mastery + misconception tracking from the turn's meta.
        $this->mastery->observeChatSignal(
            $user, $topic,
            (array) ($meta['concept_tags'] ?? []),
            isset($meta['mastery_signal']) ? (float) $meta['mastery_signal'] : null,
        );
        if (! empty($meta['detected_misconception'])) {
            $this->mastery->detectMisconception($user, $topic, $meta['detected_misconception'], $session->id);
        }
        if (! empty($meta['resolved_misconception'])) {
            $this->mastery->resolveMisconception($user, $topic, $meta['resolved_misconception']);
        }

        $updates = ['last_message_at' => now()];
        if (! empty($meta['next_step'])) {
            $updates['next_step'] = $meta['next_step'];
        }
        if (($meta['suggested_render'] ?? '') === 'quiz' && $session->state === 'learning') {
            $updates['state'] = 'ready_for_assessment';
        }
        $session->update($updates);

        // Post-call meter: real token counts -> ledger + live counters.
        if (! empty($out['usage'])) {
            $this->meter->meter($user, 'chat', $out['usage'], $session->id);
        }

        $this->progress->recordActivity($user, topicsStudied: 0, questionsAnswered: 0);

        return $message;
    }

    protected function turnContext(ChatSession $session): array
    {
        return [
            'topic' => $session->topic_name ?? $session->title,
            'chapter' => $session->chapter_name ?? '',
            'subject' => $session->subject_name ?? '',
            'mode' => $session->mode ?? 'teach',
            'attempt_no' => $session->attempt_no ?? 1,
            'last_gap' => $session->last_gap,
        ];
    }

    protected function applyMode(ChatSession $session, ?string $mode): void
    {
        if ($mode && $mode !== $session->mode) {
            $session->update(['mode' => $mode]);
        }
    }

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
}
