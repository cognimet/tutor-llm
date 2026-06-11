<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\ProgressService;
use Illuminate\Http\Request;

class ParentController extends Controller
{
    public function __construct(protected ProgressService $progress) {}

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

    // Detailed report for one child (parent must own the link).
    public function childReport(Request $request, User $child)
    {
        $parent = $request->user();
        abort_unless($parent->children()->where('users.id', $child->id)->exists(), 403, 'Not your child.');

        return response()->json([
            'child'    => $child->only(['id', 'name', 'email', 'board', 'grade']) + ['curriculum_path' => $child->curriculum_path],
            'progress' => $this->progress->summary($child),
            'gaps'     => $child->knowledgeGaps()->where('resolved', false)->latest()->get(),
            'recent_assessments' => $child->assessments()
                ->where('status', 'completed')->latest()->take(10)
                ->get(['id', 'topic_name', 'score', 'total', 'completed_at']),
            'plans'    => $child->learningPlans()->with('items')->where('status', 'active')->get(),
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
}
