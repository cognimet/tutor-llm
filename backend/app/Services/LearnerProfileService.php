<?php

namespace App\Services;

use App\Models\ConceptMastery;
use App\Models\Misconception;
use App\Models\StudentMemory;
use App\Models\User;

/**
 * The "world-class sharp mind": a single, rich read of where a student is RIGHT
 * NOW, computed from everything we track — assessments (how many, how often
 * right/wrong), per-concept mastery, time-on-topic, engagement (panel use,
 * chat, cards, notes, plan), and self-correction (a critical-thinking proxy).
 *
 * Produces a learner STAGE (with a colour for the UI), "why you're getting
 * things wrong", and concrete, grade-appropriate suggestions. The compact
 * `summary` is injected into every tutor prompt and embedded into the graph so
 * the AI genuinely knows the student's current stage.
 */
class LearnerProfileService
{
    public function __construct(
        protected MindService $mind,
        protected EventTracker $events,
    ) {}

    /** Full profile (read-only); also caches the summary for prompt injection. */
    public function compute(User $user): array
    {
        // ── Assessments + accuracy ───────────────────────────────────
        $assessments = $user->assessments()->where('status', 'completed')
            ->get(['id', 'score', 'total', 'topic_name', 'completed_at']);
        $assessmentCount = $assessments->count();
        $answered = (int) $assessments->sum('total');
        $correct = (int) $assessments->sum('score');
        $wrong = max(0, $answered - $correct);
        $accuracy = $answered ? (int) round($correct / $answered * 100) : 0;

        // ── Time on topic ─────────────────────────────────────────────
        $timeRows = $user->learningEvents()->where('type', EventTracker::TOPIC_TIME)
            ->whereNotNull('topic_name')
            ->selectRaw('topic_name, SUM(duration_ms) as ms')->groupBy('topic_name')->get();
        $totalMs = (int) $timeRows->sum('ms');
        $activeMinutes = (int) round($totalMs / 60000);
        $timeByTopic = $timeRows->map(fn ($r) => ['topic' => $r->topic_name, 'minutes' => (int) round($r->ms / 60000)])
            ->filter(fn ($t) => $t['minutes'] > 0)->sortByDesc('minutes')->take(6)->values();

        // ── Mastery ───────────────────────────────────────────────────
        $mastery = ConceptMastery::where('user_id', $user->id)->get();
        $observed = $mastery->where('confidence', '>', 0);
        $avgMastery = $observed->isEmpty() ? 0 : (int) round($observed->avg('score') * 100);
        $weakest = $observed->sortBy('score')->take(3)
            ->map(fn ($m) => ['concept' => $m->concept, 'topic' => $m->topic_name, 'score' => (int) round($m->score * 100)])
            ->values();

        // ── Critical thinking (self-correction + depth of engagement) ──
        $detected = Misconception::where('user_id', $user->id)->count();
        $resolved = Misconception::where('user_id', $user->id)->where('status', 'resolved')->count();
        $selfCorrect = $detected ? $resolved / $detected : 0.0;
        $chatTurns = $user->learningEvents()->where('type', EventTracker::CHAT_TURN)->count();
        $ctScore = (int) round(60 * $selfCorrect + 40 * min(1, $chatTurns / 20));
        $ctLabel = $ctScore >= 70 ? 'Sharp' : ($ctScore >= 40 ? 'Developing' : 'Early');

        // ── Why wrong: most-missed concepts (unresolved mistakes) ──────
        $whyWrong = $user->mistakes()->where('resolved', false)->whereNotNull('concept')
            ->selectRaw('concept, COUNT(*) as c')->groupBy('concept')
            ->orderByDesc('c')->take(5)->get()
            ->map(fn ($r) => ['concept' => $r->concept, 'misses' => (int) $r->c])->values();

        // ── Engagement (does the student use the panel / tools?) ───────
        $ev = fn ($type) => $user->learningEvents()->where('type', $type)->count();
        $engagement = [
            'panel_opens'    => $ev(EventTracker::PANEL_OPEN),
            'chat_turns'     => $chatTurns,
            'cards_reviewed' => $ev(EventTracker::FLASHCARD),
            'notes'          => $ev(EventTracker::NOTE_UPLOAD),
            'plan_tasks_done' => $ev(EventTracker::PLAN_TASK_DONE),
        ];
        $engagementScore = min(100, ($engagement['panel_opens'] + $chatTurns + $engagement['cards_reviewed']
            + $engagement['notes'] * 2 + $engagement['plan_tasks_done']) * 4);

        // ── Overall stage (mastery-weighted, with accuracy + engagement) ─
        $stageScore = (int) round(0.5 * $avgMastery + 0.4 * $accuracy + 0.1 * $engagementScore);
        [$stageKey, $stageLabel, $stageColor] = match (true) {
            $stageScore >= 80 => ['confident', 'Confident', 'emerald'],
            $stageScore >= 60 => ['practised', 'Practised', 'violet'],
            $stageScore >= 40 => ['building',  'Building',  'indigo'],
            $stageScore >= 20 => ['exploring', 'Exploring', 'sky'],
            default           => ['starting',  'Just starting', 'slate'],
        };

        // ── Per-topic snapshot ────────────────────────────────────────
        $byTopicMastery = $observed->groupBy('topic_name')->map(fn ($g) => (int) round($g->avg('score') * 100));
        $byTopicAcc = $assessments->groupBy('topic_name')->map(function ($g) {
            $t = (int) $g->sum('total');
            return $t ? (int) round($g->sum('score') / $t * 100) : null;
        });
        $perTopic = collect($byTopicMastery->keys())->merge($byTopicAcc->keys())->filter()->unique()
            ->map(fn ($t) => [
                'topic'    => $t,
                'mastery'  => (int) ($byTopicMastery[$t] ?? 0),
                'accuracy' => $byTopicAcc[$t] ?? null,
            ])->sortByDesc('mastery')->take(8)->values();

        $totals = [
            'active_minutes'     => $activeMinutes,
            'topics'             => $perTopic->count(),
            'assessments'        => $assessmentCount,
            'questions_answered' => $answered,
            'correct'            => $correct,
            'wrong'              => $wrong,
            'accuracy_pct'       => $accuracy,
        ];

        $suggestions = $this->suggestions($accuracy, $weakest, $whyWrong, $engagement, $selfCorrect, $stageScore);
        $summary = $this->summary($stageLabel, $stageScore, $totals, $weakest, $ctLabel, $suggestions);

        // Cache the summary so the tutor prompt + reminders can use it cheaply.
        StudentMemory::updateOrCreate(
            ['user_id' => $user->id, 'key' => 'learner_summary::global'],
            ['value' => mb_substr($summary, 0, 900)],
        );

        return [
            'stage' => ['key' => $stageKey, 'label' => $stageLabel, 'color' => $stageColor, 'score' => $stageScore],
            'totals' => $totals,
            'time_by_topic' => $timeByTopic,
            'per_topic' => $perTopic,
            'weakest' => $weakest,
            'why_wrong' => $whyWrong,
            'engagement' => $engagement,
            'critical_thinking' => ['score' => $ctScore, 'label' => $ctLabel],
            'focus' => $this->mind->nextFocus($user),
            'suggestions' => $suggestions,
            'summary' => $summary,
        ];
    }

