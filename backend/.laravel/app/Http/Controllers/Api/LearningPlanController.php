<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LearningPlan;
use App\Models\LearningPlanItem;
use App\Services\ProgressService;
use App\Services\TutorService;
use Illuminate\Http\Request;

class LearningPlanController extends Controller
{
    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
    ) {}

    public function index(Request $request)
    {
        $plans = $request->user()->learningPlans()
            ->with('items')->where('status', 'active')->latest()->get();

        return response()->json(['plans' => $plans]);
    }

    // Generate a light next-steps plan from the student's open gaps (AI).
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_name' => ['required', 'string', 'max:160'],
        ]);

        $user = $request->user();
        $gaps = $user->knowledgeGaps()
            ->where('resolved', false)
            ->where('topic_name', $data['topic_name'])
            ->get()
            ->map(fn ($g) => ['concept' => $g->concept, 'severity' => $g->severity])
            ->toArray();

        $built = $this->tutor->buildLearningPlan($user, $data['topic_name'], $gaps);

        $plan = $user->learningPlans()->create([
            'title'      => $built['title'],
            'topic_name' => $data['topic_name'],
            'status'     => 'active',
        ]);

        foreach ($built['items'] as $i => $item) {
            $plan->items()->create([
                'title'             => $item['title'],
                'detail'            => $item['detail'],
                'concept'           => $item['concept'],
                'estimated_minutes' => $item['estimated_minutes'],
                'position'          => $i,
            ]);
        }

        return response()->json(['plan' => $plan->load('items')], 201);
    }

    // Toggle a plan item done/todo. Marking done may close a matching gap.
    public function toggleItem(Request $request, LearningPlanItem $item)
    {
        $plan = $item->plan;
        abort_unless($plan && $plan->user_id === $request->user()->id, 403);

        $item->status = $item->status === 'done' ? 'todo' : 'done';
        $item->save();

        if ($item->status === 'done' && $item->concept) {
            $gap = $request->user()->knowledgeGaps()
                ->where('resolved', false)
                ->where('concept', $item->concept)
                ->where('topic_name', $plan->topic_name)
                ->first();
            if ($gap) {
                $gap->update(['resolved' => true]);
                $this->progress->recordActivity($request->user(), gapsClosed: 1, masteryDelta: 4);
            }
        }

        return response()->json(['item' => $item]);
    }
}
