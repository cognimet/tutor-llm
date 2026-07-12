<?php

namespace Database\Seeders;

use App\Models\Level;
use App\Models\Track;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Fill in the missing school classes so a student can always pick the class they
 * belong to — Kindergarten through Class 12 on the CBSE (School) board.
 *
 * The CBSE track was seeded with only the classes that have curriculum content
 * (6, 8, 9, 10, 11, 12). This adds the rest (K, 1–5, 7) as selectable levels and
 * re-orders every CBSE level so the picker lists them K → 12.
 *
 * Idempotent: firstOrCreate keyed on (track, class_number, stream) — safe to run
 * repeatedly, never refreshes the database.
 */
class SchoolClassesSeeder extends Seeder
{
    public function run(): void
    {
        $cbse = Track::where('slug', 'cbse')->first();
        if (! $cbse) {
            $this->command?->warn('CBSE track not found — skipping SchoolClassesSeeder.');
            return;
        }

        // class_number => display name. Kindergarten is class 0.
        $classes = [
            0 => 'Kindergarten',
            1 => 'Class 1', 2 => 'Class 2', 3 => 'Class 3', 4 => 'Class 4',
            5 => 'Class 5', 7 => 'Class 7',
        ];

        foreach ($classes as $n => $name) {
            Level::firstOrCreate(
                ['track_id' => $cbse->id, 'class_number' => $n, 'stream' => null],
                ['name' => $name, 'slug' => Str::slug($name), 'position' => $n, 'is_active' => true],
            );
        }

        // Re-order the whole board so it reads K, 1, 2, … 12 in the picker.
        // position = class_number keeps plain classes in order; the streamed 11/12
        // levels sort right after their number (order within a class is by id).
        foreach ($cbse->levels()->whereNotNull('class_number')->get() as $level) {
            if ((int) $level->position !== (int) $level->class_number) {
                $level->update(['position' => (int) $level->class_number]);
            }
        }

        $this->command?->info('School classes K–12 ensured on CBSE (added missing K, 1–5, 7).');
    }
}