    /** Compute + embed a stage snapshot into the GraphRAG mind (milestones only). */
    public function snapshot(User $user): array
    {
        $profile = $this->compute($user);
        $this->events->track(
            $user, EventTracker::PROFILE_SNAPSHOT, $profile['summary'],
            null, null, [], ['stage' => $profile['stage']['key'], 'score' => $profile['stage']['score']],
            embed: true,
        );
        return $profile;
    }

    /* ----------------------------------------------------------------- */

    protected function suggestions(int $accuracy, $weakest, $whyWrong, array $engagement,
                                   float $selfCorrect, int $stageScore): array
    {
        $out = [];

        if ($whyWrong->isNotEmpty()) {
            $top = $whyWrong->first();
            $out[] = "You keep slipping on **{$top['concept']}** ({$top['misses']}×) — re-learn it, then re-test.";
        }
        if ($accuracy > 0 && $accuracy < 50) {
            $out[] = 'Your quiz accuracy is low — slow down, re-read each question, and rule out options before answering.';
        }
        if ($weakest->isNotEmpty()) {
            $w = $weakest->first();
            $out[] = "Focus next on **{$w['concept']}** — it's your weakest area right now ({$w['score']}%).";
        }
        if ($selfCorrect < 0.4 && $stageScore >= 20) {
            $out[] = 'Try the Socratic mode in chat — working answers out yourself builds sharper thinking.';
        }
        if (($engagement['panel_opens'] ?? 0) < 2) {
            $out[] = 'Open the Study hub — a plan, your notes and flashcards will help you learn faster.';
        }
        if (($engagement['cards_reviewed'] ?? 0) === 0) {
            $out[] = 'Review your flashcards daily — short, spaced reviews make things stick.';
        }

        if (empty($out)) {
            $out[] = "You're on track — keep learning, then take a check to confirm.";
        }
        return array_slice($out, 0, 4);
    }

    protected function summary(string $stageLabel, int $stageScore, array $totals, $weakest,
                               string $ctLabel, array $suggestions): string
    {
        $weak = $weakest->isNotEmpty()
            ? $weakest->map(fn ($w) => "{$w['concept']} ({$w['score']}%)")->implode(', ')
            : 'none yet';

        return sprintf(
            'Learner stage: %s (%d/100). Studied ~%d min across %d topic(s); took %d check(s) at %d%% accuracy '
            . '(%d right / %d wrong). Weakest concepts: %s. Critical thinking: %s. Coaching tip: %s',
            $stageLabel, $stageScore, $totals['active_minutes'], $totals['topics'], $totals['assessments'],
            $totals['accuracy_pct'], $totals['correct'], $totals['wrong'], $weak, $ctLabel,
            strip_tags(str_replace('**', '', $suggestions[0] ?? '')),
        );
    }
}
