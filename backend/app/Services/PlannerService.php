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

        $gaps = $isSubject ? $this->openGapsForSubject($user, $ctx['subject_id'] ?? null)
                           : $this->openGaps($user, $label);

        $built = $this->ai->studySchedule([
            'topic'          => $label,
            'horizon'        => $horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, $ctx),
            'gaps'           => $gaps,
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
            'meta'         => [
                'summary'  => $built['summary'] ?? '',
                'scope'    => $isSubject ? 'subject' : 'topic',
                // Remember which uploaded notes this plan was built from, so it
                // stays isolated to them (and replan keeps the same scope).
                'note_ids' => array_values(array_filter(array_map('intval', $ctx['note_ids'] ?? []))),
            ],
        ]);

        // Never ship an empty plan: if the LLM returned nothing (rate-limited /
        // empty), fall back to a sensible deterministic schedule.
        $tasks = ! empty($built['tasks']) ? $built['tasks']
            : $this->defaultTasks($horizon, $label, $daysRemaining, $gaps);
        $this->writeTasks($plan, $tasks, $exam, $daysRemaining);

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
            : ['topic_name' => $plan->topic_name, 'topic_id' => $plan->topic_id, 'note_ids' => $plan->meta['note_ids'] ?? []];

        $label = $isSubject ? ($plan->subject_name ?? $plan->topic_name) : $plan->topic_name;
        $gaps = $isSubject ? $this->openGapsForSubject($user, $plan->subject_id)
                           : $this->openGaps($user, $plan->topic_name);

        $built = $this->ai->studySchedule([
            'topic'          => $label,
            'horizon'        => $plan->horizon,
            'days_remaining' => $daysRemaining,
            'exam_date'      => $exam?->toDateString(),
            'notes_summary'  => $this->notesSummary($user, $ctx),
            'gaps'           => $gaps,
            'mastery'        => $isSubject ? 0 : $this->masteryFor($user, $plan->topic_name),
            'from_notes'     => (bool) $plan->from_notes,
        ]);
        $this->meterLast($user, 'plan');

        // Preserve completed history; replace everything still to do.
        $plan->tasks()->where('status', 'todo')->delete();
        $tasks = ! empty($built['tasks']) ? $built['tasks']
            : $this->defaultTasks($plan->horizon, $label, $daysRemaining, $gaps);
        $this->writeTasks($plan, $tasks, $exam, $daysRemaining);
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

    /**
     * Deterministic fallback schedule used when the LLM returns no tasks (free-tier
     * rate-limit / empty response), so the planner never produces an empty plan.
     * Builds a learn → practise → revise → assess sequence around the open gaps
     * (or the topic/subject label when there are none).
     *
     * @param  array  $gaps  [['concept'=>..,'severity'=>..], ...]
     * @return array<int,array<string,mixed>>  tasks in the AI schedule shape
     */
    protected function defaultTasks(string $horizon, string $label, ?int $daysRemaining, array $gaps = []): array
    {
        $concepts = array_values(array_filter(array_map(
            fn ($g) => is_array($g) ? ($g['concept'] ?? null) : null, $gaps)));
        $focus = ! empty($concepts) ? array_slice($concepts, 0, 6) : [$label];

        $mk = fn (int $day, string $kind, string $title, string $detail, ?string $concept = null, int $min = 25): array => [
            'day_index' => $day, 'kind' => $kind, 'title' => $title,
            'detail' => $detail, 'concept' => $concept, 'estimated_minutes' => $min,
        ];

        if ($horizon === 'day') {
            $c = $focus[0];
            return [
                $mk(0, 'learn', "Understand {$label}", "Read your notes for {$label} and write the key ideas in your own words.", $c, 30),
                $mk(0, 'practice', "Practise {$label}", "Solve 5 questions or worked examples on {$label}.", $c, 25),
                $mk(0, 'revise', 'Quick revision', "Make a 5-point summary of {$label} you can revise later.", null, 15),
            ];
        }

        if ($horizon === 'exam') {
            $span = max(1, $daysRemaining ?? 7);
            $tasks = [];
            $n = max(count($focus), 1);
            foreach ($focus as $i => $c) {
                $day = $n > 1 ? (int) floor($i * ($span - 1) / max(1, $n - 1)) : 0;
                $tasks[] = $mk($day, 'learn', "Master {$c}", "Revise {$c} from your notes and clear any doubts.", $c, 35);
                $tasks[] = $mk($day, 'practice', "Practise {$c}", "Solve previous-year / textbook questions on {$c}.", $c, 30);
            }
            $tasks[] = $mk(max(0, $span - 2), 'revise', 'Full revision', 'Revise all key formulas, definitions and diagrams.', null, 40);
            $tasks[] = $mk(max(0, $span - 1), 'assess', 'Mock test', "Take a timed self-test covering {$label}.", null, 45);
            return $tasks;
        }

        // week (default) and month
        $span = $horizon === 'month' ? 28 : 7;
        $step = $horizon === 'month' ? 4 : 1;
        $tasks = [];
        $day = 0;
        foreach ($focus as $c) {
            $d = min($span - 1, $day);
            $tasks[] = $mk($d, 'learn', "Learn {$c}", "Study {$c} from your notes and textbook.", $c, 30);
            $tasks[] = $mk($d, 'practice', "Practise {$c}", "Solve questions on {$c}.", $c, 25);
            $day += $step;
            if ($day >= $span) break;
        }
        $tasks[] = $mk(max(0, $span - 2), 'revise', "Revise {$label}", 'Summarise everything you have learned so far.', null, 20);
        $tasks[] = $mk($span - 1, 'assess', "Self-test {$label}", 'Take a short quiz to check your understanding.', null, 30);
        return $tasks;
    }

    protected function notesSummary(User $user, array $ctx): string
    {
        $noteIds = array_values(array_filter(array_map('intval', $ctx['note_ids'] ?? [])));
        $isSubject = ($ctx['scope'] ?? null) === 'subject';
        // Build from the note's ACTUAL content (not just a gist) whenever the plan
        // is notes-driven — a subject plan or one isolated to specific notes.
        $richContent = $isSubject || ! empty($noteIds);
        $q = $user->notes()->where('status', 'ready');

        if (! empty($noteIds)) {
            // Isolate the plan to EXACTLY the notes the student is studying — never
            // bleed in other notes (incl. stale ones) from the same topic/subject.
            $q->whereIn('id', $noteIds);
        } elseif ($isSubject && (! empty($ctx['subject_id']) || ! empty($ctx['subject_name']))) {
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
            if ($richContent) {
                $excerpt = trim((string) $n->extracted_text);
                if ($excerpt !== '') {
                    $body = ($body !== '' ? $body . "\n" : '') . mb_substr($excerpt, 0, 900);
                }
            }
            if ($body !== '') {
                $parts[] = "{$star}# {$n->title}\n{$body}";
            }
        }

        return mb_substr(implode("\n\n", $parts), 0, $richContent ? 7000 : 2400);
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
