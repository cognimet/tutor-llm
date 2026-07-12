<?php

namespace App\Services\Quest;

/**
 * The auto-solver / validator — the single most important safety property of the
 * game pipeline.
 *
 * Port of the validation half of LearnQuest's `engines/game_generator.py`.
 *
 * The rule (blueprint §3): **the LLM never writes game code, and its content is
 * never trusted.** Mechanics are hand-built templates with a JSON content
 * contract; whatever authors a payload — a deterministic PHP author or Gemini —
 * every item is independently re-solved here before it can be stored with
 * validated=true. Nothing that fails reaches a child.
 *
 * The AI service runs the same checks in Python before returning a payload; this
 * is the second, authoritative gate on the write path.
 */
class GameValidator
{
    /** Every mechanic the engine knows how to render and re-solve. */
    public const MECHANICS = [
        'number_line', 'build_number', 'compare', 'pizza',
        'word_builder', 'word_match', 'rhyme_pick', 'sort_bucket', 'sentence_builder',
        'fill_blank', 'sequence', 'pattern',
    ];

    /** Mechanics whose content is authored deterministically in PHP (never by an LLM). */
    public const DETERMINISTIC = ['number_line', 'build_number', 'compare', 'pizza'];

    /**
     * Validate a whole instance.
     *
     * @param  array $items  the authored items
     * @return array{0:bool,1:string[]}  [ok, errors]
     */
    public function validate(array $items): array
    {
        $errors = [];
        if (! $items) {
            $errors[] = 'no items';
        }
        foreach (array_values($items) as $i => $item) {
            foreach ($this->validateItem($item) as $e) {
                $errors[] = "item {$i}: {$e}";
            }
        }
        return [count($errors) === 0, $errors];
    }

    /** Drop only the items that fail, keeping a partially-good payload usable. */
    public function keepValid(array $items): array
    {
        return array_values(array_filter($items, fn ($it) => $this->validateItem($it) === []));
    }

