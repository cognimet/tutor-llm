<?php

namespace App\Services\Quest;

/**
 * Grades a student's response against the stored item.
 *
 * Grading happens on the server, never in the client. The browser is told what to
 * render (`GameInstance::forPlay()` strips every answer), and it posts back only
 * what the child did. Correctness drives BKT mastery, IRT ability, XP and topic
 * completion — none of which may be settable by editing a request.
 */
class GameGrader
{
    /**
     * @param  array $item       the stored item (with `answer` and solution params)
     * @param  mixed $submitted  whatever the client posted for this item
     */
    public function isCorrect(array $item, mixed $submitted): bool
    {
        $params = is_array($item['params'] ?? null) ? $item['params'] : [];
        $answer = (string) ($item['answer'] ?? '');

        return match ($params['kind'] ?? '') {
            // The child drags a marker / builds a number / picks a comparator.
            'number_line', 'build_number' => is_numeric($submitted) && (string) (int) $submitted === $answer,
            'compare'                     => is_string($submitted) && $submitted === $answer,

            // The child shades slices; correct when the count equals the target.
            'pizza' => is_numeric($submitted) && (int) $submitted === (int) ($params['shade'] ?? 0),

            // The child assembles the word / sentence from tiles.
            'word_builder'     => is_string($submitted) && mb_strtolower(trim($submitted)) === mb_strtolower($answer),
            'sentence_builder' => is_string($submitted) && trim($submitted) === $answer,

            // The child taps the term that completes the syllabus statement.
            'fill_blank' => is_string($submitted) && trim($submitted) === $answer,

            // The child orders the steps of a process; joined with the same sep.
            'sequence' => $this->joinsTo($submitted, $answer),

            // The child extends a number pattern — the next term, graded by value
            // (so "10", 10 and 10.0 all match) rather than by string.
            'pattern' => is_numeric($submitted) && is_numeric($answer)
                && abs((float) $submitted - (float) $answer) < 1e-6,

            // The child picks one balloon.
            'rhyme_pick' => is_string($submitted) && $submitted === $answer,

            // Map answers: every pair / every item must land correctly.
            'word_match'  => $this->mapMatches($params['pairs'] ?? [], $submitted, 'left', 'right'),
            'sort_bucket' => $this->mapMatches($params['items'] ?? [], $submitted, 'text', 'bin'),

            default => false,
        };
    }

    /**
     * The student's ordered steps (an array, or already a "a | b | c" string)
     * must join to exactly the correct order.
     */
    protected function joinsTo(mixed $submitted, string $answer): bool
    {
        if (is_array($submitted)) {
            $submitted = implode(' | ', array_map('strval', $submitted));
        }
        return is_string($submitted) && trim($submitted) === $answer;
    }

    /**
     * Compare a submitted {key: value} map against the item's truth table. Every
     * key must be present and correct — a partially sorted bucket is not a pass.
     */
    protected function mapMatches(array $truthRows, mixed $submitted, string $keyField, string $valField): bool
    {
        if (is_string($submitted)) {
            $submitted = json_decode($submitted, true);
        }
        if (! is_array($submitted) || ! $truthRows) {
            return false;
        }

        foreach ($truthRows as $row) {
            $key = (string) ($row[$keyField] ?? '');
            $val = (string) ($row[$valField] ?? '');
            if (! array_key_exists($key, $submitted) || (string) $submitted[$key] !== $val) {
                return false;
            }
        }
        return count($submitted) === count($truthRows);
    }
}
