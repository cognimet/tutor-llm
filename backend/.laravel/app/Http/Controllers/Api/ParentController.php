<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TokenLedger;
use App\Models\User;
use App\Services\ProgressService;
use App\Services\TokenMeter;
use App\Services\TutorService;
use Illuminate\Http\Request;

class ParentController extends Controller
{
    public function __construct(
        protected ProgressService $progress,
        protected TutorService $tutor,
        protected TokenMeter $meter,
    ) {}

    // List the children linked to this parent, with a quick progress snapshot.
    public function children(Request $request)
    {
        $parent = $request->user();

        $children = $parent->children()->get()->map(function (User $child) {
            $summary = $this->progress->summary($child);
            return [
                'id'       => $child->id,
                'name'     => $child->name,
                'email'    => $child->email,
                'board'    => $child->board,
                'grade'    => $child->grade,
                'curriculum_path' => $child->curriculum_path,
                'progress' => $summary,
            ];
        });

        return response()->json(['children' => $children]);
    }

    // Detailed report for one child (parent must own the link), including a
    // plain-language AI summary (master prompt Part F).
    public function childReport(Request $request, User $child)
    {
        $this->authorizeChild($request, $child);

        $progress = $this->progress->summary($child);
        $gaps = $child->knowledgeGaps()->where('resolved', false)->latest()->get();
        $recent = $child->assessments()
            ->where('status', 'completed')->latest()->take(10)
            ->get(['id', 'topic_name', 'score', 'total', 'completed_at']);

        // Plain-language AI report for a non-technical parent on a phone.
        $aiReport = null;
        if ($request->boolean('ai_summary', true)) {
            $built = $this->tutor->parentReport($child, 'weekly', [
                'progress' => $progress,
                'open_gaps' => $gaps->map(fn ($g) => $g->concept)->take(6)->all(),
                'recent_scores' => $recent->map(fn ($a) => "{$a->topic_name}: {$a->score}/{$a->total}")->take(6)->all(),
            ]);
            $aiReport = $built['report'] ?: null;
            if (! empty($built['usage'])) {
                $this->meter->meter($child, 'report', $built['usage']);
            }
        }

        return response()->json([
            'child'    => $child->only(['id', 'name', 'email', 'board', 'grade']) + ['curriculum_path' => $child->curriculum_path],
            'progress' => $progress,
            'gaps'     => $gaps,
            'recent_assessments' => $recent,
            'plans'    => $child->learningPlans()->with('items')->where('status', 'active')->get(),
            'ai_report' => $aiReport,
        ]);
    }

    // Child's AI usage — credits only, never raw tokens (token spec §8).
    // Parents are the payers: give them visibility and control.
    public function childUsage(Request $request, User $child)
    {
        $this->authorizeChild($request, $child);

        $dayExpr = \Illuminate\Support\Facades\DB::connection()->getDriverName() === 'sqlite'
            ? "strftime('%Y-%m-%d', created_at)"
            : "to_char(created_at, 'YYYY-MM-DD')";

        $byDay = TokenLedger::where('user_id', $child->id)
            ->where('created_at', '>=', now()->subDays(14)->startOfDay())
            ->selectRaw("{$dayExpr} as day, SUM(credits_charged) as credits")
            ->groupBy('day')->orderBy('day')->get();

        $byAction = TokenLedger::where('user_id', $child->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->selectRaw('action_type, SUM(credits_charged) as credits, COUNT(*) as calls')
            ->groupBy('action_type')->get();

        return response()->json([
            'summary' => $this->meter->summary($child),
            'by_day' => $byDay,
            'by_action' => $byAction,
        ]);
    }

    // Link a child by email (parent self-service).
    public function linkChild(Request $request)
    {
        $data = $request->validate([
            'child_email'  => ['required', 'email', 'exists:users,email'],
            'relationship' => ['nullable', 'string', 'max:40'],
        ]);

        $child = User::where('email', $data['child_email'])->where('role', 'student')->first();
        abort_unless($child, 422, 'No student account found for that email.');

        $request->user()->children()->syncWithoutDetaching([
            $child->id => ['relationship' => $data['relationship'] ?? 'guardian'],
        ]);

        return response()->json(['message' => 'Child linked.', 'child' => $child->only(['id', 'name', 'email'])]);
    }

    protected function authorizeChild(Request $request, User $child): void
    {
        abort_unless(
            $request->user()->children()->where('users.id', $child->id)->exists(),
            403, 'Not your child.'
        );
    }
}
