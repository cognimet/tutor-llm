<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\Assignment;
use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\SchoolClass;
use App\Models\Section;
use App\Models\User;
use App\Services\CurriculumResolver;
use App\Services\ProgressService;
use App\Services\TutorService;
use App\Support\Insights;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Teacher panel. Read + assign, hard-scoped to the teacher's assigned sections
 * (teacher_section pivot). Student reports reuse the ParentController report
 * shape; assignment generation reuses TutorService::generateAssessment.
 */
class TeacherController extends Controller
{
    public function __construct(
        protected ProgressService $progress,
        protected TutorService $tutor,
        protected CurriculumResolver $resolver,
    ) {}

    /** Guard: the caller must teach this section. */
    protected function assertTeaches(Request $request, Section $section): void
    {
        abort_unless(
            $request->user()->taughtSections()->whereKey($section->id)->exists(),
            403, 'You are not assigned to this section.'
        );
    }

    /* ---------------- Scope ---------------- */

    public function myScope(Request $request)
    {
        $teacher = $request->user();
        $sections = $teacher->taughtSections()
            ->with('schoolClass:id,name')->withCount('students')->get();

        return response()->json([
            'sections' => $sections->map(fn (Section $s) => [
                'id' => $s->id, 'name' => $s->name,
                'class' => $s->schoolClass?->name,
                'students' => $s->students_count,
            ]),
            'classes'  => $teacher->taughtClasses()->get(['school_classes.id', 'name']),
            'subjects' => $teacher->taughtSubjects()->get(['subjects.id', 'name']),
        ]);
    }

    /**
     * Cross-section overview: how every class/section the teacher owns is doing,
     * side by side. Class-wise rollup with sections nested, plus KPIs and the
     * concepts most worth reteaching across the whole scope.
     */
    public function overview(Request $request)
    {
        $teacher = $request->user();
        $sections = $teacher->taughtSections()->with('schoolClass:id,name')->get();
        $sectionInfo = $sections->mapWithKeys(fn (Section $s) => [$s->id => (object) [
            'name'     => $s->name,
            'class_id' => $s->school_class_id,
            'class'    => $s->schoolClass?->name ?? '—',
        ]]);

        $students = User::where('role', 'student')->whereIn('section_id', $sections->pluck('id'))
            ->get(['id', 'name', 'section_id', 'last_active_date', 'current_streak']);
        $ids = $students->pluck('id');

        $mastery = Insights::masteryByUser($ids);
        $gaps    = Insights::gapAggByUser($ids);

        $rows = $students->map(function (User $s) use ($mastery, $gaps, $sectionInfo) {
            $g = $gaps[$s->id] ?? null;
            $m = (int) ($mastery[$s->id] ?? 0);
            $high = (int) ($g->high ?? 0);
            $info = $sectionInfo[$s->section_id] ?? null;
            return (object) [
                'section_id' => $s->section_id,
                'section_name' => $info->name ?? '—',
                'class_id' => $info->class_id ?? 0,
                'class' => $info->class ?? '—',
                'mastery' => $m,
                'open' => (int) ($g->open ?? 0), 'high' => $high,
                'active' => $s->last_active_date && Carbon::parse($s->last_active_date)->gte(Carbon::today()->subDays(7)),
                'at_risk' => Insights::isAtRisk($m, $high),
            ];
        });

        $withData = $rows->where('mastery', '>', 0);

        // Section-wise comparison, richest first — carries section_id so the UI
        // can deep-link straight into the per-section analytics.
        $sectionRows = $rows->groupBy('section_id')->map(function ($g) use ($sectionInfo) {
            $wd = $g->where('mastery', '>', 0);
            $info = $sectionInfo[$g->first()->section_id] ?? null;
            return [
                'id'          => $g->first()->section_id,
                'name'        => $info->name ?? '—',
                'class'       => $info->class ?? '—',
                'students'    => $g->count(),
                'avg_mastery' => $wd->isNotEmpty() ? (int) round($wd->avg('mastery')) : 0,
                'open_gaps'   => (int) $g->sum('open'),
                'at_risk'     => $g->where('at_risk', true)->count(),
            ];
        })->values()->sortByDesc('avg_mastery')->values();

        // Class-wise rollup with the teacher's sections of that class nested inside.
        $classRows = $rows->groupBy('class_id')->map(function ($g) use ($sectionRows) {
            $wd = $g->where('mastery', '>', 0);
            $secIds = $g->pluck('section_id')->unique();
            return [
                'class_id'      => $g->first()->class_id,
                'class'         => $g->first()->class,
                'students'      => $g->count(),
                'section_count' => $secIds->count(),
                'avg_mastery'   => $wd->isNotEmpty() ? (int) round($wd->avg('mastery')) : 0,
                'open_gaps'     => (int) $g->sum('open'),
                'at_risk'       => $g->where('at_risk', true)->count(),
                'sections'      => $sectionRows->whereIn('id', $secIds->all())->values(),
            ];
        })->values()->sortByDesc('avg_mastery')->values();

        return response()->json([
            'kpis' => [
                'students'    => $students->count(),
                'sections'    => $sections->count(),
                'classes'     => $classRows->count(),
                'avg_mastery' => $withData->isNotEmpty() ? (int) round($withData->avg('mastery')) : 0,
                'at_risk'     => $rows->where('at_risk', true)->count(),
                'active_7d'   => $rows->where('active', true)->count(),
            ],
            'classes'      => $classRows,
            'sections'     => $sectionRows,
            'gap_clusters' => Insights::gapClusters($ids),
            'topic_mastery'=> Insights::topicMastery($ids),
        ]);
    }

