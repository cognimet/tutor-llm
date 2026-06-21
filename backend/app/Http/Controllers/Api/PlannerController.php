<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StudyPlan;
use App\Models\StudyPlanTask;
use App\Services\CurriculumResolver;
use App\Services\EventTracker;
use App\Services\PlannerService;
use App\Services\ProgressService;
use Illuminate\Http\Request;
use Carbon\Carbon;

/**
 * Day / Week / Month / Exam study planner. Plans are built from the student's
 * notes, open gaps and mastery, and surface a live exam countdown.
 */
class PlannerController extends Controller
{
    public function __construct(
        protected PlannerService $planner,
        protected ProgressService $progress,
        protected EventTracker $events,
        protected CurriculumResolver $resolver,
    ) {}

    /** GET /tutor/planner?scope=&topic_id=&topic_name=&subject_name= — active plans + countdown. */
    public function index(Request $request)
    {
        $user = $request->user();
        $q = $user->studyPlans()->with('tasks')->where('status', 'active');

        if ($request->query('scope') === 'subject') {
            $subjectId = $this->resolver->subjectId(
                $user, $request->filled('topic_id') ? $request->integer('topic_id') : null,
                $request->query('subject_name'),
            );
            $q->where('scope', 'subject')->when($subjectId, fn ($x) => $x->where('subject_id', $subjectId));
        } else {
            $q->where('scope', 'topic')->when($request->filled('topic_id'),
                fn ($x) => $x->where('topic_id', $request->integer('topic_id')),
                fn ($x) => $x->where('topic_name', (string) $request->query('topic_name')));
        }

        $plans = $q->latest()->get();

        return response()->json([
            'plans'     => $plans,
            'exam_date' => $this->soonestExam($plans),
        ]);
    }

