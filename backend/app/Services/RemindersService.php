<?php

namespace App\Services;

use App\Models\Misconception;
use App\Models\StudyPlanTask;
use App\Models\User;
use Carbon\Carbon;

/**
 * Builds the in-app Plan Reminders feed: what to do today / tomorrow, what's
 * overdue, exam countdowns, cards due, and the single next action. Computed
 * purely from existing tables (study_plan_tasks, study_plans, flashcards,
 * misconceptions, mistakes) — no new infra, no external delivery.
 *
 * The "next action" mirrors the frontend NextStep.pickNext priority
 * (plan task → fix → cards → ask) so the server and UI agree on the one nudge.
 */
class RemindersService
{
    public function __construct(protected MindService $mind) {}

    public function feed(User $user): array
    {
        $today = Carbon::today();
        $tomorrow = $today->copy()->addDay();

        $tasks = StudyPlanTask::query()
            ->whereHas('plan', fn ($q) => $q->where('user_id', $user->id)->where('status', 'active'))
            ->where('status', 'todo')
            ->whereNotNull('scheduled_for')
            ->with('plan:id,topic_name,horizon,exam_date')
            ->orderBy('scheduled_for')->orderBy('position')
            ->get();

        $bucket = fn (callable $pred) => $tasks->filter($pred)->map(fn ($t) => $this->taskDto($t))->values();

        $todayTasks    = $bucket(fn ($t) => $t->scheduled_for && $t->scheduled_for->isSameDay($today));
        $tomorrowTasks = $bucket(fn ($t) => $t->scheduled_for && $t->scheduled_for->isSameDay($tomorrow));
        $overdue       = $bucket(fn ($t) => $t->scheduled_for && $t->scheduled_for->lt($today));

        // Exam countdowns (soonest first).
        $exams = $user->studyPlans()
            ->where('status', 'active')->whereNotNull('exam_date')
            ->orderBy('exam_date')->get()
            ->map(fn ($p) => [
                'plan_id'        => $p->id,
                'topic'          => $p->topic_name,
                'exam_date'      => optional($p->exam_date)->toDateString(),
                'days_remaining' => $p->exam_date ? (int) $today->diffInDays($p->exam_date, false) : null,
            ])
            ->filter(fn ($e) => $e['days_remaining'] !== null && $e['days_remaining'] >= 0)
            ->values();

        // Cards due now.
        $dueCards = $user->flashcards()
            ->where(fn ($q) => $q->whereNull('due_at')->orWhere('due_at', '<=', now()))
            ->count();

        // Fix queue: open misconceptions + unresolved mistakes.
        $openMis = Misconception::where('user_id', $user->id)->where('status', 'open')->count();
        $openMistakes = $user->mistakes()->where('resolved', false)->count();
        $fixCount = $openMis + $openMistakes;
        $fixTop = Misconception::where('user_id', $user->id)->where('status', 'open')
                ->latest('id')->value('description')
            ?: $user->mistakes()->where('resolved', false)->latest('id')->value('concept');

        return [
            'today'     => $todayTasks,
            'tomorrow'  => $tomorrowTasks,
            'overdue'   => $overdue,
            'exams'     => $exams,
            'due_cards' => $dueCards,
            'fix'       => ['count' => $fixCount, 'top' => $fixTop],
            'focus'     => $this->mind->nextFocus($user),
            'next'      => $this->pickNext($todayTasks, $fixCount, $fixTop, $dueCards),
            'counts'    => [
                'today'    => $todayTasks->count(),
                'tomorrow' => $tomorrowTasks->count(),
                'overdue'  => $overdue->count(),
                'exams'    => $exams->count(),
            ],
        ];
    }

    protected function taskDto(StudyPlanTask $t): array
    {
        return [
            'task_id'           => $t->id,
            'plan_id'           => $t->study_plan_id,
            'title'             => $t->title,
            'kind'              => $t->kind,
            'concept'           => $t->concept,
            'topic'             => $t->plan?->topic_name,
            'scheduled_for'     => optional($t->scheduled_for)->toDateString(),
            'estimated_minutes' => $t->estimated_minutes,
        ];
    }

    /** The single next action — same priority as frontend NextStep.pickNext. */
    protected function pickNext($todayTasks, int $fixCount, ?string $fixTop, int $dueCards): array
    {
        if ($todayTasks->isNotEmpty()) {
            return ['type' => 'plan', 'label' => "Today's plan: " . $todayTasks->first()['title']];
        }
        if ($fixCount > 0) {
            return ['type' => 'fix', 'label' => $fixTop ? "Fix: {$fixTop}" : "Fix {$fixCount} weak spot" . ($fixCount === 1 ? '' : 's')];
        }
        if ($dueCards > 0) {
            return ['type' => 'cards', 'label' => "Review {$dueCards} card" . ($dueCards === 1 ? '' : 's')];
        }
        return ['type' => 'ask', 'label' => 'Ask your tutor a question'];
    }
}
