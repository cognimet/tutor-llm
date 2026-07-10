<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Models\ConceptMastery;
use App\Models\TopicProgress;
use App\Models\User;

/**
 * Single source of truth for per-topic progress + completion.
 *
 * A topic's percent is a blend of three real learning signals:
 *   - Learn     (25) — substantive tutor turns in the topic chat
 *   - Practice  (25) — the student has taken at least one assessment
 *   - Mastery   (50) — concept-level EWMA mastery (ConceptMastery)
 *
 * A topic is Completed (sticky — never downgraded) once the student has
 * learned (>= LEARN_TURNS turns), passed a quiz (best >= PASS_PCT), AND reached
 * MASTERY_PCT concept mastery. Everything is recomputed from existing tables, so
 * the row is a cache the UI can read cheaply, not a second source of truth.
 */
class TopicProgressService
{
    /** Turns for the Learn component to be full / the completion gate. */
    private const LEARN_TURNS = 3;
    /** Passing quiz score (percent) for the Practice completion gate. */
    private const PASS_PCT = 70;
    /** Concept mastery (percent) required for completion. */
    private const MASTERY_PCT = 80;

    /** Recompute + persist progress for a topic, returning the fresh row. */
    public function recompute(User $user, ?int $topicId, string $topicName, array $ctx = []): TopicProgress
    {
        $topicName = trim($topicName) !== '' ? $topicName : 'General';

        $row = $this->find($user, $topicId, $topicName)
            ?? new TopicProgress(['user_id' => $user->id, 'topic_id' => $topicId, 'topic_name' => $topicName]);

        // Keep the labels fresh (a note quest may learn the subject/chapter later).
        $row->topic_id     = $topicId ?? $row->topic_id;
        $row->topic_name   = $topicName;
        $row->subject_name = $ctx['subject_name'] ?? $row->subject_name;
        $row->chapter_name = $ctx['chapter_name'] ?? $row->chapter_name;

        // --- Signals (all read from existing tables) ---
        $row->chat_turns        = $this->chatTurns($user, $topicId, $topicName);
        [$assessCount, $bestPct] = $this->assessmentStats($user, $topicId, $topicName);
        $row->assessments_taken = $assessCount;
        $row->best_score_pct    = $bestPct;
        $masteryPct             = $this->masteryPct($user, $topicName);
        // Before any concept signal exists, let a passed quiz stand in for mastery.
        $row->mastery_pct       = $masteryPct > 0 ? $masteryPct : $bestPct;

        // --- Blend → percent (Learn 25 / Practice 25 / Mastery 50) ---
        $learn    = min($row->chat_turns / self::LEARN_TURNS, 1) * 25;
        $practice = $row->assessments_taken > 0 ? 25 : 0;
        $mastery  = $row->mastery_pct / 100 * 50;
        $row->percent = (int) max(0, min(100, round($learn + $practice + $mastery)));

        // --- Status (completion is sticky) ---
        $qualifies = $row->chat_turns >= self::LEARN_TURNS
            && $row->best_score_pct >= self::PASS_PCT
            && $row->mastery_pct >= self::MASTERY_PCT;

        if ($row->status === 'completed' || $qualifies) {
            if ($row->status !== 'completed') {
                $row->status = 'completed';
                $row->completed_at = now();
            }
            // A completed topic always reads 100% (never dips on a later recompute).
            $row->percent = 100;
        } elseif ($row->chat_turns > 0 || $row->assessments_taken > 0) {
            $row->status = 'in_progress';
        } else {
            $row->status = 'not_started';
        }

        $row->last_activity_at = now();
        $row->save();

        return $row;
    }

    /** Recompute after a chat turn (resolve topic from the session). */
    public function recordChatTurn(User $user, ChatSession $session): TopicProgress
    {
        return $this->recompute($user, $session->topic_id, $session->topic_name ?? $session->title, [
            'subject_name' => $session->subject_name,
            'chapter_name' => $session->chapter_name,
        ]);
    }

    /** Recompute after an assessment is submitted. */
    public function recordAssessment(User $user, Assessment $assessment): TopicProgress
    {
        return $this->recompute($user, $assessment->topic_id, $assessment->topic_name);
    }

