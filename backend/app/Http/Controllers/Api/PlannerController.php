<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StudyPlan;
use App\Models\StudyPlanTask;
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
    ) {}

    /** GET /tutor/planner?topic_id=&topic_name= — active plans + countdown. */
    public function index(Request $request)
    {
        $plans = $request->user()->studyPlans()
            ->with('tasks')
            ->where('status', 'active')
            ->when($request->filled('topic_id'),
                fn ($q) => $q->where('topic_id', $request->integer('topic_id')),
                fn ($q) => $q->where('topic_name', (string) $request->query('topic_name')))
            ->latest()
            ->get();

        return response()->json([
            'plans'     => $plans,
            'exam_date' => $this->soonestExam($plans),
        ]);
    }

    /** POST /tutor/planner/generate */
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['required', 'string', 'max:160'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'horizon'      => ['required', 'in:day,week,month,exam'],
            'exam_date'    => ['nullable', 'date', 'after_or_equal:today',
                               'required_if:horizon,exam'],
        ]);

        $plan = $this->planner->generate($request->user(), $data, $data['horizon'], $data['exam_date'] ?? null);

        abort_if($plan->tasks->isEmpty(), 422,
            'The planner couldn\'t build a schedule just now — it may be rate-limited. Try again in a moment.');

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
}