    /** @return string[] the reasons this single item is unusable (empty = valid). */
    public function validateItem(array $item): array
    {
        $errors  = [];
        $answer  = (string) ($item['answer'] ?? '');
        $params  = is_array($item['params'] ?? null) ? $item['params'] : [];
        $kind    = (string) ($params['kind'] ?? '');
        $distr   = is_array($item['distractors'] ?? null) ? $item['distractors'] : [];

        if (trim((string) ($item['prompt'] ?? '')) === '') {
            $errors[] = 'empty prompt';
        }
        if (in_array($answer, array_map('strval', $distr), true)) {
            $errors[] = 'answer duplicated in distractors';
        }

        switch ($kind) {
            case 'number_line':
            case 'build_number':
            case 'compare':
            case 'pizza':
                // Re-derive the answer from the prompt, independently of the author.
                $expected = $this->solveMath($kind, (string) ($item['prompt'] ?? ''), $params);
                if ($expected !== null && $expected !== $answer) {
                    $errors[] = "solver mismatch: {$answer} != {$expected}";
                }
                $errors = array_merge($errors, $this->checkMathParams($kind, $params, $answer));
                break;

            case 'word_builder':
                $word    = (string) ($params['word'] ?? '');
                $letters = is_array($params['letters'] ?? null) ? array_map('strval', $params['letters']) : [];
                if ($word === '') {
                    $errors[] = 'word_builder has no target word';
                }
                if ($answer !== $word) {
                    $errors[] = 'answer != target word';
                }
                // Every letter of the word must be available among the tiles.
                $pool = $letters;
                foreach (mb_str_split($word) as $ch) {
                    $idx = array_search($ch, $pool, true);
                    if ($idx === false) {
                        $errors[] = "letter '{$ch}' missing from tiles";
                        break;
                    }
                    unset($pool[$idx]);
                    $pool = array_values($pool);
                }
                break;

            case 'word_match':
                $pairs = is_array($params['pairs'] ?? null) ? $params['pairs'] : [];
                if (count($pairs) < 2) {
                    $errors[] = 'word_match needs >= 2 pairs';
                    break;
                }
                $lefts  = array_map(fn ($p) => (string) ($p['left'] ?? ''), $pairs);
                $rights = array_map(fn ($p) => (string) ($p['right'] ?? ''), $pairs);
                if (in_array('', $lefts, true) || in_array('', $rights, true)) {
                    $errors[] = 'word_match pair missing a side';
                }
                // Two identical right-hand sides make the match ambiguous — a child
                // could be "wrong" while being right.
                if (count(array_unique($rights)) !== count($rights)) {
                    $errors[] = 'ambiguous match (duplicate right-hand sides)';
                }
                if (count(array_unique($lefts)) !== count($lefts)) {
                    $errors[] = 'ambiguous match (duplicate left-hand sides)';
                }
                break;

            case 'rhyme_pick':
                $options = is_array($params['options'] ?? null) ? array_map('strval', $params['options']) : [];
                if (count($options) < 2) {
                    $errors[] = 'rhyme_pick needs >= 2 options';
                }
                if (! in_array($answer, $options, true)) {
                    $errors[] = 'answer not among options';
                }
                if (count(array_unique($options)) !== count($options)) {
                    $errors[] = 'duplicate options';
                }
                break;

            case 'sort_bucket':
                $bins  = is_array($params['bins'] ?? null) ? array_map('strval', $params['bins']) : [];
                $elems = is_array($params['items'] ?? null) ? $params['items'] : [];
                if (count($bins) < 2) {
                    $errors[] = 'sort needs >= 2 bins';
                }
                if (count($elems) < 2) {
                    $errors[] = 'sort needs >= 2 items';
                }
                $texts = [];
                foreach ($elems as $e) {
                    $bin  = (string) ($e['bin'] ?? '');
                    $text = (string) ($e['text'] ?? '');
                    if (! in_array($bin, $bins, true)) {
                        $errors[] = "bin '{$bin}' not in bins";
                        break;
                    }
                    if ($text === '') {
                        $errors[] = 'sort item has empty text';
                        break;
                    }
                    $texts[] = $text;
                }
                // The same token in two bins would be unsolvable.
                if (count(array_unique($texts)) !== count($texts)) {
                    $errors[] = 'duplicate sort items';
                }
                break;

            case 'sentence_builder':
                $solution = is_array($params['solution'] ?? null) ? array_map('strval', $params['solution']) : [];
                $tiles    = is_array($params['tiles'] ?? null) ? array_map('strval', $params['tiles']) : [];
                if (count($solution) < 2) {
                    $errors[] = 'sentence needs >= 2 words';
                }
                $s = $solution; $t = $tiles;
                sort($s); sort($t);
                if ($s !== $t) {
                    $errors[] = 'tiles not a permutation of solution';
                }
                if (implode(' ', $solution) !== $answer) {
                    $errors[] = 'answer != joined solution';
                }
                break;

            case 'fill_blank':
                // A real syllabus statement with one key term blanked out; the
                // student reads the sentence and taps the term that completes it.
                $sentence = (string) ($params['sentence'] ?? '');
                $options  = is_array($params['options'] ?? null) ? array_map('strval', $params['options']) : [];
                if (! str_contains($sentence, '_____')) {
                    $errors[] = 'fill_blank sentence has no blank';
                }
                if (mb_strlen(trim($sentence)) < 12) {
                    $errors[] = 'fill_blank sentence too short to study from';
                }
                if (count($options) < 3) {
                    $errors[] = 'fill_blank needs >= 3 options';
                }
                if (! in_array($answer, $options, true)) {
                    $errors[] = 'fill_blank answer not among options';
                }
                if (count(array_unique($options)) !== count($options)) {
                    $errors[] = 'fill_blank duplicate options';
                }
                break;

            case 'sequence':
                // Order the steps/events of a process. `steps` is the correct
                // order (the answer); `shuffled` is what the student rearranges.
                $steps    = is_array($params['steps'] ?? null) ? array_map('strval', $params['steps']) : [];
                $shuffled = is_array($params['shuffled'] ?? null) ? array_map('strval', $params['shuffled']) : [];
                if (count($steps) < 3) {
                    $errors[] = 'sequence needs >= 3 steps';
                }
                if (count(array_unique($steps)) !== count($steps)) {
                    $errors[] = 'sequence has duplicate steps';
                }
                $a = $steps; $b = $shuffled;
                sort($a); sort($b);
                if ($a !== $b) {
                    $errors[] = 'shuffled is not a permutation of steps';
                }
                if (implode(' | ', $steps) !== $answer) {
                    $errors[] = 'answer != ordered steps';
                }
                break;

            case 'pattern':
                // Learn-by-doing: the child SEES a growing number pattern (the
                // jumps are shown), discovers the rule, and taps the next term.
                // We RE-SOLVE the pattern here (arithmetic / geometric / figurate),
                // so a child is never marked wrong on a mis-keyed answer.
                $terms   = is_array($params['terms'] ?? null) ? $params['terms'] : [];
                $options = is_array($params['options'] ?? null) ? array_map('strval', $params['options']) : [];
                if (count($terms) < 3) {
                    $errors[] = 'pattern needs >= 3 visible terms to learn from';
                }
                $nums = array_map('floatval', $terms);
                $next = $this->solvePattern($nums);
                if ($next === null) {
                    $errors[] = 'pattern is not re-solvable (no simple rule)';
                } elseif (abs($next - (float) $answer) > 1e-6) {
                    $errors[] = 'pattern solver mismatch';
                }
                if (count($options) < 3) {
                    $errors[] = 'pattern needs >= 3 options';
                }
                if (! in_array($answer, $options, true)) {
                    $errors[] = 'pattern answer not among options';
                }
                if (count(array_unique($options)) !== count($options)) {
                    $errors[] = 'pattern duplicate options';
                }
                break;

            default:
                $errors[] = "unknown mechanic '{$kind}'";
        }

        return $errors;
    }

