<?php

namespace Database\Seeders;

use App\Models\Chapter;
use App\Models\Level;
use App\Models\Subject;
use App\Models\Topic;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Kindergarten curriculum, aligned to the CBSE / NCF Foundational-Stage
 * (Balvatika) goals — early numeracy, early literacy, and "the world around
 * me" — expressed as a play-first quest.
 *
 * Every topic name is chosen so {@see \App\Services\Quest\MechanicPicker} routes
 * it to a VISUAL, non-reading mechanic a 5-year-old can play without instructions:
 *   count / add          → number_line   (hop the frog)
 *   more or less         → compare       (feed the alligator)
 *   number patterns      → pattern       (see the jumps, tap the next)
 *   classify / sort      → sort_bucket   (drop stickers into bins)
 *   rhyme                → rhyme_pick    (pop the matching bubble)
 *   spelling / phonics   → word_builder  (tap letters, with a picture)
 *
 * Idempotent (firstOrCreate on slugs) — safe to re-run, never refreshes the DB.
 */
class KindergartenCurriculumSeeder extends Seeder
{
    public function run(): void
    {
        $kg = Level::whereHas('track', fn ($q) => $q->where('slug', 'cbse'))
            ->where('class_number', 0)->first();

        if (! $kg) {
            $this->command?->warn('Kindergarten level not found — run SchoolClassesSeeder first.');
            return;
        }

        // subject => [emoji, tint, blurb, [ chapter => [topics...] ]]
        $subjects = [
            ['Numbers & Counting', '🔢', 'sky', 'Count, add and spot number patterns through play.', [
                ['Fun with Numbers', [
                    'Addition to 5',
                    'Compare More or Less',
                    'Counting Number Patterns',
                ]],
                ['Shapes & Sorting', [
                    'Sorting Shapes',
                    'Sorting Big and Small',
                ]],
            ]],

            ['Letters & Words', '🔤', 'amber', 'First sounds, rhymes and simple words.', [
                // Chapter name deliberately avoids "rhyme" so only the rhyming
                // topic routes to rhyme_pick; phonics → word_builder.
                ['Sounds and Listening', [
                    'Rhyming Words',
                    'Beginning Sounds Phonics',
                ]],
                ['My First Words', [
                    'Spelling Simple Words',
                    'Spelling Sight Words',
                ]],
            ]],

            ['My Colourful World', '🌍', 'emerald', 'Explore animals, plants and colours around you.', [
                ['Living Things', [
                    'Living and Non-Living Things',
                    'Sorting Farm and Wild Animals',
                ]],
                ['Everyday World', [
                    'Sorting Fruits and Vegetables',
                    'Sorting by Colour',
                ]],
            ]],
        ];

        $topicCount = 0;
        foreach ($subjects as $si => [$sName, $emoji, $tint, $blurb, $chapters]) {
            $subject = Subject::firstOrCreate(
                ['level_id' => $kg->id, 'slug' => Str::slug($sName)],
                ['name' => $sName, 'emoji' => $emoji, 'tint' => $tint, 'blurb' => $blurb,
                 'position' => $si, 'is_active' => true],
            );

            foreach ($chapters as $ci => [$cName, $topics]) {
                $chapter = Chapter::firstOrCreate(
                    ['subject_id' => $subject->id, 'slug' => Str::slug($cName)],
                    ['name' => $cName, 'position' => $ci],
                );

                foreach ($topics as $ti => $tName) {
                    Topic::firstOrCreate(
                        ['chapter_id' => $chapter->id, 'slug' => Str::slug($tName)],
                        ['name' => $tName, 'position' => $ti],
                    );
                    $topicCount++;
                }
            }
        }

        $this->command?->info("Kindergarten curriculum ready: 3 subjects, {$topicCount} play topics.");
    }
}
