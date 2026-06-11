<?php

namespace Database\Seeders;

use App\Models\Level;
use App\Models\ModelRate;
use App\Models\Plan;
use App\Models\ProgressSnapshot;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(CurriculumSeeder::class);
        $this->seedPlansAndRates();

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
    }

    /**
     * Default plans + model rates (token spec §5/§6). All admin-editable;
     * weights are a product lever — generous on chat, gate expensive actions.
     */
    protected function seedPlansAndRates(): void
    {
        $weights = ['chat' => 1, 'assess_gen' => 3, 'grade' => 1, 'gap' => 1, 'plan' => 1, 'report' => 2];

        Plan::firstOrCreate(['name' => 'Free'], [
            'price_inr' => 0,
            'daily_credit_limit' => 30,
            'monthly_credit_limit' => 600,
            'per_action_weights' => $weights,
            'features' => ['1 chapter unlocked', 'Daily AI credits', 'Mini-assessments'],
        ]);

        Plan::firstOrCreate(['name' => 'Plus'], [
            'price_inr' => 499,
            'daily_credit_limit' => 200,
            'monthly_credit_limit' => 5000,
            'per_action_weights' => $weights,
            'features' => ['Full subject', 'Unlimited learning loop', 'Priority AI'],
        ]);

        Plan::firstOrCreate(['name' => 'Family'], [
            'price_inr' => 899,
            'daily_credit_limit' => 200,
            'monthly_credit_limit' => 5000,
            'per_action_weights' => $weights,
            'features' => ['Up to 3 children', 'Full parent reporting', 'Everything in Plus'],
        ]);

        // Indicative Gemini Flash pricing in INR per 1k tokens (admin-editable).
        ModelRate::firstOrCreate(['model' => 'gemini-2.5-flash'], [
            'input_rate_per_1k' => 0.025,
            'output_rate_per_1k' => 0.21,
            'currency' => 'INR',
            'effective_from' => now(),
        ]);
        ModelRate::firstOrCreate(['model' => 'mock'], [
            'input_rate_per_1k' => 0,
            'output_rate_per_1k' => 0,
            'currency' => 'INR',
            'effective_from' => now(),
        ]);
    }
}
