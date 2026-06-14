<?php

namespace App\Jobs;

use App\Models\ChatSession;
use App\Models\User;
use App\Services\EventTracker;
use App\Services\MindService;
use App\Services\TutorService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Post-turn processing, moved OFF the chat request thread. A chat turn used to
 * run a second (grade-routed) LLM call + a graph write inline after the answer
 * streamed, holding the request open. This job does that work asynchronously:
 *   1. extract structured signals -> the tutor's "mind" (Postgres)
 *   2. mirror the student's state into the GraphRAG mind (Neo4j)
 *   3. log the turn as a tracked learning event
 *   4. roll up the conversation summary (context-window management)
 *   5. decay/prune stale memory
 *
 * Everything is best-effort: a failure here never affected the answer the
 * student already received.
 */
class ProcessChatTurn implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    public function __construct(
        public int $userId,
        public string $topic,
        public ?int $topicId,
        public string $prompt,
        public string $reply,
        public ?int $sessionId,
        public string $mode = 'teach',
    ) {}

    public function handle(TutorService $tutor, MindService $mind, EventTracker $events): void
    {
        $user = User::find($this->userId);
        if (! $user) {
            return;
        }

        // 1. Structured signals -> mind (concept mastery, misconceptions, memory).
        $signals = $tutor->extractSignals($user, $this->topic, $this->prompt, $this->reply, $this->sessionId);

        // 2. Mirror to the GraphRAG "AI mind".
        $mind->syncToGraph($user, $this->topic);

        // 3. Log the turn as a learning event.
        $concepts = array_values(array_filter((array) ($signals['concept_tags'] ?? []), 'is_string'));
        $events->track(
            $user, EventTracker::CHAT_TURN,
            "Q: {$this->prompt}\nA: " . mb_substr($this->reply, 0, 600),
            $this->topic, $this->topicId, $concepts,
            ['mode' => $this->mode, 'session_id' => $this->sessionId],
        );

        // 4. Roll up the conversation summary (no-op in mock mode / short chats).
        if ($this->sessionId) {
            $session = ChatSession::find($this->sessionId);
            if ($session) {
                $tutor->refreshConversationSummary($session);
            }
        }

        // 5. Decay + prune stale memory.
        $mind->decayMemory($user);
    }

    public function failed(\Throwable $e): void
    {
        Log::warning('ProcessChatTurn failed', ['session' => $this->sessionId, 'error' => $e->getMessage()]);
    }
}