    /** POST /tutor/planner/generate — topic plan, or a subject-wide plan from the student's notes. */
    public function generate(Request $request)
    {
        $data = $request->validate([
            'scope'        => ['nullable', 'in:topic,subject'],
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['nullable', 'string', 'max:160', 'required_unless:scope,subject'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160', 'required_if:scope,subject'],
            'from_notes'   => ['nullable', 'boolean'],
            'note_ids'     => ['nullable', 'array'],   // isolate the plan to these uploaded notes
            'note_ids.*'   => ['integer'],
            'horizon'      => ['required', 'in:day,week,month,exam'],
            'exam_date'    => ['nullable', 'date', 'after_or_equal:today',
                               'required_if:horizon,exam'],
        ]);

        $user = $request->user();
        $ctx = $data;
        if (($data['scope'] ?? 'topic') === 'subject') {
            $ctx['scope'] = 'subject';
            $ctx['subject_id'] = $this->resolver->subjectId($user, $data['topic_id'] ?? null, $data['subject_name'] ?? null);
            $ctx['from_notes'] = true;
        }

        $plan = $this->planner->generate($user, $ctx, $data['horizon'], $data['exam_date'] ?? null);

        abort_if($plan->tasks->isEmpty(), 422,
            'The planner couldn\'t build a schedule just now — it may be rate-limited. Try again in a moment.');

        $this->events->track(
            $user, EventTracker::PLAN_GENERATED,
            "Generated a {$data['horizon']} " . ($plan->scope === 'subject' ? 'subject ' : '')
            . "study plan for {$plan->topic_name} ({$plan->tasks->count()} tasks)",
            $plan->topic_name, $plan->topic_id, [],
            ['horizon' => $data['horizon'], 'plan_id' => $plan->id, 'scope' => $plan->scope,
             'from_notes' => $plan->from_notes, 'exam_date' => $data['exam_date'] ?? null],
        );

        return response()->json(['plan' => $plan], 201);
    }

    /** POST /tutor/planner/{plan}/replan — adapt the remaining tasks. */
    public function replan(Request $request, StudyPlan $plan)
    {
        $this->authorizePlan($request, $plan);
        return response()->json(['plan' => $this->planner->replan($plan)]);
    }

    /** PATCH /tutor/planner/tasks/{task}/toggle */
    public function toggleTask(Request $request, StudyPlanTask $task)
    {
        $plan = $task->plan;
        abort_unless($plan && $plan->user_id === $request->user()->id, 403);

        $task->status = $task->status === 'done' ? 'todo' : 'done';
        $task->save();

        if ($task->status === 'done') {
            $this->progress->recordActivity($request->user(), masteryDelta: 1);
            $this->events->track(
                $request->user(), EventTracker::PLAN_TASK_DONE,
                "Completed plan task: {$task->title}",
                $plan->topic_name, $plan->topic_id,
                $task->concept ? [$task->concept] : [],
                ['task_id' => $task->id, 'kind' => $task->kind],
            );
        }

        return response()->json(['task' => $task]);
    }

    /** DELETE /tutor/planner/{plan} — archive a plan. */
    public function destroy(Request $request, StudyPlan $plan)
    {
        $this->authorizePlan($request, $plan);
        $plan->update(['status' => 'archived']);
        return response()->json(['archived' => true]);
    }

    /**
     * POST /tutor/planner/cover — a student cleared an in-chat Progress Gate.
     * If the checkpoint maps onto a todo task in the topic's active plan, tick
     * that task off automatically so the study-plan checklist reflects what the
     * student just proved they know. Returns the updated task (or null).
     */
    public function cover(Request $request)
    {
        $data = $request->validate([
            'topic_id'     => ['nullable', 'integer'],
            'topic_name'   => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'text'         => ['required', 'string', 'max:4000'], // the gate question/checkpoint text
            'concept'      => ['nullable', 'string', 'max:200'],
        ]);

        $user = $request->user();

        // Active topic plans in scope (mirrors index()'s topic branch).
        $plans = $user->studyPlans()->with('tasks')->where('status', 'active')->where('scope', 'topic')
            ->when($request->filled('topic_id'),
                fn ($x) => $x->where('topic_id', (int) $data['topic_id']),
                fn ($x) => $x->where('topic_name', (string) ($data['topic_name'] ?? '')))
            ->get();

        $todo = $plans->flatMap->tasks->filter(fn ($t) => $t->status !== 'done');
        $needle = trim(($data['concept'] ?? '') . ' ' . $data['text']);
        $task = $this->bestTaskMatch($todo, $needle);

        if (! $task) {
            return response()->json(['task' => null, 'matched' => false]);
        }

        $task->status = 'done';
        $task->save();

        $plan = $task->plan;
        $this->progress->recordActivity($user, masteryDelta: 1);
        $this->events->track(
            $user, EventTracker::PLAN_TASK_DONE,
            "Cleared a checkpoint covering plan task: {$task->title}",
            $plan?->topic_name, $plan?->topic_id,
            $task->concept ? [$task->concept] : [],
            ['task_id' => $task->id, 'kind' => $task->kind, 'via' => 'progress_gate'],
        );

        return response()->json(['task' => $task, 'matched' => true]);
    }

    /* ----------------------------------------------------------------- */

    protected function soonestExam($plans): ?string
    {
        $dates = $plans->pluck('exam_date')->filter()->map(fn ($d) => Carbon::parse($d));
        return $dates->isEmpty() ? null : $dates->sort()->first()->toDateString();
    }

    protected function authorizePlan(Request $request, StudyPlan $plan): void
    {
        abort_unless($plan->user_id === $request->user()->id, 403, 'Not your plan.');
    }

    /**
     * Token-overlap match: pick the todo task whose concept/title is best covered
     * by the cleared gate's text. Conservative on purpose — an unrelated gate
     * should never tick a task — so a match needs either the task's concept
     * mostly present, or at least two meaningful shared keywords.
     */
    protected function bestTaskMatch($tasks, string $needle): ?StudyPlanTask
    {
        $nk = $this->keywords($needle);
        if (empty($nk)) return null;

        $best = null; $bestHits = 0; $bestScore = 0.0;
        foreach ($tasks as $task) {
            $taskTokens = $this->keywords(trim(($task->concept ?? '') . ' ' . $task->title . ' ' . ($task->detail ?? '')));
            if (empty($taskTokens)) continue;

            $hits = 0;
            foreach ($taskTokens as $w) if ($this->covered($nk, $w)) $hits++;
            $score = $hits / count($taskTokens);

            // Strong signal: the task's own concept phrase is mostly present.
            $conceptCovered = false;
            if ($task->concept) {
                $cTok = $this->keywords($task->concept);
                if ($cTok) {
                    $cHits = 0; foreach ($cTok as $w) if ($this->covered($nk, $w)) $cHits++;
                    $conceptCovered = ($cHits / count($cTok)) >= 0.6;
                }
            }

            if (($conceptCovered || $hits >= 2)
                && ($hits > $bestHits || ($hits === $bestHits && $score > $bestScore))) {
                $best = $task; $bestHits = $hits; $bestScore = $score;
            }
        }

        return $best;
    }

    /**
     * A task keyword is "covered" by the gate text if a needle keyword equals it,
     * or (both ≥ 4 chars) one is a prefix of the other — so morphological variants
     * like group/grouping and classify/classifying still line up.
     */
    protected function covered(array $needleKeywords, string $w): bool
    {
        foreach ($needleKeywords as $n) {
            if ($n === $w) return true;
            if (strlen($n) >= 4 && strlen($w) >= 4 && (str_starts_with($n, $w) || str_starts_with($w, $n))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Normalise a phrase into a set of meaningful keywords: lowercase, strip
     * punctuation, drop stop-words and very short words, and apply a tiny,
     * CONSISTENT plural stem (applied to both sides, so "tree"/"trees" match).
     */
    protected function keywords(string $s): array
    {
        static $stop = [
            'the','and','for','with','what','which','best','describe','this','that','your','you','about',
            'into','than','then','these','those','their','they','them','our','was','were','will','can',
            'could','would','should','here','there','when','where','how','why','does','did','are','from','three',
        ];
        $s = strtolower($s);
        $s = preg_replace('/[^a-z0-9\s]+/', ' ', $s);
        $out = [];
        foreach (preg_split('/\s+/', trim($s)) as $w) {
            if (strlen($w) <= 2) continue;
            $w = $this->stem($w);
            if (strlen($w) <= 2 || in_array($w, $stop, true)) continue;
            $out[$w] = true;
        }
        return array_keys($out);
    }

    /**
     * Tiny, CONSISTENT plural stem (applied to both sides so tree/trees match).
     * Sibilant-aware so "branches" → "branch" but "trees" → "tree" (not "tre").
     */
    protected function stem(string $w): string
    {
        if (strlen($w) > 4 && str_ends_with($w, 'ies')) return substr($w, 0, -3) . 'y';
        if (strlen($w) > 4 && preg_match('/(s|x|z|ch|sh)es$/', $w)) return substr($w, 0, -2);
        if (strlen($w) > 3 && str_ends_with($w, 's') && ! str_ends_with($w, 'ss')) return substr($w, 0, -1);
        return $w;
    }
}
