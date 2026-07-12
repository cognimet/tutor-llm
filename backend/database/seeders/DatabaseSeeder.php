<?php

namespace Database\Seeders;

use App\Models\Level;
use App\Models\ProgressSnapshot;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(CurriculumSeeder::class);
        $this->call(SchoolClassesSeeder::class);         // fill in K–12 so students can pick any class
        $this->call(KindergartenCurriculumSeeder::class); // KG quest content (CBSE/NCF foundational)
        $this->call(PlanSeeder::class);
        $this->call(ContentSeeder::class);
        $this->call(NcertMathsContentSeeder::class);   // full NCERT Class 10 Maths textbook
        $this->call(NcertScienceContentSeeder::class); // full NCERT Class 10 Science textbook
        $this->call(NcertSocialGeographyContentSeeder::class); // SST · Geography
        $this->call(NcertSocialEconomicsContentSeeder::class); // SST · Economics
        $this->call(NcertSocialHistoryContentSeeder::class);   // SST · History
        $this->call(NcertClass6MathsContentSeeder::class);        // NCERT Class 6 Maths (Ganita Prakash PDFs)
        $this->call(NcertClass6MathsCuratedContentSeeder::class);   // NCERT Class 6 Maths (curated RAG doc)
        $this->call(NcertClass6ScienceCuratedContentSeeder::class); // NCERT Class 6 Science (curated RAG doc)

        // Resolve a couple of CBSE levels to scope the demo students.
        $cbseClass10 = Level::whereHas('track', fn ($q) => $q->where('slug', 'cbse'))
            ->where('class_number', 10)->whereNull('stream')->first();
        $cbseClass8 = Level::whereHas('track', fn ($q) => $q->where('slug', 'cbse'))
            ->where('class_number', 8)->whereNull('stream')->first();

        // --- Demo accounts (one per role) ---
        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@tuto.ai',
            'password' => 'password',
            'role' => 'admin',
        ]);

        $student = User::create([
            'name' => 'Aarav Sharma',
            'email' => 'student@tuto.ai',
            'password' => 'password',
            'role' => 'student',
            'level_id' => $cbseClass10?->id,
            'board' => 'cbse',
            'grade' => 10,
            'language' => 'en',
        ]);

        $student2 = User::create([
            'name' => 'Diya Sharma',
            'email' => 'student2@tuto.ai',
            'password' => 'password',
            'role' => 'student',
            'level_id' => $cbseClass8?->id,
            'board' => 'cbse',
            'grade' => 8,
            'language' => 'en',
        ]);

        $parent = User::create([
            'name' => 'Mr. Sharma',
            'email' => 'parent@tuto.ai',
            'password' => 'password',
            'role' => 'parent',
        ]);

        // Link both children to the parent.
        $parent->children()->attach($student->id, ['relationship' => 'father']);
        $parent->children()->attach($student2->id, ['relationship' => 'father']);

        // Seed a few days of progress so dashboards aren't empty.
        foreach (range(6, 0) as $i) {
            ProgressSnapshot::create([
                'user_id' => $student->id,
                'day' => Carbon::today()->subDays($i)->toDateString(),
                'mastery' => 50 + (6 - $i) * 6,
                'topics_studied' => rand(1, 3),
                'questions_answered' => rand(3, 9),
                'gaps_closed' => rand(0, 2),
            ]);
        }

        // Demo B2B2C school (School + Teacher panels). Idempotent — also runnable
        // standalone via `php artisan db:seed --class=SchoolDemoSeeder`.
        $this->call(SchoolDemoSeeder::class);
    }
}
