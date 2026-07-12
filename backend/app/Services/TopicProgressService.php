<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Models\ConceptMastery;
use App\Models\EvidenceEvent;
use App\Models\SkillMastery;
use App\Models\TopicProgress;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for per-topic progress + completion.
 *
 * A topic's percent is a blend of three real learning signals:
 *   - Learn     (25) — substantive tutor turns in the topic chat
 *   - Practice  (25) — the student has taken at least one assessment OR played a game
 *   - Mastery   (50) — the stronger of concept-level EWMA mastery (ConceptMastery)
 *                      and BKT skill mastery from quest play (SkillMastery)
 *
 * A topic is Completed (sticky — never downgraded) once the student has
 * learned (>= LEARN_TURNS turns), passed a quiz or a game (best >= PASS_PCT), AND
 * reached MASTERY_PCT mastery. Everything is recomputed from existing tables, so
 * the row is a cache the UI can read cheaply, not a second source of truth.
 */
class TopicProgressService
{
    /** Turns for the Learn progress bar to fill (motivational, not the gate). */
    private const LEARN_TURNS = 3;
    /**
     * Distinct syllabus concepts a chat learner must COVER (and MASTER) for the
     * topic to count as learned. Concepts come only from syllabus-grounded turns,
     * so this makes chat completion strictly a function of the syllabus.
     */
    private const LEARN_CONCEPTS = 3;
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
        [$conceptsCovered, $conceptsPassed] = $this->conceptStats($user, $topicName);
        $row->concepts_covered  = $conceptsCovered;
        $row->concepts_passed   = $conceptsPassed;
        [$assessCount, $bestPct] = $this->assessmentStats($user, $topicId, $topicName);
        $row->assessments_taken = $assessCount;
        $row->best_score_pct    = $bestPct;
        [$gameCount, $bestGamePct] = $this->gameStats($user, $topicId, $topicName);
        $row->games_played      = $gameCount;
        $row->best_game_pct     = $bestGamePct;

        // Quest play and quizzes are interchangeable evidence of practice.
        $bestPractice           = max($bestPct, $bestGamePct);
        $practiced              = $assessCount > 0 || $gameCount > 0;

        // Mastery is a REAL mastery signal only (concept EWMA from chat, or BKT
        // from games) — never the practice score standing in for itself. A single
        // passed quiz is practice, not mastery, and must not complete a topic.
        $row->mastery_pct       = max($this->masteryPct($user, $topicName), $this->bktMasteryPct($user, $topicId));

        // --- "Learned the syllabus" — strictly, not by message count ---
        // Chat teaches the syllabus one concept at a time; the tutor records each
        // as a ConceptMastery row from syllabus-grounded turns. So "learned" means
        // the student has genuinely COVERED the topic's concepts — a student who
        // sends a few off-topic messages accrues no concepts and never qualifies.
        // Games are now curriculum-grounded, so on the game path play itself is
        // the coverage.
        $viaChat = $conceptsCovered > 0;
        if ($viaChat) {
            $learned  = $conceptsCovered >= self::LEARN_CONCEPTS;
            $mastered = $conceptsPassed >= self::LEARN_CONCEPTS && $row->mastery_pct >= self::MASTERY_PCT;
        } else {
            $learned  = $gameCount > 0;
            $mastered = $row->mastery_pct >= self::MASTERY_PCT;
        }

        // --- Blend → percent (Learn 25 / Practice 25 / Mastery 50) ---
        // The BAR is motivational (fills from any engagement); COMPLETION below is
        // the strict, syllabus-based gate.
        $learnFrac = max(
            min($conceptsCovered / self::LEARN_CONCEPTS, 1),   // real syllabus coverage
            min($row->chat_turns / self::LEARN_TURNS, 1),      // chat engagement (fills while concepts land)
            $gameCount > 0 ? 1 : 0,                            // played a grounded game
        );
        $learn    = $learnFrac * 25;
        $practice = $practiced ? 25 : 0;
        $mastery  = $row->mastery_pct / 100 * 50;
        $row->percent = (int) max(0, min(100, round($learn + $practice + $mastery)));

        // --- Status (completion is sticky) ---
        $qualifies = $learned && $bestPractice >= self::PASS_PCT && $mastered;

