<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\Assignment;
use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\ProgressSnapshot;
use App\Models\School;
use App\Models\SchoolClass;
use App\Models\Section;
use App\Models\User;
use App\Support\Insights;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * School-admin panel. Every action is hard-scoped to the caller's own school
 * (users.school_id) — a school_admin can never touch another school's data.
 * Provisioning here reuses the ParentController::addChild pattern for creating
 * scoped users; students stay normal `users` rows a parent can still link to.
 */
class SchoolController extends Controller
{
    /** The caller's school (403 if the account isn't attached to one). */
    protected function school(Request $request): School
    {
        $id = $request->user()->school_id;
        abort_if($id === null, 403, 'Account is not attached to a school.');
        return School::findOrFail($id);
    }

    protected function assertInSchool(int $schoolId, int $entitySchoolId): void
    {
        abort_unless($entitySchoolId === $schoolId, 403, 'Outside your school.');
    }

    /* ---------------- Overview ---------------- */

    public function overview(Request $request)
    {
        $school = $this->school($request);

        $students = $school->students()->get(['id', 'name', 'section_id', 'last_active_date', 'current_streak']);
        $ids = $students->pluck('id');

        $mastery = Insights::masteryByUser($ids);
        $gaps    = Insights::gapAggByUser($ids);

        // Section → {name, class} map for section- and class-wise rollups.
        $sectionInfo = Section::where('school_id', $school->id)->with('schoolClass:id,name')->get()
            ->mapWithKeys(fn (Section $s) => [$s->id => (object) [
                'name'     => $s->name,
                'class_id' => $s->school_class_id,
                'class'    => $s->schoolClass?->name ?? '—',
                'label'    => trim(($s->schoolClass?->name ?? '').' · '.$s->name, ' ·'),
            ]]);

        // Derive a per-student row once; everything below aggregates from it.
        $rows = $students->map(function (User $s) use ($mastery, $gaps, $sectionInfo) {
            $g = $gaps[$s->id] ?? null;
            $m = (int) ($mastery[$s->id] ?? 0);
            $high = (int) ($g->high ?? 0);
            $info = $sectionInfo[$s->section_id] ?? null;
            return (object) [
                'id' => $s->id, 'name' => $s->name,
                'section' => $info->label ?? '—',
                'section_id' => $s->section_id,
                'section_name' => $info->name ?? '—',
                'class_id' => $info->class_id ?? 0,
                'class' => $info->class ?? '—',
                'mastery' => $m,
                'open' => (int) ($g->open ?? 0), 'high' => $high,
                'active' => $s->last_active_date && Carbon::parse($s->last_active_date)->gte(Carbon::today()->subDays(7)),
                'streak' => (int) $s->current_streak,
                'at_risk' => Insights::isAtRisk($m, $high),
            ];
        });

        $withData = $rows->where('mastery', '>', 0);

        // Section comparison — the institutional "which sections are ahead / behind".
        $sections = $rows->groupBy('section_id')->map(function ($g) use ($sectionInfo) {
            $wd = $g->where('mastery', '>', 0);
            return [
                'id'          => $g->first()->section_id,
                'label'       => $sectionInfo[$g->first()->section_id]->label ?? '—',
                'students'    => $g->count(),
                'avg_mastery' => $wd->isNotEmpty() ? (int) round($wd->avg('mastery')) : 0,
                'open_gaps'   => (int) $g->sum('open'),
                'at_risk'     => $g->where('at_risk', true)->count(),
            ];
        })->values()->sortByDesc('avg_mastery')->values();

        // Class comparison — same rollup one level up, with sections nested inside
        // so leadership can drill class → section without another request.
        $classes = $rows->groupBy('class_id')->map(function ($g) {
            $wd = $g->where('mastery', '>', 0);
            $sections = $g->groupBy('section_id')->map(function ($sg) {
                $swd = $sg->where('mastery', '>', 0);
                return [
                    'id'          => $sg->first()->section_id,
                    'name'        => $sg->first()->section_name,
                    'students'    => $sg->count(),
                    'avg_mastery' => $swd->isNotEmpty() ? (int) round($swd->avg('mastery')) : 0,
                    'open_gaps'   => (int) $sg->sum('open'),
                    'at_risk'     => $sg->where('at_risk', true)->count(),
                ];
            })->values()->sortByDesc('avg_mastery')->values();
            return [
                'class_id'      => $g->first()->class_id,
                'class'         => $g->first()->class,
                'students'      => $g->count(),
                'section_count' => $sections->count(),
                'avg_mastery'   => $wd->isNotEmpty() ? (int) round($wd->avg('mastery')) : 0,
                'open_gaps'     => (int) $g->sum('open'),
                'at_risk'       => $g->where('at_risk', true)->count(),
                'sections'      => $sections,
            ];
        })->values()->sortByDesc('avg_mastery')->values();

        // Students to intervene with first (cross-section), weakest first.
        $atRisk = $rows->where('at_risk', true)->sortBy('mastery')->take(10)->map(fn ($r) => [
            'id' => $r->id, 'name' => $r->name, 'section' => $r->section,
            'mastery' => $r->mastery, 'high_gaps' => $r->high, 'open_gaps' => $r->open,
        ])->values();

        // Honour roll — celebrate the strongest students.
        $topPerformers = $withData->sortByDesc('mastery')->take(5)->map(fn ($r) => [
            'id' => $r->id, 'name' => $r->name, 'section' => $r->section,
            'mastery' => $r->mastery, 'streak' => $r->streak,
        ])->values();

        // Engagement breakdown — who's showing up.
        $activeToday = $students->filter(fn (User $s) => $s->last_active_date && Carbon::parse($s->last_active_date)->isToday())->count();
        $engagement = [
            'active_today' => $activeToday,
            'active_7d'    => $rows->where('active', true)->count(),
            'inactive_7d'  => $rows->where('active', false)->count(),
            'avg_streak'   => (int) round((float) $students->avg('current_streak')),
        ];

        // Teacher effectiveness — sections covered + how their students are doing.
        $teachers = $school->teachers()->with('taughtSections:id')->get();
        $assignmentsByTeacher = Assignment::whereIn('teacher_id', $teachers->pluck('id'))
            ->selectRaw('teacher_id, COUNT(*) as c')->groupBy('teacher_id')->pluck('c', 'teacher_id');
        $teacherRows = $teachers->map(function (User $t) use ($rows, $assignmentsByTeacher) {
            $secIds = $t->taughtSections->pluck('id')->all();
            $tRows = $rows->whereIn('section_id', $secIds);
            $wd = $tRows->where('mastery', '>', 0);
            return [
                'id' => $t->id, 'name' => $t->name,
                'sections' => count($secIds),
                'students' => $tRows->count(),
                'avg_mastery' => $wd->isNotEmpty() ? (int) round($wd->avg('mastery')) : 0,
                'at_risk' => $tRows->where('at_risk', true)->count(),
                'assignments' => (int) ($assignmentsByTeacher[$t->id] ?? 0),
            ];
        })->sortByDesc('avg_mastery')->values();

        return response()->json([
            'school' => [
                'id' => $school->id, 'name' => $school->name, 'board' => $school->board,
                'seat_limit' => $school->seat_limit, 'seats_used' => $school->seatsUsed(),
                'plan' => $school->plan?->only('key', 'name', 'monthly_credit_limit'),
            ],
            'counts' => [
                'students' => $students->count(),
                'teachers' => $school->teachers()->count(),
                'classes'  => $school->classes()->count(),
                'sections' => $school->sections()->count(),
            ],
            'kpis' => [
                'avg_mastery' => $withData->isNotEmpty() ? (int) round($withData->avg('mastery')) : 0,
                'at_risk'     => $rows->where('at_risk', true)->count(),
                'active_7d'   => $rows->where('active', true)->count(),
                'assessments_completed' => Assessment::whereIn('user_id', $ids)->where('status', 'completed')->count(),
            ],
            'engagement'       => $engagement,
            'ai_usage'         => Insights::usageTotals($ids),
            'gaps'             => Insights::severityTotals($ids),
            'gap_clusters'     => Insights::gapClusters($ids),
            'topic_hotspots'   => Insights::topicGaps($ids),
            'classes'          => $classes,
            'sections'         => $sections,
            'teachers'         => $teacherRows,
            'at_risk_students' => $atRisk,
            'top_performers'   => $topPerformers,
            'mastery_trend'    => Insights::masteryTrend($ids),
        ]);
    }