    public function roster(Request $request, Section $section)
    {
        $this->assertTeaches($request, $section);
        $students = $section->students()->get()->map(fn (User $s) => [
            'id' => $s->id, 'name' => $s->name, 'email' => $s->email, 'login_code' => $s->login_code,
            'progress' => $this->progress->summary($s),
        ]);
        return response()->json(['section' => $section->only(['id', 'name']), 'students' => $students]);
    }

    /* ---------------- Per-student report (ParentController shape) ---------------- */

    public function studentReport(Request $request, User $student)
    {
        abort_unless($request->user()->canAccessStudent($student), 403, 'Not your student.');

        return response()->json([
            'child'    => $student->only(['id', 'name', 'email', 'board', 'grade']) + ['curriculum_path' => $student->curriculum_path],
            'progress' => $this->progress->summary($student),
            'gaps'     => $student->knowledgeGaps()->where('resolved', false)->latest()->get(),
            'recent_assessments' => $student->assessments()
                ->where('status', 'completed')->latest()->take(10)
                ->get(['id', 'topic_name', 'score', 'total', 'completed_at']),
            'plans'    => $student->learningPlans()->with('items')->where('status', 'active')->get(),
        ]);
    }

    /* ---------------- Section analytics ---------------- */

    public function sectionAnalytics(Request $request, Section $section)
    {
        $this->assertTeaches($request, $section);

        $students = $section->students()->get(['id', 'name', 'last_active_date', 'current_streak']);

        // Recent assignments with completion + average score (out of 100).
        $assignments = $section->assignments()->latest()->limit(6)->get()->map(function (Assignment $a) {
            $done = $a->assessments()->where('status', 'completed');
            $sumScore = (clone $done)->sum('score');
            $sumTotal = (clone $done)->sum('total');
            return [
                'id' => $a->id, 'title' => $a->title, 'mode' => $a->mode,
                'total' => $a->assessments()->count(),
                'completed' => (clone $done)->count(),
                'avg_score' => $sumTotal > 0 ? (int) round($sumScore / $sumTotal * 100) : null,
            ];
        });

        return response()->json(array_merge(Insights::cohortReport($students), [
            'section'     => $section->only(['id', 'name']),
            'assignments' => $assignments,
        ]));
    }

    /**
     * Class detail: every section of this class that the teacher owns, side by
     * side, plus the class-wide cohort analytics. Guarded to classes the
     * teacher actually teaches at least one section of.
     */
    public function classAnalytics(Request $request, SchoolClass $class)
    {
        $teacher = $request->user();
        $sections = $teacher->taughtSections()->where('sections.school_class_id', $class->id)->get(['sections.id', 'sections.name']);
        abort_if($sections->isEmpty(), 403, 'You do not teach this class.');

        $students = User::where('role', 'student')->whereIn('section_id', $sections->pluck('id'))
            ->get(['id', 'name', 'section_id', 'last_active_date', 'current_streak']);

        return response()->json(array_merge(Insights::cohortReport($students), [
            'class'    => ['id' => $class->id, 'name' => $class->name],
            'sections' => Insights::sectionComparison($students, $sections),
        ]));
    }

    /* ---------------- Assignments ---------------- */

    public function assignments(Request $request, Section $section)
    {
        $this->assertTeaches($request, $section);
        return response()->json(['assignments' => $section->assignments()->withCount('assessments')->get()]);
    }