        if ($row->status === 'completed' || $qualifies) {
            if ($row->status !== 'completed') {
                $row->status = 'completed';
                $row->completed_at = now();
            }
            // A completed topic always reads 100% (never dips on a later recompute).
            $row->percent = 100;
        } elseif ($row->chat_turns > 0 || $practiced || $conceptsCovered > 0) {
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

    /** Recompute after a quest game is finished. */
    public function recordGame(User $user, \App\Models\GameInstance $game): TopicProgress
    {
        return $this->recompute($user, $game->topic_id, $game->topic_name);
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
                'chat_turns' => 0, 'concepts_covered' => 0, 'concepts_passed' => 0,
                'assessments_taken' => 0, 'games_played' => 0,
                'best_score_pct' => 0, 'best_game_pct' => 0, 'mastery_pct' => 0,
                'checklist' => ['learned' => false, 'practiced' => false, 'mastered' => false],
                'concepts_required' => self::LEARN_CONCEPTS,
                'topic_id' => null, 'topic_name' => null,
            ];
        }

        return [
            'status'            => $row->status,
            'percent'           => (int) $row->percent,
            'chat_turns'        => (int) $row->chat_turns,
            'concepts_covered'  => (int) $row->concepts_covered,
            'concepts_passed'   => (int) $row->concepts_passed,
            'concepts_required' => self::LEARN_CONCEPTS,
            'assessments_taken' => (int) $row->assessments_taken,
            'games_played'      => (int) $row->games_played,
            'best_score_pct'    => (int) $row->best_score_pct,
            'best_game_pct'     => (int) $row->best_game_pct,
            'mastery_pct'       => (int) $row->mastery_pct,
            'checklist'         => $this->checklistFor($row),
            'completed_at'      => $row->completed_at?->toIso8601String(),
            'topic_id'          => $row->topic_id,
            'topic_name'        => $row->topic_name,
            'subject_name'      => $row->subject_name,
            'chapter_name'      => $row->chapter_name,
        ];
    }

    /**
     * The "what's left" checklist, computed from the cached counters so it always
     * matches the completion gate in {@see recompute()}.
     */
    protected function checklistFor(TopicProgress $row): array
    {
        $viaChat   = $row->concepts_covered > 0;
        $practiced = max((int) $row->best_score_pct, (int) $row->best_game_pct) >= self::PASS_PCT;

        return [
            'learned'   => $viaChat ? $row->concepts_covered >= self::LEARN_CONCEPTS : $row->games_played > 0,
            'practiced' => $practiced,
            'mastered'  => $viaChat
                ? ($row->concepts_passed >= self::LEARN_CONCEPTS && $row->mastery_pct >= self::MASTERY_PCT)
                : ($row->mastery_pct >= self::MASTERY_PCT),
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

    /**
     * [distinct games played, best game score percent] for the topic.
     *
     * A "game score" is the share of that instance's items answered correctly,
     * computed from the immutable evidence stream rather than a stored total —
     * an abandoned game simply scores low rather than being lost.
     */
    protected function gameStats(User $user, ?int $topicId, ?string $topicName): array
    {
        $rows = $this->scopeTopic(EvidenceEvent::where('user_id', $user->id), $topicId, $topicName)
            ->whereNotNull('game_instance_id')
            ->select('game_instance_id',
                DB::raw('count(*) as attempts'),
                DB::raw('sum(case when correct then 1 else 0 end) as hits'))
            ->groupBy('game_instance_id')
            ->get();

        $best = 0;
        foreach ($rows as $r) {
            if ($r->attempts > 0) {
                $best = max($best, (int) round($r->hits / $r->attempts * 100));
            }
        }
        return [$rows->count(), $best];
    }

    /** BKT skill mastery for the topic (percent), 0 when the topic isn't graphed. */
    protected function bktMasteryPct(User $user, ?int $topicId): int
    {
        if (! $topicId) {
            return 0;
        }
        $row = SkillMastery::where('user_id', $user->id)->where('topic_id', $topicId)->first();

        // The BKT prior (0.10) is a "no evidence" placeholder, not a claim about
        // the student — don't let it inflate a topic they have never touched.
        return $row && $row->observations > 0 ? (int) round($row->p_mastered * 100) : 0;
    }

    /**
     * [distinct syllabus concepts covered, distinct concepts mastered] for the
     * topic. A concept is "covered" once the tutor has recorded it from a
     * syllabus-grounded turn, and "mastered" when it passes (score >= 0.8 with
     * confidence >= 2 — the same bar as ConceptMastery::passes()).
     */
    protected function conceptStats(User $user, string $topicName): array
    {
        $rows = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topicName)
            ->get(['score', 'confidence']);

        $passed = $rows->filter(fn ($c) => $c->score >= 0.8 && $c->confidence >= 2)->count();

        return [$rows->count(), $passed];
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
