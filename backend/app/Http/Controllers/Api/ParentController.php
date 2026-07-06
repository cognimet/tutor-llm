<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\Misconception;
use App\Models\StudentProgressLog;
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

        // Durable storybook engagement: read-pacing + first-try checkpoint accuracy.
        $logs = StudentProgressLog::where('user_id', $child->id)->get();
        $quiz = $logs->where('type', 'quiz_attempt');
        $firstTries = $quiz->where('attempt_number', 1);

        // Which checkpoints they slipped on first try (and whether they recovered).
        $struggles = [];
        foreach ($quiz->groupBy('target_id') as $attempts) {
            $first = $attempts->firstWhere('attempt_number', 1);
            if ($first && ! $first->is_correct) {
                $struggles[] = [
                    'question'      => $first->metadata['question_text'] ?? 'Checkpoint',
                    'cleared'       => $attempts->contains(fn ($a) => $a->is_correct === true),
                    'attempts_count' => $attempts->count(),
                ];
            }
        }

        return response()->json([
            'child'    => $child->only(['id', 'name', 'email', 'board', 'grade']) + ['curriculum_path' => $child->curriculum_path],
            'progress' => $this->progress->summary($child),

            // --- Durable engagement & comprehension metrics ---
            'telemetry' => [
                'read_continues_clicked'        => $logs->where('type', 'read_continue')->count(),
                'checkpoints_challenged'        => $firstTries->count(),
                'checkpoints_first_try_correct' => $firstTries->where('is_correct', true)->count(),
                'checkpoints_first_try_wrong'   => $firstTries->where('is_correct', false)->count(),
                'checkpoint_struggles'          => array_slice($struggles, 0, 10),
            ],

            'gaps'     => $child->knowledgeGaps()->where('resolved', false)->latest()->get(),
            'recent_assessments' => $child->assessments()
                ->where('status', 'completed')->latest()->take(10)
                ->get(['id', 'topic_name', 'score', 'total', 'completed_at']),
            'plans'    => $child->learningPlans()->with('items')->where('status', 'active')->get(),
        ]);
    }

    // Advanced gap-analysis dashboard for one child (parent must own the link).
    public function childGaps(Request $request, User $child)
    {
        $parent = $request->user();
        abort_unless($parent->children()->where('users.id', $child->id)->exists(), 403, 'Not your child.');

        $openGaps = KnowledgeGap::where('user_id', $child->id)->where('resolved', false)
            ->latest()->limit(12)->get(['id', 'topic_name', 'concept', 'severity', 'recommendation', 'created_at']);

        $bySeverity = KnowledgeGap::where('user_id', $child->id)->where('resolved', false)
            ->selectRaw('severity, COUNT(*) as count')->groupBy('severity')->pluck('count', 'severity');

        $resolvedRecently = KnowledgeGap::where('user_id', $child->id)->where('resolved', true)
            ->where('updated_at', '>=', now()->subDays(30))->count();

        // Concept mastery grouped by topic (EWMA scores from the tutor's mind).
        $mastery = ConceptMastery::where('user_id', $child->id)
            ->orderBy('score')->limit(40)->get()
            ->groupBy('topic_name')
            ->map(fn ($rows, $topic) => [
                'topic_name' => $topic,
                'avg_mastery' => (int) round($rows->avg('score') * 100),
                'concepts' => $rows->take(5)->map(fn ($r) => [
                    'concept' => $r->concept,
                    'score' => (int) round($r->score * 100),
                    'passes' => $r->passes(),
                ])->values(),
            ])->values();

        $misconceptions = Misconception::where('user_id', $child->id)
            ->orderByDesc('id')->limit(10)
            ->get(['id', 'topic_name', 'description', 'status', 'detected_at', 'resolved_at']);

        // 30-day created vs resolved trend.
        $since = now()->subDays(30);
        $created = KnowledgeGap::where('user_id', $child->id)->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $resolved = KnowledgeGap::where('user_id', $child->id)->where('resolved', true)
            ->where('updated_at', '>=', $since)
            ->selectRaw('DATE(updated_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $trend = [];
        for ($d = 29; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $trend[] = ['day' => $day, 'created' => (int) ($created[$day] ?? 0), 'resolved' => (int) ($resolved[$day] ?? 0)];
        }

        return response()->json([
            'child' => $child->only(['id', 'name']),
            'summary' => [
                'open' => array_sum($bySeverity->all()),
                'high' => (int) ($bySeverity['high'] ?? 0),
                'medium' => (int) ($bySeverity['medium'] ?? 0),
                'low' => (int) ($bySeverity['low'] ?? 0),
                'resolved_last_30d' => $resolvedRecently,
            ],
            'open_gaps' => $openGaps,
            'mastery_by_topic' => $mastery,
            'misconceptions' => $misconceptions,
            'trend' => $trend,
        ]);
    }

    // Create a brand-new student account and link it to this parent. Lets a
    // parent onboard a child who doesn't have their own account yet — the child
    // then signs in with the email + password set here.
    public function addChild(Request $request)
    {
        $data = $request->validate([
            'name'         => ['required', 'string', 'max:120'],
            'email'        => ['required', 'email', 'unique:users,email'],
            'password'     => ['required', 'string', 'min:6'],
            'level_id'     => ['nullable', 'exists:levels,id'],
            'board'        => ['nullable', 'string'],
            'grade'        => ['nullable', 'integer', 'min:1', 'max:12'],
            'stream'       => ['nullable', 'string', 'max:40'],
            'language'     => ['nullable', 'string'],
            'relationship' => ['nullable', 'string', 'max:40'],
        ]);

        $child = User::create([
            'name'     => $data['name'],
            'email'    => $data['email'],
            'password' => $data['password'], // 'hashed' cast on the model
            'role'     => 'student',
            'level_id' => $data['level_id'] ?? null,
            'board'    => $data['board'] ?? null,
            'grade'    => $data['grade'] ?? null,
            'stream'   => $data['stream'] ?? null,
            'language' => $data['language'] ?? 'en',
        ]);

        $request->user()->children()->syncWithoutDetaching([
            $child->id => ['relationship' => $data['relationship'] ?? 'guardian'],
        ]);

        return response()->json([
            'message' => 'Student account created and linked.',
            'child'   => $child->only(['id', 'name', 'email', 'board', 'grade']),
        ], 201);
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