    /**
     * Independently re-solve a math item from its prompt. Returns null when the
     * prompt shape isn't recognised (then only the param checks apply).
     */
    protected function solveMath(string $kind, string $prompt, array $params): ?string
    {
        if ($kind === 'number_line') {
            if (! preg_match('/\s*(\d+)\s*([+\-x\/×÷])\s*(\d+)\s*=/u', $prompt, $m)) {
                return null;
            }
            [$a, $op, $b] = [(int) $m[1], $m[2], (int) $m[3]];
            return match ($op) {
                '+' => (string) ($a + $b),
                '-' => (string) ($a - $b),
                'x', '×' => (string) ($a * $b),
                '/', '÷' => $b !== 0 ? (string) intdiv($a, $b) : null,
                default => null,
            };
        }

        if ($kind === 'compare') {
            if (! preg_match('/(\d+)\s*__\s*(\d+)/u', $prompt, $m)) {
                return null;
            }
            [$a, $b] = [(int) $m[1], (int) $m[2]];
            return $a > $b ? '>' : ($a < $b ? '<' : '=');
        }

        if ($kind === 'build_number') {
            return preg_match('/Build the number (\d+)/u', $prompt, $m) ? $m[1] : null;
        }

        if ($kind === 'pizza') {
            return preg_match('/cut into (\d+) equal parts/u', $prompt, $m)
                ? '1/' . $m[1]
                : null;
        }

        return null;
    }

    /**
     * Re-derive the next term of a number pattern, so the game teaches a REAL
     * rule and can never mark a child wrong on a mis-keyed answer. Handles the
     * three families Classes 1–6 actually meet:
     *   - arithmetic  (constant 1st difference):  2,4,6,8 → 10
     *   - geometric   (constant ratio):           3,6,12,24 → 48
     *   - figurate    (constant 2nd difference):  1,3,6,10 → 15 ; 1,4,9,16 → 25
     * Returns null when no simple rule fits (then the item is dropped, unserved).
     */
    protected function solvePattern(array $t): ?float
    {
        $n = count($t);
        if ($n < 3) {
            return null;
        }

        // First differences.
        $d1 = [];
        for ($i = 1; $i < $n; $i++) {
            $d1[] = $t[$i] - $t[$i - 1];
        }
        if ($this->allClose($d1)) {
            return $t[$n - 1] + $d1[0];
        }

        // Geometric: a constant ratio (no zero term to divide by).
        $ratios = [];
        $geo = true;
        for ($i = 1; $i < $n; $i++) {
            if (abs($t[$i - 1]) < 1e-9) { $geo = false; break; }
            $ratios[] = $t[$i] / $t[$i - 1];
        }
        if ($geo && $this->allClose($ratios)) {
            return $t[$n - 1] * $ratios[0];
        }

        // Figurate / quadratic: a constant SECOND difference.
        if (count($d1) >= 2) {
            $d2 = [];
            for ($i = 1; $i < count($d1); $i++) {
                $d2[] = $d1[$i] - $d1[$i - 1];
            }
            if ($this->allClose($d2)) {
                return $t[$n - 1] + ($d1[count($d1) - 1] + $d2[0]);
            }
        }

        return null;
    }

    /** True when every value in the list is (near-)equal to the first. */
    protected function allClose(array $xs): bool
    {
        if ($xs === []) {
            return false;
        }
        foreach ($xs as $x) {
            if (abs($x - $xs[0]) > 1e-6) {
                return false;
            }
        }
        return true;
    }

    /** Structural checks on the params the renderer relies on. */
    protected function checkMathParams(string $kind, array $params, string $answer): array
    {
        $errors = [];

        if ($kind === 'number_line') {
            $min = $params['min'] ?? null;
            $max = $params['max'] ?? null;
            if (! is_numeric($min) || ! is_numeric($max) || $min >= $max) {
                $errors[] = 'number_line needs min < max';
            } elseif (! is_numeric($answer) || $answer < $min || $answer > $max) {
                $errors[] = 'answer outside the number line range';
            }
        }

        if ($kind === 'build_number') {
            $target = $params['target'] ?? null;
            if (! is_numeric($target) || (string) $target !== $answer) {
                $errors[] = 'build_number target != answer';
            } elseif ($target < 0 || $target > 999) {
                $errors[] = 'build_number target must fit hundreds/tens/ones';
            }
        }

        if ($kind === 'compare') {
            if (! is_numeric($params['a'] ?? null) || ! is_numeric($params['b'] ?? null)) {
                $errors[] = 'compare needs numeric a and b';
            }
        }

        if ($kind === 'pizza') {
            $parts = $params['parts'] ?? null;
            $shade = $params['shade'] ?? null;
            if (! is_numeric($parts) || $parts < 2) {
                $errors[] = 'pizza needs >= 2 parts';
            } elseif (! is_numeric($shade) || $shade < 1 || $shade > $parts) {
                $errors[] = 'pizza shade must be between 1 and parts';
            }
        }

        return $errors;
    }
}
