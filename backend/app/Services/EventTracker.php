<?php

namespace App\Services;

use App\Models\LearningEvent;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * The single funnel for "every user action". One call records a durable
 * `learning_events` row (system of record) and mirrors the action into the
 * GraphRAG "AI mind": a :Event node in Neo4j + an embedding in Qdrant `events`
 * (so the tutor can semantically recall what the student has done).
 *
 * The graph mirror runs in a terminating callback (after the HTTP response is
 * flushed), so event tracking never adds latency to a chat turn or a submit,
 * and never breaks the request if the graph is slow or offline.
 */
class EventTracker
{
    // Canonical event types (kept in sync with the graph + reminders logic).
    public const CHAT_TURN      = 'chat_turn';
    public const ASSESSMENT     = 'assessment';
    public const MISTAKE        = 'mistake';
    public const FLASHCARD      = 'flashcard_review';
    public const NOTE_UPLOAD    = 'note_upload';
    public const PLAN_GENERATED = 'plan_generated';
    public const PLAN_TASK_DONE = 'plan_task_done';
    public const MISCONCEPTION  = 'misconception';
    public const PROFILE_SNAPSHOT = 'profile_snapshot';
    // High-frequency behavioural telemetry (logged + graphed, NOT embedded).
    public const TOPIC_TIME     = 'topic_time';
    public const PANEL_OPEN     = 'panel_open';
    public const SCREEN_FOCUS   = 'screen_focus';
    public const HINT_USED      = 'hint_used';

    public function __construct(protected GraphClient $graph) {}

    /**
     * @param array<string> $concepts   concept names this action touched
     * @param array         $meta       small, JSON-serialisable extras
     * @param bool          $embed      embed into Qdrant `events` for semantic
     *                                  recall (true for meaningful actions; false
     *                                  for high-frequency timing/engagement pings,
     *                                  which are still logged + graphed for stats)
     * @param ?int          $durationMs time spent, for timing events
     */
    public function track(User $user, string $type, string $text, ?string $topicName = null,
                          ?int $topicId = null, array $concepts = [], array $meta = [],
                          bool $embed = true, ?int $durationMs = null): void
    {
        $text = mb_substr(trim($text), 0, 2000);
        $concepts = array_values(array_filter(array_map('strval', $concepts), fn ($c) => $c !== ''));

        try {
            $event = $user->learningEvents()->create([
                'type'        => $type,
                'topic_id'    => $topicId,
                'topic_name'  => $topicName,
                'concept'     => $concepts[0] ?? null,
                'text'        => $text,
                'duration_ms' => $durationMs,
                'meta'        => $meta ?: null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('event log write failed', ['type' => $type, 'error' => $e->getMessage()]);
            return;
        }

        // Mirror to the graph AFTER the response is sent (no added request latency).
        app()->terminating(function () use ($event, $user, $type, $text, $topicName, $concepts, $meta, $embed) {
            try {
                $res = $this->graph->recordEvent([
                    'user_id'  => $user->id,
                    'type'     => $type,
                    'text'     => $text,
                    'topic'    => $topicName,
                    'concepts' => $concepts,
                    'meta'     => $meta,
                    'embed'    => $embed,
                    'ts'       => optional($event->created_at)->toIso8601String(),
                ]);
                if (! empty($res['id'])) {
                    $event->forceFill(['graph_id' => $res['id']])->saveQuietly();
                }
            } catch (\Throwable $e) {
                Log::warning('event graph mirror failed', ['type' => $type, 'error' => $e->getMessage()]);
            }
        });
    }
}
