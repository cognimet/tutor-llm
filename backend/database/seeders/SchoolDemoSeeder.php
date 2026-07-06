<?php

namespace Database\Seeders;

use App\Models\Assessment;
use App\Models\Assignment;
use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\Level;
use App\Models\ProgressSnapshot;
use App\Models\School;
use App\Models\SchoolClass;
use App\Models\Section;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * Demo data for the B2B2C School & Teacher panels.
 *
 * Fully idempotent (firstOrCreate on stable keys), so it runs cleanly both as
 * part of a fresh `php artisan migrate:fresh --seed` AND standalone on an
 * existing DB:  php artisan db:seed --class=SchoolDemoSeeder
 *
 * Wired into DatabaseSeeder, so any developer who seeds gets a populated school:
 * 1 school, 3 teachers, 2 classes, 3 sections, 16 students — spread across
 * performance tiers (strong / mid / weak / inactive) with mastery, gaps,
 * engagement and completed assessments, so every insight on both panels renders
 * real, differentiated numbers. Two students are also linked to the demo parent
 * to prove school membership and parent linkage coexist.
 *
 * All school accounts use the password: Test@123
 */
class SchoolDemoSeeder extends Seeder
{
    private const PASSWORD = 'Test@123';

    public function run(): void
    {
        $cbse = fn (int $n) => Level::whereHas('track', fn ($q) => $q->where('slug', 'cbse'))
            ->where('class_number', $n)->whereNull('stream')->first();
        $class10 = $cbse(10);
        $class9  = $cbse(9);

        $school = School::firstOrCreate(
            ['slug' => 'sunrise-public-school'],
            ['name' => 'Sunrise Public School', 'board' => 'cbse', 'city' => 'Pune', 'seat_limit' => 300],
        );

        User::firstOrCreate(
            ['email' => 'school@tuto.ai'],
            ['name' => 'Principal Rao', 'password' => self::PASSWORD, 'role' => 'school_admin', 'school_id' => $school->id],
        );

        $grade10 = SchoolClass::firstOrCreate(['school_id' => $school->id, 'name' => 'Grade 10'], ['level_id' => $class10?->id]);
        $grade9  = SchoolClass::firstOrCreate(['school_id' => $school->id, 'name' => 'Grade 9'],  ['level_id' => $class9?->id]);
        $g10A = Section::firstOrCreate(['school_class_id' => $grade10->id, 'name' => 'A'], ['school_id' => $school->id]);
        $g10B = Section::firstOrCreate(['school_class_id' => $grade10->id, 'name' => 'B'], ['school_id' => $school->id]);
        $g9A  = Section::firstOrCreate(['school_class_id' => $grade9->id,  'name' => 'A'], ['school_id' => $school->id]);

        $teacher = $this->teacher($school, 'teacher@tuto.ai', 'Ms. Iyer');
        $teacher->taughtSections()->syncWithoutDetaching([$g10A->id, $g10B->id]);
        $teacher->taughtClasses()->syncWithoutDetaching([$grade10->id]);
        if ($class10) $teacher->taughtSubjects()->syncWithoutDetaching($class10->subjects()->pluck('id')->all());

        $teacher2 = $this->teacher($school, 'teacher2@tuto.ai', 'Mr. Khan');
        $teacher2->taughtSections()->syncWithoutDetaching([$g10B->id, $g9A->id]);
        $teacher2->taughtClasses()->syncWithoutDetaching([$grade10->id, $grade9->id]);

        $teacher3 = $this->teacher($school, 'teacher3@tuto.ai', 'Mrs. Nair');
        $teacher3->taughtSections()->syncWithoutDetaching([$g9A->id]);
        $teacher3->taughtClasses()->syncWithoutDetaching([$grade9->id]);
        if ($class9) $teacher3->taughtSubjects()->syncWithoutDetaching($class9->subjects()->pluck('id')->all());

        // [code, name, email|null, section, grade, tier]
        $roster = [
            ['SUN-10A01', 'Kabir Mehta',   'schoolstudent@tuto.ai', $g10A, 10, 'strong'],
            ['SUN-10A02', 'Ananya Rao',    null,                    $g10A, 10, 'weak'],
            ['SUN-10A03', 'Ishaan Verma',  null,                    $g10A, 10, 'mid'],
            ['SUN-10A04', 'Meera Nair',    null,                    $g10A, 10, 'inactive'],
            ['SUN-10A05', 'Rohan Gupta',   null,                    $g10A, 10, 'strong'],
            ['SUN-10A06', 'Sara Khan',     null,                    $g10A, 10, 'weak'],
            ['SUN-10B01', 'Aditya Patel',  null,                    $g10B, 10, 'strong'],
            ['SUN-10B02', 'Nisha Reddy',   null,                    $g10B, 10, 'mid'],
            ['SUN-10B03', 'Vivaan Shah',   null,                    $g10B, 10, 'weak'],
            ['SUN-10B04', 'Tara Menon',    null,                    $g10B, 10, 'mid'],
            ['SUN-10B05', 'Arjun Desai',   null,                    $g10B, 10, 'inactive'],
            ['SUN-09A01', 'Zara Sheikh',   null,                    $g9A,  9,  'strong'],
            ['SUN-09A02', 'Dev Malhotra',  null,                    $g9A,  9,  'weak'],
            ['SUN-09A03', 'Anaya Iyer',    null,                    $g9A,  9,  'mid'],
            ['SUN-09A04', 'Kabir Bose',    null,                    $g9A,  9,  'inactive'],
            ['SUN-09A05', 'Riya Kapoor',   null,                    $g9A,  9,  'mid'],
        ];

        $created = [];
        foreach ($roster as [$code, $name, $email, $section, $grade, $tier]) {
            $student = User::firstOrCreate(
                ['login_code' => $code],
                array_filter([
                    'name'       => $name,
                    'email'      => $email,
                    'password'   => self::PASSWORD,
                    'role'       => 'student',
                    'school_id'  => $school->id,
                    'section_id' => $section->id,
                    'level_id'   => $grade === 10 ? $class10?->id : $class9?->id,
                    'board'      => 'cbse',
                    'grade'      => $grade,
                ], fn ($v) => $v !== null),
            );
            $created[$code] = $student;
            $this->seedActivity($student, $tier);
        }

        $parent = User::where('email', 'parent@tuto.ai')->first();
        if ($parent) {
            foreach (['SUN-10A01', 'SUN-10A03'] as $code) {
                if (isset($created[$code])) {
                    $parent->children()->syncWithoutDetaching([$created[$code]->id => ['relationship' => 'father']]);
                }
            }
        }

        // A demo assignment per section (fixed mode) with mixed completion, so
        // the teacher's assignment gradebook + completion insights show data.
        $this->seedAssignment($g10A, $teacher, 'Real Numbers — Class Test');
        $this->seedAssignment($g10B, $teacher, 'Real Numbers — Class Test');
        $this->seedAssignment($g9A, $teacher3, 'Number Systems — Class Test');

        // Enforce the demo password on every school account, even pre-existing
        // rows (firstOrCreate won't update an account that already exists).
        User::where('school_id', $school->id)->get()->each(function (User $u) {
            if (! Hash::check(self::PASSWORD, $u->password)) {
                $u->forceFill(['password' => self::PASSWORD])->save();
            }
        });
    }

