<?php

namespace App\Services;

use App\Models\Flashcard;

/**
 * Spaced repetition (SM-2). Grades: 0..5 where <3 is a lapse. Updates the
 * card's ease, interval and next due date so it resurfaces right before the
 * student would forget it.
 */
class SrsService
{
    public function review(Flashcard $card, int $grade): Flashcard
    {
        $grade = max(0, min(5, $grade));

        if ($grade < 3) {
            // Lapse — relearn from the start.
            $card->repetitions = 0;
            $card->interval_days = 1;
        } else {
            $card->repetitions += 1;
            $card->interval_days = match ($card->repetitions) {
                1       => 1,
                2       => 6,
                default => max(1, (int) round($card->interval_days * $card->ease)),
            };
        }

        // SM-2 ease update, floored at 1.3.
        $card->ease = max(1.3, $card->ease + (0.1 - (5 - $grade) * (0.08 + (5 - $grade) * 0.02)));
        $card->last_reviewed_at = now();
        $card->due_at = now()->addDays($card->interval_days);
        $card->save();

        return $card;
    }
}
