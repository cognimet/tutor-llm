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
    /**
     * @param array $ctx  topic scope: ['topic_id','topic_name','chapter_name','subject_name']
     *                    subject scope: ['scope'=>'subject','subject_id','subject_name','from_notes'=>true]
     */
    public function generate(User $user, array $ctx, string $horizon, ?string $examDate = null): StudyPlan
    {
        $isSubject = ($ctx['scope'] ?? 'topic') === 'subject';
        $label = $isSubject ? ($ctx['subject_name'] ?? 'your subject') : ($ctx['topic_name'] ?? '');
        $exam = $examDate ? Carbon::parse($examDate)->startOfDay() : null;
        $daysRemaining = $exam ? max(1, Carbon::today()->diffInDays($exam, false)) : null;

        $built = $this->ai->studySchedule([
            'topic'          => $label,
            'horizon'        => $horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, $ctx),
            'gaps'           => $isSubject ? $this->openGapsForSubject($user, $ctx['subject_id'] ?? null)
                                           : $this->openGaps($user, $label),
            'mastery'        => $isSubject ? 0 : $this->masteryFor($user, $label),
            'from_notes'     => (bool) ($ctx['from_notes'] ?? $isSubject),
        ]);
        $this->meterLast($user, 'plan');

        // Archive prior active plans of the same scope + horizon.
        $stale = $user->studyPlans()->where('horizon', $horizon)->where('status', 'active');
        $isSubject ? $stale->where('scope', 'subject')->where('subject_id', $ctx['subject_id'] ?? null)
                   : $stale->where('scope', 'topic')->where('topic_name', $label);
        $stale->update(['status' => 'archived']);

        $plan = $user->studyPlans()->create([
            'scope'        => $isSubject ? 'subject' : 'topic',
            'subject_id'   => $ctx['subject_id'] ?? null,
            'subject_name' => $ctx['subject_name'] ?? null,
            'from_notes'   => (bool) ($ctx['from_notes'] ?? $isSubject),
            'topic_id'     => $isSubject ? null : ($ctx['topic_id'] ?? null),
            // topic_name doubles as the display/index name; for a subject plan it's the subject.
            'topic_name'   => $label,
            'horizon'      => $horizon,
            'exam_date'    => $exam?->toDateString(),
            'title'        => $built['title'] ?: $this->defaultTitle($horizon, $label),
            'status'       => 'active',
            'meta'         => ['summary' => $built['summary'] ?? '', 'scope' => $isSubject ? 'subject' : 'topic'],
        ]);

        $this->writeTasks($plan, $built['tasks'] ?? [], $exam, $daysRemaining);

        return $plan->load('tasks');
    }

    /** Regenerate the remaining (todo) tasks against days-left + current gaps. */
    public function replan(StudyPlan $plan): StudyPlan
    {
        $user = $plan->user;
        $isSubject = $plan->scope === 'subject';
        $exam = $plan->exam_date ? Carbon::parse($plan->exam_date)->startOfDay() : null;
        $daysRemaining = $exam ? max(1, Carbon::today()->diffInDays($exam, false)) : null;

        $ctx = $isSubject
            ? ['scope' => 'subject', 'subject_id' => $plan->subject_id, 'subject_name' => $plan->subject_name]
            : ['topic_name' => $plan->topic_name, 'topic_id' => $plan->topic_id];

        $built = $this->ai->studySchedule([
            'topic'          => $isSubject ? ($plan->subject_name ?? $plan->topic_name) : $plan->topic_name,
            'horizon'        => $plan->horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, $ctx),
            'gaps'           => $isSubject ? $this->openGapsForSubject($user, $plan->subject_id)
                                           : $this->openGaps($user, $plan->topic_name),
            'mastery'        => $isSubject ? 0 : $this->masteryFor($user, $plan->topic_name),
            'from_notes'     => (bool) $plan->from_notes,
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
        $isSubject = ($ctx['scope'] ?? null) === 'subject';
        $q = $user->notes()->where('status', 'ready');

        if ($isSubject && (! empty($ctx['subject_id']) || ! empty($ctx['subject_name']))) {
            // Match by subject id OR name, so notes are never missed if the id
            // didn't resolve at upload time.
            $q->where(function ($w) use ($ctx) {
                if (! empty($ctx['subject_id']))   $w->orWhere('subject_id', $ctx['subject_id']);
                if (! empty($ctx['subject_name'])) $w->orWhere('subject_name', $ctx['subject_name']);
            });
        } elseif (! empty($ctx['topic_id'])) {
            $q->where(fn ($w) => $w->where('topic_id', $ctx['topic_id'])
                ->orWhere('subject_id', $ctx['subject_id'] ?? 0));
        } else {
            $q->where('topic_name', $ctx['topic_name'] ?? '');
        }

        $notes = $q->latest()->take(12)->get(['title', 'summary', 'extracted_text', 'is_primary']);

        $parts = [];
        foreach ($notes->sortByDesc('is_primary') as $n) {              // ★ primary notes first
            $star = $n->is_primary ? '★ ' : '';
            $body = trim((string) $n->summary);
            // For a notes-driven (subject) plan, include the note's ACTUAL content
            // so the plan mirrors what's really in the PDF — not just a gist.
            if ($isSubject) {
                $excerpt = trim((string) $n->extracted_text);
                if ($excerpt !== '') {
                    $body = ($body !== '' ? $body . "\n" : '') . mb_substr($excerpt, 0, 900);
                }
            }
            if ($body !== '') {
                $parts[] = "{$star}# {$n->title}\n{$body}";
            }
        }

        return mb_substr(implode("\n\n", $parts), 0, $isSubject ? 7000 : 2400);
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

    /** Unresolved gaps across every topic in a subject (for subject-wide plans). */
    protected function openGapsForSubject(User $user, ?int $subjectId): array
    {
        $q = $user->knowledgeGaps()->where('resolved', false);
        $topicNames = $this->subjectTopicNames($subjectId);
        if (! empty($topicNames)) {
            $q->whereIn('topic_name', $topicNames);
        }
        return $q->take(30)->get()
            ->map(fn ($g) => ['concept' => $g->concept, 'severity' => $g->severity])
            ->toArray();
    }

    /** Topic names under a subject (via its chapters). */
    protected function subjectTopicNames(?int $subjectId): array
    {
        if (! $subjectId) {
            return [];
        }
        return \App\Models\Topic::whereHas('chapter', fn ($q) => $q->where('subject_id', $subjectId))
            ->pluck('name')->all();
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