    /**
     * A fixed-mode assignment materialised across a section: ~2/3 of students
     * have completed it (with scores), the rest are still pending. Idempotent.
     */
    private function seedAssignment(Section $section, User $teacher, string $title): void
    {
        $assignment = Assignment::firstOrCreate(
            ['section_id' => $section->id, 'title' => $title],
            [
                'school_id' => $section->school_id, 'teacher_id' => $teacher->id,
                'type' => 'assessment', 'mode' => 'fixed',
            ],
        );

        foreach ($section->students()->get()->values() as $i => $student) {
            $done = $i % 3 !== 2;   // every 3rd student left it pending
            Assessment::firstOrCreate(
                ['assignment_id' => $assignment->id, 'user_id' => $student->id],
                [
                    'topic_name' => 'Real Numbers',
                    'status'     => $done ? 'completed' : 'pending',
                    'total'      => 10,
                    'score'      => $done ? rand(5, 10) : null,
                    'completed_at' => $done ? now()->subDays(1) : null,
                ],
            );
        }
    }

    private function teacher(School $school, string $email, string $name): User
    {
        return User::firstOrCreate(
            ['email' => $email],
            ['name' => $name, 'password' => self::PASSWORD, 'role' => 'teacher', 'school_id' => $school->id],
        );
    }