    /**
     * Bulk map for the subject browser: one query, keyed both by "id:{id}" and
     * "name:{name}" so the client can look a topic up either way.
     */
    public function mapFor(User $user, iterable $topicIds = [], iterable $topicNames = []): array
    {
        $ids   = collect($topicIds)->filter()->map(fn ($v) => (int) $v)->unique()->values();
        $names = collect($topicNames)->filter()->unique()->values();

        $rows = TopicProgress::where('user_id', $user->id)
            ->where(function ($q) use ($ids, $names) {
                if ($ids->isNotEmpty())   $q->orWhereIn('topic_id', $ids->all());
                if ($names->isNotEmpty()) $q->orWhereIn('topic_name', $names->all());
            })
            ->get();

        $map = [];
        foreach ($rows as $r) {
            $view = $this->present($r);
            if ($r->topic_id) $map['id:'.$r->topic_id] = $view;
            $map['name:'.$r->topic_name] = $view;
        }
        return $map;
    }

    /** The student's in-progress topics, most recently active first. */
    public function inProgress(User $user, int $limit = 8): array
    {
        return TopicProgress::where('user_id', $user->id)
            ->where('status', 'in_progress')
            ->orderByDesc('last_activity_at')
            ->take($limit)
            ->get()
            ->map(fn ($r) => $this->present($r))
            ->all();
    }

    /** Client-safe view incl. the "what's left" checklist. */
    public function present(?TopicProgress $row): array
    {
        if (! $row) {
            return [
                'status' => 'not_started', 'percent' => 0,
                'chat_turns' => 0, 'assessments_taken' => 0,
                'best_score_pct' => 0, 'mastery_pct' => 0,
                'checklist' => ['learned' => false, 'practiced' => false, 'mastered' => false],
                'topic_id' => null, 'topic_name' => null,
            ];
        }

        return [
            'status'            => $row->status,
            'percent'           => (int) $row->percent,
            'chat_turns'        => (int) $row->chat_turns,
            'assessments_taken' => (int) $row->assessments_taken,
            'best_score_pct'    => (int) $row->best_score_pct,
            'mastery_pct'       => (int) $row->mastery_pct,
            'checklist'         => [
                'learned'   => $row->chat_turns >= self::LEARN_TURNS,
                'practiced' => $row->best_score_pct >= self::PASS_PCT,
                'mastered'  => $row->mastery_pct >= self::MASTERY_PCT,
            ],
            'completed_at'      => $row->completed_at?->toIso8601String(),
            'topic_id'          => $row->topic_id,
            'topic_name'        => $row->topic_name,
            'subject_name'      => $row->subject_name,
            'chapter_name'      => $row->chapter_name,
        ];
    }

    /** Fetch a single topic's progress (id preferred, else name). */
    public function progressFor(User $user, ?int $topicId, ?string $topicName): array
    {
        return $this->present($this->find($user, $topicId, $topicName));
    }

    /* ------------------------------------------------------------------ */

    /** Locate the row for a topic (by id, else by name with no id). */
    protected function find(User $user, ?int $topicId, ?string $topicName): ?TopicProgress
    {
        $q = TopicProgress::where('user_id', $user->id);
        if ($topicId) {
            return $q->where('topic_id', $topicId)->first();
        }
        return $q->whereNull('topic_id')->where('topic_name', $topicName)->first();
    }

    /** Count of the student's own messages across this topic's chat(s). */
    protected function chatTurns(User $user, ?int $topicId, ?string $topicName): int
    {
        $sessionIds = $this->scopeTopic($user->chatSessions(), $topicId, $topicName)->pluck('id');
        if ($sessionIds->isEmpty()) {
            return 0;
        }
        return (int) ChatMessage::whereIn('chat_session_id', $sessionIds)->where('role', 'user')->count();
    }

    /** [completed assessment count, best score percent] for the topic. */
    protected function assessmentStats(User $user, ?int $topicId, ?string $topicName): array
    {
        $rows = $this->scopeTopic($user->assessments(), $topicId, $topicName)
            ->where('status', 'completed')
            ->get(['score', 'total']);

        $best = 0;
        foreach ($rows as $a) {
            $pct = $a->total > 0 ? (int) round($a->score / $a->total * 100) : 0;
            $best = max($best, $pct);
        }
        return [$rows->count(), $best];
    }

    /** Avg concept EWMA mastery for the topic (percent) — same as MindService. */
    protected function masteryPct(User $user, string $topicName): int
    {
        $avg = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topicName)
            ->avg('score');

        return $avg ? (int) round($avg * 100) : 0;
    }

    /**
     * Scope a topic-owning relation the same way the rest of the app does:
     * by topic_id when present, else by topic_name with a null topic_id.
     */
    protected function scopeTopic($query, ?int $topicId, ?string $topicName)
    {
        return $topicId
            ? $query->where('topic_id', $topicId)
            : $query->where('topic_name', $topicName)->whereNull('topic_id');
    }
}
