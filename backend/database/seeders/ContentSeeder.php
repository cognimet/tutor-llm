<?php

namespace Database\Seeders;

use App\Models\ContentChunk;
use App\Models\Topic;
use Illuminate\Database\Seeder;

/**
 * Sample curriculum content for the RAG knowledge base, so the tutor has real
 * material to ground answers in out of the box. Attached to the CBSE Class 10
 * "Ohm's Law" topic (seeded by CurriculumSeeder). After seeding, run
 * `php artisan rag:index` to push these into the vector store.
 */
class ContentSeeder extends Seeder
{
    public function run(): void
    {
        $topic = Topic::where('name', "Ohm's Law")->first();
        if (! $topic) {
            return;
        }

        $chunks = [
            ['type' => 'explainer', 'body' =>
                "Ohm's Law states that the current (I) flowing through a conductor between two points is "
                . "directly proportional to the voltage (V) across the two points, provided the temperature "
                . "stays constant. The constant of proportionality is the resistance (R). The relationship is "
                . "V = I × R, where V is in volts, I in amperes, and R in ohms (Ω)."],
            ['type' => 'example', 'body' =>
                "Worked example: A 6 V battery drives a current of 2 A through a wire. The resistance is "
                . "R = V / I = 6 / 2 = 3 Ω. If the voltage were doubled to 12 V with the same wire, the current "
                . "would double to 4 A, because I = V / R = 12 / 3."],
            ['type' => 'misconception', 'body' =>
                "Common misconception: students often rearrange V = I × R incorrectly, writing R = I / V instead "
                . "of R = V / I. Always isolate the quantity you want: to find R, divide voltage by current. "
                . "Another mistake is forgetting Ohm's Law only holds at constant temperature for ohmic conductors."],
            ['type' => 'explainer', 'body' =>
                "A V–I graph for an ohmic conductor is a straight line through the origin; its slope equals the "
                . "resistance. A curved or non-linear V–I graph indicates a non-ohmic conductor (such as a diode "
                . "or a filament lamp), for which Ohm's Law does not apply directly."],
        ];

        foreach ($chunks as $c) {
            ContentChunk::create([
                'topic_id' => $topic->id,
                'type' => $c['type'],
                'body' => $c['body'],
                'source_ref' => 'NCERT Class 10 Science, Ch. Electricity',
            ]);
        }
    }
}