    /**
     * Seed a differentiated learning history per performance tier so the
     * dashboards show a real spread (leaderboards, at-risk lists, distribution,
     * trends). Idempotent via each table's unique key / an existence guard.
     */
    private function seedActivity(User $student, string $tier): void
    {
        // tier => [conceptScale, snapshotPeak, daysSinceActive, streakRange, gapProfile, quizScore]
        $p = [
            'strong'   => [0.90, 88, 0,  [6, 12], 'none',   9],
            'mid'      => [0.62, 66, 1,  [2, 5],  'medium', 6],
            'weak'     => [0.40, 44, 3,  [0, 2],  'high',   3],
            'inactive' => [0.36, 40, 16, [0, 0],  'high',   3],
        ][$tier];
        [$scale, $peak, $sinceActive, $streak, $gapProfile, $quizScore] = $p;

        // Demo activity is authoritative: reset then reseed so re-runs (and
        // pre-existing flat data) always reflect the student's tier.
        ProgressSnapshot::where('user_id', $student->id)->delete();
        ConceptMastery::where('user_id', $student->id)->delete();
        KnowledgeGap::where('user_id', $student->id)->delete();
        Assessment::where('user_id', $student->id)->delete();

        // Engagement signals.
        $student->forceFill([
            'last_active_date' => Carbon::today()->subDays($sinceActive)->toDateString(),
            'current_streak'   => rand($streak[0], $streak[1]),
        ])->save();

        // 14 days of mastery snapshots rising toward the tier peak.
        foreach (range(13, 0) as $i) {
            $ramp = $peak - (int) ($i * ($peak * 0.02));
            ProgressSnapshot::create([
                'user_id' => $student->id,
                'day' => Carbon::today()->subDays($i)->toDateString(),
                'mastery' => max(10, min(100, $ramp)),
                'topics_studied' => rand(1, 3),
                'questions_answered' => rand(3, 9),
                'gaps_closed' => rand(0, 2),
            ]);
        }

        // Concept mastery (0..1 EWMA) scaled to the tier, with a little jitter.
        $concepts = [
            ['Real Numbers', "Euclid's Division Lemma"],
            ['Real Numbers', 'Fundamental Theorem of Arithmetic'],
            ['Real Numbers', 'Irrational Numbers'],
            ['Polynomials', 'Zeroes of a Polynomial'],
            ['Polynomials', 'Division Algorithm'],
        ];
        foreach ($concepts as [$topic, $concept]) {
            $score = max(0.05, min(0.98, $scale + (rand(-8, 8) / 100)));
            ConceptMastery::create([
                'user_id' => $student->id, 'topic_name' => $topic, 'concept' => $concept,
                'score' => $score, 'confidence' => rand(2, 5), 'last_seen_at' => now()->subDays(rand(0, 4)),
            ]);
        }

        // Open gaps per profile (shared concept names → dashboard gap clusters).
        if ($gapProfile === 'high') {
            KnowledgeGap::create(['user_id' => $student->id, 'topic_name' => 'Real Numbers', 'concept' => "Euclid's Division Lemma", 'severity' => 'high', 'recommendation' => 'Revisit the lemma with 2–3 worked examples, then a short quiz.', 'resolved' => false]);
            KnowledgeGap::create(['user_id' => $student->id, 'topic_name' => 'Polynomials', 'concept' => 'Division Algorithm', 'severity' => 'high', 'recommendation' => 'Practise polynomial long division on 3 problems.', 'resolved' => false]);
        } elseif ($gapProfile === 'medium') {
            KnowledgeGap::create(['user_id' => $student->id, 'topic_name' => 'Polynomials', 'concept' => 'Division Algorithm', 'severity' => 'medium', 'recommendation' => 'Practise polynomial long division on 3 problems.', 'resolved' => false]);
        }

        // A couple of completed assessments so completion/score KPIs render.
        $n = $tier === 'inactive' ? 1 : 2;
        foreach (array_slice(['Real Numbers', 'Polynomials'], 0, $n) as $j => $topic) {
            Assessment::create([
                'user_id' => $student->id,
                'topic_name' => $topic,
                'status' => 'completed',
                'score' => $quizScore,
                'total' => 10,
                'completed_at' => now()->subDays($sinceActive + $j),
            ]);
        }
    }
}