    /**
     * Push an assessment to a whole section. `mode`:
     *  - fixed        → one AI-generated set, identical for every student (1 AI call).
     *  - personalized → per-student set targeting each student's open gaps (N AI calls).
     */
    public function createAssignment(Request $request)
    {
        $teacher = $request->user();
        $data = $request->validate([
            'section_id' => ['required', 'integer', 'exists:sections,id'],
            'topic_name' => ['required', 'string', 'max:160'],
            'topic_id'   => ['nullable', 'exists:topics,id'],
            'subject_id' => ['nullable', 'exists:subjects,id'],
            'mode'       => ['required', 'in:fixed,personalized'],
            'count'      => ['nullable', 'integer', 'min:1', 'max:20'],
            'title'      => ['nullable', 'string', 'max:160'],
            'due_at'     => ['nullable', 'date'],
        ]);

        $section = Section::findOrFail($data['section_id']);
        $this->assertTeaches($request, $section);

        $count = $data['count'] ?? 5;
        $subjectId = $data['subject_id'] ?? $this->resolver->subjectId($teacher, $data['topic_id'] ?? null, null);
        $students = $section->students()->get();
        abort_if($students->isEmpty(), 422, 'This section has no students yet.');

        $base = [
            'school_id'  => $section->school_id,
            'section_id' => $section->id,
            'teacher_id' => $teacher->id,
            'subject_id' => $data['subject_id'] ?? null,
            'topic_id'   => $data['topic_id'] ?? null,
            'type'       => 'assessment',
            'mode'       => $data['mode'],
            'title'      => $data['title'] ?? $data['topic_name'],
            'due_at'     => $data['due_at'] ?? null,
        ];

        $materialised = 0;

        if ($data['mode'] === 'fixed') {
            // Generate the shared set FIRST — a flaky AI response must never leave
            // an empty assignment behind. Only persist once we have questions.
            $questions = $this->generate($data['topic_name'], $count, $subjectId, $teacher, []);
            abort_if(empty($questions), 422, 'The AI couldn\'t produce a quiz just now — try again in a moment.');
            $assignment = Assignment::create($base + ['payload' => $questions]);
            foreach ($students as $student) {
                $this->materialise($student, $assignment, $questions, $data['topic_name'], $data['topic_id'] ?? null);
                $materialised++;
            }
        } else {
            // Personalised: each student gets a set aimed at their own open gaps.
            $assignment = Assignment::create($base);
            foreach ($students as $student) {
                $focus = $student->knowledgeGaps()->where('resolved', false)
                    ->where('topic_name', $data['topic_name'])->limit(6)->pluck('concept')->filter()->unique()->values()->all();
                $questions = $this->generate($data['topic_name'], $count, $subjectId, $student, $focus);
                if (empty($questions)) { continue; }   // skip students the AI couldn't generate for; teacher can retry
                $this->materialise($student, $assignment, $questions, $data['topic_name'], $data['topic_id'] ?? null);
                $materialised++;
            }
            if ($materialised === 0) {
                $assignment->delete();   // nothing generated — don't leave an empty assignment
                abort(422, 'The AI couldn\'t produce quizzes just now — try again in a moment.');
            }
        }

        return response()->json([
            'assignment' => $assignment->only(['id', 'title', 'mode', 'section_id']),
            'materialised' => $materialised,
            'section_size' => $students->count(),
        ], 201);
    }

    /** Gradebook: each student's status/score for an assignment. */
    public function assignmentResults(Request $request, Assignment $assignment)
    {
        abort_unless($request->user()->taughtSections()->whereKey($assignment->section_id)->exists(),
            403, 'Not your assignment.');

        $rows = $assignment->assessments()->with('user:id,name')->get()->map(fn (Assessment $a) => [
            'student'    => $a->user?->name,
            'student_id' => $a->user_id,
            'status'     => $a->status,
            'score'      => $a->score,
            'total'      => $a->total,
            'completed_at' => $a->completed_at,
        ]);

        return response()->json([
            'assignment' => $assignment->only(['id', 'title', 'mode', 'due_at']),
            'results' => $rows,
        ]);
    }

    /* ---------------- helpers ---------------- */

    private function generate(string $topicName, int $count, ?int $subjectId, User $ctx, array $focus): array
    {
        $q = $this->tutor->generateAssessment($ctx, $topicName, $count, $subjectId, $focus);
        if (empty($q)) {   // one retry — free-tier models occasionally return empty
            $q = $this->tutor->generateAssessment($ctx, $topicName, $count, $subjectId, $focus);
        }
        return $q ?: [];
    }

    private function materialise(User $student, Assignment $assignment, array $questions, string $topicName, ?int $topicId): void
    {
        $assessment = $student->assessments()->create([
            'assignment_id' => $assignment->id,
            'topic_id'      => $topicId,
            'topic_name'    => $topicName,
            'status'        => 'pending',
            'total'         => count($questions),
        ]);
        foreach ($questions as $i => $q) {
            $assessment->questions()->create([
                'question'      => $q['question'],
                'options'       => $q['options'],
                'correct_index' => $q['correct_index'],
                'concept'       => $q['concept'] ?? null,
                'explanation'   => $q['explanation'] ?? null,
                'position'      => $i,
            ]);
        }
    }
}
