<?php

namespace App\Services;

use App\Models\StudyPlan;
use App\Models\User;
use Carbon\Carbon;

/**
 * Builds Day / Week / Month / Exam study plans from the student's notes,
 * open knowledge gaps and current mastery, mapping the AI's day-offset tasks
 * onto real calendar dates. replan() adapts a live plan to what's left.
 */
class PlannerService
{
    public function __construct(
        protected AiClient $ai,
        protected TokenMeter $meter,
        protected MindService $mind,
    ) {}

    /**
     * @param array $ctx  ['topic_id','topic_name','chapter_name','subject_name']
     */
    public function generate(User $user, array $ctx, string $horizon, ?string $examDate = null): StudyPlan
    {
        $topicName = $ctx['topic_name'];
        $exam = $examDate ? Carbon::parse($examDate)->startOfDay() : null;
        $daysRemaining = $exam ? max(1, Carbon::today()->diffInDays($exam, false)) : null;

        $built = $this->ai->studySchedule([
            'topic'          => $topicName,
            'horizon'        => $horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, $ctx),
            'gaps'           => $this->openGaps($user, $topicName),
            'mastery'        => $this->masteryFor($user, $topicName),
        ]);
        $this->meterLast($user, 'plan');

        // Keep the topic tidy: archive prior active plans of the same horizon.
        $user->studyPlans()
            ->where('topic_name', $topicName)
            ->where('horizon', $horizon)
            ->where('status', 'active')
            ->update(['status' => 'archived']);

        $plan = $user->studyPlans()->create([
            'topic_id'   => $ctx['topic_id'] ?? null,
            'topic_name' => $topicName,
            'horizon'    => $horizon,
            'exam_date'  => $exam?->toDateString(),
            'title'      => $built['title'] ?: $this->defaultTitle($horizon, $topicName),
            'status'     => 'active',
            'meta'       => ['summary' => $built['summary'] ?? ''],
        ]);

        $this->writeTasks($plan, $built['tasks'] ?? [], $exam, $daysRemaining);

        return $plan->load('tasks');
    }

    /** Regenerate the remaining (todo) tasks against days-left + current gaps. */
    public function replan(StudyPlan $plan): StudyPlan
    {
        $user = $plan->user;
        $exam = $plan->exam_date ? Carbon::parse($plan->exam_date)->startOfDay() : null;
        $daysRemaining = $exam ? max(1, Carbon::today()->diffInDays($exam, false)) : null;

        $built = $this->ai->studySchedule([
            'topic'          => $plan->topic_name,
            'horizon'        => $plan->horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, ['topic_name' => $plan->topic_name, 'topic_id' => $plan->topic_id]),
            'gaps'           => $this->openGaps($user, $plan->topic_name),
            'mastery'        => $this->masteryFor($user, $plan->topic_name),
        ]);
        $this->meterLast($user, 'plan');

        // Preserve completed history; replace everything still to do.
        $plan->tasks()->where('status', 'todo')->delete();
        $this->writeTasks($plan, $built['tasks'] ?? [], $exam, $daysRemaining);
        $plan->update(['meta' => array_merge($plan->meta ?? [], [
            'summary'      => $built['summary'] ?? ($plan->meta['summary'] ?? ''),
            'replanned_at' => now()->toIso8601String(),
        ])]);

        return $plan->load('tasks');
    }

    /* ----------------------------------------------------------------- */

    protected function writeTasks(StudyPlan $plan, array $tasks, ?Carbon $exam, ?int $daysRemaining): void
    {
        $today = Carbon::today();
        foreach (array_values($tasks) as $i => $t) {
            $dayIndex = max(0, (int) ($t['day_index'] ?? 0));
            // For exam plans, never schedule past the exam day.
            if ($daysRemaining !== null) {
                $dayIndex = min($dayIndex, $daysRemaining - 1);
            }
            $plan->tasks()->create([
                'scheduled_for'     => $today->copy()->addDays($dayIndex)->toDateString(),
                'day_index'         => $dayIndex,
                'title'             => (string) ($t['title'] ?? 'Study task'),
                'detail'            => $t['detail'] ?? null,
                'concept'           => $t['concept'] ?? null,
                'kind'              => in_array($t['kind'] ?? 'learn', ['learn', 'practice', 'revise', 'assess'], true)
                                        ? $t['kind'] : 'learn',
                'estimated_minutes' => (int) ($t['estimated_minutes'] ?? 20),
                'position'          => $i,
            ]);
        }
    }

    protected function notesSummary(User $user, array $ctx): string
    {
        $notes = $user->notes()
            ->where('status', 'ready')
            ->when(! empty($ctx['topic_id']),
                fn ($q) => $q->where('topic_id', $ctx['topic_id']),
                fn ($q) => $q->where('topic_name', $ctx['topic_name'] ?? ''))
            ->latest()->take(8)->get(['title', 'summary']);

        $parts = [];
        foreach ($notes as $n) {
            if (trim((string) $n->summary) !== '') {
                $parts[] = "• {$n->title}: {$n->summary}";
            }
        }
        return mb_substr(implode("\n", $parts), 0, 1800);
    }

    protected function openGaps(User $user, string $topicName): array
    {
        return $user->knowledgeGaps()
            ->where('resolved', false)
            ->where('topic_name', $topicName)
            ->get()
            ->map(fn ($g) => ['concept' => $g->concept, 'severity' => $g->severity])
            ->toArray();
    }

    protected function masteryFor(User $user, string $topicName): int
    {
        try {
            return (int) ($this->mind->mind($user, $topicName)['composite_mastery'] ?? 0);
        } catch (\Throwable) {
            return 0;
        }
    }

    protected function defaultTitle(string $horizon, string $topic): string
    {
        return match ($horizon) {
            'day'   => "Today's plan — {$topic}",
            'month' => "Month plan — {$topic}",
            'exam'  => "Exam plan — {$topic}",
            default => "Week plan — {$topic}",
        };
    }

    protected function meterLast(User $user, string $action): void
    {
        if (! empty($this->ai->lastUsage)) {
            $this->meter->record($user, $action, $this->ai->lastUsage, []);
        }
    }
}