    public function seats(Request $request)
    {
        $school = $this->school($request);
        return response()->json([
            'seat_limit' => $school->seat_limit,
            'seats_used' => $school->seatsUsed(),
            'has_free_seat' => $school->hasFreeSeat(),
        ]);
    }

    /* ---------------- Class & section detail ---------------- */

    /** Class detail: cohort analytics + per-section comparison. */
    public function classAnalytics(Request $request, SchoolClass $class)
    {
        $school = $this->school($request);
        $this->assertInSchool($school->id, $class->school_id);

        $sections = $class->sections()->get(['id', 'name']);
        $students = User::where('role', 'student')->whereIn('section_id', $sections->pluck('id'))
            ->get(['id', 'name', 'section_id', 'last_active_date', 'current_streak']);

        return response()->json(array_merge(Insights::cohortReport($students), [
            'class'    => ['id' => $class->id, 'name' => $class->name],
            'sections' => Insights::sectionComparison($students, $sections),
        ]));
    }

    /** Section detail: cohort analytics + recent assignments for the section. */
    public function sectionAnalytics(Request $request, Section $section)
    {
        $school = $this->school($request);
        $this->assertInSchool($school->id, $section->school_id);

        $section->load('schoolClass:id,name');
        $students = $section->students()->get(['id', 'name', 'last_active_date', 'current_streak']);

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
            'section'     => ['id' => $section->id, 'name' => $section->name, 'class' => $section->schoolClass?->name],
            'assignments' => $assignments,
        ]));
    }

    /** Per-student report (same shape as the parent/teacher report). */
    public function studentReport(Request $request, User $student)
    {
        abort_unless($request->user()->canAccessStudent($student), 403, 'Not your student.');

        return response()->json([
            'child'    => $student->only(['id', 'name', 'email', 'board', 'grade']) + ['curriculum_path' => $student->curriculum_path],
            'progress' => app(\App\Services\ProgressService::class)->summary($student),
            'gaps'     => $student->knowledgeGaps()->where('resolved', false)->latest()->get(),
            'recent_assessments' => $student->assessments()
                ->where('status', 'completed')->latest()->take(10)
                ->get(['id', 'topic_name', 'score', 'total', 'completed_at']),
            'plans'    => $student->learningPlans()->with('items')->where('status', 'active')->get(),
        ]);
    }

    /* ---------------- Classes & sections ---------------- */

    public function classes(Request $request)
    {
        $school = $this->school($request);
        $classes = $school->classes()->with(['sections' => fn ($q) => $q->withCount('students'), 'level'])->get();
        return response()->json(['classes' => $classes]);
    }

    public function storeClass(Request $request)
    {
        $school = $this->school($request);
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:80'],
            'level_id' => ['nullable', 'exists:levels,id'],
            'position' => ['nullable', 'integer'],
        ]);
        $class = $school->classes()->create($data);
        return response()->json(['class' => $class], 201);
    }

    public function storeSection(Request $request, SchoolClass $class)
    {
        $school = $this->school($request);
        $this->assertInSchool($school->id, $class->school_id);
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:40'],
            'position' => ['nullable', 'integer'],
        ]);
        $section = $class->sections()->create($data + ['school_id' => $school->id]);
        return response()->json(['section' => $section], 201);
    }

    public function destroySection(Request $request, Section $section)
    {
        $school = $this->school($request);
        $this->assertInSchool($school->id, $section->school_id);
        abort_if($section->students()->exists(), 422, 'Move or remove students before deleting this section.');
        $section->delete();
        return response()->json(['ok' => true]);
    }

    /* ---------------- Teachers ---------------- */

    public function teachers(Request $request)
    {
        $school = $this->school($request);
        $teachers = $school->teachers()
            ->with(['taughtSections:id,name', 'taughtSubjects:id,name'])
            ->get(['id', 'name', 'email', 'is_active', 'school_id']);
        return response()->json(['teachers' => $teachers]);
    }

    public function storeTeacher(Request $request)
    {
        $school = $this->school($request);
        $data = $request->validate([
            'name'        => ['required', 'string', 'max:120'],
            'email'       => ['required', 'email', 'unique:users,email'],
            'password'    => ['required', 'string', 'min:6'],
            'section_ids' => ['array'],
            'section_ids.*' => ['integer', 'exists:sections,id'],
            'class_ids'   => ['array'],
            'class_ids.*' => ['integer', 'exists:school_classes,id'],
            'subject_ids' => ['array'],
            'subject_ids.*' => ['integer', 'exists:subjects,id'],
        ]);

        $teacher = User::create([
            'name' => $data['name'], 'email' => $data['email'],
            'password' => $data['password'], 'role' => 'teacher', 'school_id' => $school->id,
        ]);
        $this->syncTeacherAssignments($school, $teacher, $data);

        return response()->json(['teacher' => $teacher->only(['id', 'name', 'email', 'role', 'school_id'])], 201);
    }

    public function updateTeacher(Request $request, User $teacher)
    {
        $school = $this->school($request);
        abort_unless($teacher->isTeacher() && $teacher->school_id === $school->id, 403, 'Outside your school.');
        $data = $request->validate([
            'section_ids' => ['array'], 'section_ids.*' => ['integer', 'exists:sections,id'],
            'class_ids'   => ['array'], 'class_ids.*'   => ['integer', 'exists:school_classes,id'],
            'subject_ids' => ['array'], 'subject_ids.*' => ['integer', 'exists:subjects,id'],
        ]);
        $this->syncTeacherAssignments($school, $teacher, $data);
        return response()->json(['ok' => true]);
    }

    /** Sync a teacher's class/section/subject pivots — only entities in THIS school. */
    protected function syncTeacherAssignments(School $school, User $teacher, array $data): void
    {
        if (isset($data['section_ids'])) {
            $ids = Section::whereIn('id', $data['section_ids'])->where('school_id', $school->id)->pluck('id');
            $teacher->taughtSections()->sync($ids);
        }
        if (isset($data['class_ids'])) {
            $ids = SchoolClass::whereIn('id', $data['class_ids'])->where('school_id', $school->id)->pluck('id');
            $teacher->taughtClasses()->sync($ids);
        }
        if (isset($data['subject_ids'])) {
            // Subjects belong to curriculum levels, not schools — keep as validated.
            $teacher->taughtSubjects()->sync($data['subject_ids']);
        }
    }

    /* ---------------- Students ---------------- */

    public function students(Request $request)
    {
        $school = $this->school($request);
        $q = $school->students()
            ->when($request->section_id, fn ($x) => $x->where('section_id', $request->section_id))
            ->when($request->search, fn ($x) => $x->where(fn ($w) =>
                $w->where('name', 'like', "%{$request->search}%")->orWhere('email', 'like', "%{$request->search}%")))
            ->latest();
        return response()->json(['students' => $q->paginate(30)]);
    }

    public function storeStudent(Request $request)
    {
        $school = $this->school($request);
        $data = $request->validate([
            'name'       => ['required', 'string', 'max:120'],
            'email'      => ['nullable', 'email', 'unique:users,email'],
            'password'   => ['nullable', 'string', 'min:6'],
            'section_id' => ['required', 'integer', 'exists:sections,id'],
        ]);
        $section = Section::findOrFail($data['section_id']);
        $this->assertInSchool($school->id, $section->school_id);

        [$student, $tempPassword] = $this->createStudent($school, $section, $data['name'], $data['email'] ?? null, $data['password'] ?? null);

        return response()->json([
            'student' => $student->only(['id', 'name', 'email', 'login_code', 'section_id']),
            // login_code + temp password returned once so the admin can hand them out.
            'temp_password' => $tempPassword,
        ], 201);
    }

    /**
     * Create a school student. Enforces seat_limit, generates a unique login_code,
     * inherits the section's curriculum level/board so the tutor is syllabus-correct.
     *
     * @return array{0: User, 1: ?string} the student and the plaintext temp password
     *         (non-null only when we auto-generated one — never persisted).
     */
    protected function createStudent(School $school, Section $section, string $name, ?string $email, ?string $password): array
    {
        abort_unless($school->hasFreeSeat(), 422, 'Seat limit reached for this school.');

        $level = $section->schoolClass?->level;
        $generated = $password === null || $password === '';
        $tempPlain = $generated ? Str::password(8, true, true, false) : $password;

        $student = User::create([
            'name'       => $name,
            'email'      => $email,                       // nullable — code-only students allowed
            'login_code' => $this->uniqueLoginCode($school),
            'password'   => $tempPlain,                    // hashed cast on the model
            'role'       => 'student',
            'school_id'  => $school->id,
            'section_id' => $section->id,
            'level_id'   => $level?->id,
            'board'      => $school->board,
            'grade'      => $level?->class_number,
        ]);

        return [$student, $generated ? $tempPlain : null];
    }

    protected function uniqueLoginCode(School $school): string
    {
        $prefix = Str::upper(Str::substr(Str::slug($school->slug), 0, 3)) ?: 'STU';
        do {
            $code = $prefix.'-'.Str::upper(Str::random(5));
        } while (User::where('login_code', $code)->exists());
        return $code;
    }

    /* ---------------- CSV roster import ---------------- */

    // CSV headers: name,email,section_id[,password]. Missing email ⇒ code-only login.
    public function importStudents(Request $request)
    {
        $school = $this->school($request);
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt']]);

        [$rows, $header] = $this->readCsv($request->file('file'));
        $created = [];
        $errors = [];

        DB::beginTransaction();
        try {
            foreach ($rows as $n => $row) {
                $r = array_combine($header, $row);
                $sectionId = (int) ($r['section_id'] ?? 0);
                $section = Section::where('id', $sectionId)->where('school_id', $school->id)->first();
                if (! $section) { $errors[] = "Row ".($n + 2).": section not in your school"; continue; }
                if (empty($r['name'])) { $errors[] = "Row ".($n + 2).": missing name"; continue; }
                if (! empty($r['email']) && User::where('email', $r['email'])->exists()) {
                    $errors[] = "Row ".($n + 2).": email already exists"; continue;
                }
                [$s, $tempPassword] = $this->createStudent($school, $section, $r['name'], $r['email'] ?: null, $r['password'] ?? null);
                $created[] = ['name' => $s->name, 'email' => $s->email, 'login_code' => $s->login_code,
                    'temp_password' => $tempPassword];
            }
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            abort(422, 'Import failed: '.$e->getMessage());
        }

        return response()->json(['imported' => count($created), 'students' => $created, 'errors' => $errors]);
    }

    /** @return array{0: array, 1: array} rows (excluding header) and the header row */
    protected function readCsv($file): array
    {
        $lines = array_map('str_getcsv', file($file->getRealPath(), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES));
        $header = array_map(fn ($h) => Str::of($h)->trim()->lower()->replace(' ', '_')->toString(), array_shift($lines));
        return [$lines, $header];
    }
}
