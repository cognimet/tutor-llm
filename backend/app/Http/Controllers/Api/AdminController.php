<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\ChatSession;
use App\Models\Subject;
use App\Models\User;
use App\Services\ProgressService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    public function __construct(protected ProgressService $progress) {}

    // Platform-wide stats for the admin dashboard.
    public function stats()
    {
        return response()->json([
            'stats' => [
                'students'        => User::where('role', 'student')->count(),
                'parents'         => User::where('role', 'parent')->count(),
                'admins'          => User::where('role', 'admin')->count(),
                'teachers'        => User::where('role', 'teacher')->count(),
                'school_admins'   => User::where('role', 'school_admin')->count(),
                'schools'         => \App\Models\School::count(),
                'subjects'        => Subject::count(),
                'chat_sessions'   => ChatSession::count(),
                'assessments'     => Assessment::count(),
                'completed_assessments' => Assessment::where('status', 'completed')->count(),
                'avg_score'       => round((float) Assessment::where('status', 'completed')->avg('score'), 2),
            ],
            'signups_by_day' => DB::table('users')
                ->selectRaw("date(created_at) as day, count(*) as count")
                ->groupBy('day')->orderBy('day')->get(),
        ]);
    }

    // List / filter users.
    public function users(Request $request)
    {
        $q = User::query()
            ->when($request->role, fn ($x) => $x->where('role', $request->role))
            ->when($request->search, fn ($x) => $x->where(function ($w) use ($request) {
                $w->where('name', 'like', "%{$request->search}%")
                  ->orWhere('email', 'like', "%{$request->search}%");
            }))
            ->latest();

        return response()->json(['users' => $q->paginate(20)]);
    }

    // Full user detail including linked parents / children.
    public function show(User $user)
    {
        $user->load('level.track.stage');

        $parents = $user->parents()->get()->map(fn (User $p) => [
            'id'           => $p->id,
            'name'         => $p->name,
            'email'        => $p->email,
            'relationship' => $p->pivot->relationship ?? null,
        ]);

        $children = $user->children()->get()->map(fn (User $c) => [
            'id'              => $c->id,
            'name'            => $c->name,
            'email'           => $c->email,
            'curriculum_path' => $c->curriculum_path,
            'relationship'    => $c->pivot->relationship ?? null,
        ]);

        return response()->json([
            'user'     => $user,
            'parents'  => $parents,
            'children' => $children,
        ]);
    }

    // Progress strip + recent assessments + open gaps for the student detail drawer.
    public function progress(User $user)
    {
        return response()->json([
            'summary'     => $this->progress->summary($user),
            'assessments' => $user->assessments()
                ->where('status', 'completed')->latest()->take(5)
                ->get(['id', 'topic_name', 'score', 'total', 'completed_at']),
            'gaps'        => $user->knowledgeGaps()
                ->where('resolved', false)->latest()
                ->get(['id', 'topic_name', 'concept', 'severity', 'recommendation', 'resolved']),
            'chat_count'  => $user->chatSessions()->count(),
        ]);
    }

    // Activate / deactivate a user.
    public function setActive(Request $request, User $user)
    {
        $data = $request->validate(['is_active' => ['required', 'boolean']]);
        $user->update(['is_active' => $data['is_active']]);

        return response()->json(['user' => $user]);
    }

    // Update any profile fields; accepts email, language, level_id, stream in addition to existing fields.
    public function updateUser(Request $request, User $user)
    {
        $data = $request->validate([
            'name'      => ['sometimes', 'string', 'max:120'],
            'email'     => ['sometimes', 'email', 'max:200', Rule::unique('users')->ignore($user->id)],
            'role'      => ['sometimes', Rule::in(['admin', 'student', 'parent', 'teacher', 'school_admin'])],
            'level_id'  => ['sometimes', 'nullable', 'exists:levels,id'],
            'board'     => ['sometimes', 'nullable', 'string'],
            'grade'     => ['sometimes', 'nullable', 'integer', 'min:1', 'max:12'],
            'stream'    => ['sometimes', 'nullable', 'string', 'max:40'],
            'language'  => ['sometimes', 'nullable', 'string', 'max:20'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $user->update($data);

        return response()->json(['user' => $user->fresh()->load('level.track.stage')]);
    }

    // Admin-initiated parent-child link. The route {user} must be a parent.
    public function linkChild(Request $request, User $user)
    {
        abort_unless($user->role === 'parent', 422, 'Target user is not a parent.');

        $data = $request->validate([
            'child_email'  => ['required', 'email', 'exists:users,email'],
            'relationship' => ['nullable', 'string', 'max:40'],
        ]);

        $child = User::where('email', $data['child_email'])->where('role', 'student')->first();
        abort_unless($child, 422, 'No student account found for that email.');

        $user->children()->syncWithoutDetaching([
            $child->id => ['relationship' => $data['relationship'] ?? 'guardian'],
        ]);

        return response()->json([
            'message' => 'Linked.',
            'child'   => [
                'id'              => $child->id,
                'name'            => $child->name,
                'email'           => $child->email,
                'curriculum_path' => $child->curriculum_path,
                'relationship'    => $data['relationship'] ?? 'guardian',
            ],
        ]);
    }

    // Remove a parent_student pivot row.
    public function unlinkChild(User $parent, User $student)
    {
        $parent->children()->detach($student->id);
        return response()->json(['ok' => true]);
    }
}
