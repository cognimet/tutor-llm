<?php

namespace Tests\Unit;

use App\Services\Quest\GameValidator;
use PHPUnit\Framework\TestCase;

/**
 * The validator is the safety property of the whole game pipeline: nothing
 * reaches a child unless it re-solves. These tests are the ones that matter most.
 *
 * Mirrors the assertions in LearnQuest's `tests/test_core_loop.py`.
 */
class GameValidatorTest extends TestCase
{
    private GameValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new GameValidator();
    }

    private function numberLine(string $prompt, string $answer, int $max = 50): array
    {
        return [
            'prompt' => $prompt, 'answer' => $answer, 'distractors' => [], 'hint' => '',
            'params' => ['kind' => 'number_line', 'op' => '+', 'a' => 1, 'b' => 2, 'min' => 0, 'max' => $max],
        ];
    }

    public function test_it_accepts_a_correctly_keyed_arithmetic_item(): void
    {
        $this->assertSame([], $this->validator->validateItem($this->numberLine('7 + 5 = ?', '12')));
    }

    public function test_it_catches_a_wrongly_keyed_arithmetic_item(): void
    {
        $errors = $this->validator->validateItem($this->numberLine('7 + 5 = ?', '13'));
        $this->assertNotEmpty($errors);
        $this->assertStringContainsString('solver mismatch', $errors[0]);
    }

    public function test_it_rejects_an_answer_outside_the_number_line(): void
    {
        // 40 + 40 = 80, but the rendered line only reaches 50 — unplayable.
        $errors = $this->validator->validateItem($this->numberLine('40 + 40 = ?', '80', max: 50));
        $this->assertContains('answer outside the number line range', $errors);
    }

    public function test_it_solves_every_arithmetic_operator(): void
    {
        foreach ([['9 - 4 = ?', '5'], ['6 x 7 = ?', '42'], ['20 / 4 = ?', '5']] as [$prompt, $answer]) {
            $this->assertSame([], $this->validator->validateItem($this->numberLine($prompt, $answer, 100)), $prompt);
        }
    }

    public function test_it_re_derives_the_comparison_operator(): void
    {
        $item = fn ($ans) => ['prompt' => 'Compare: 7 __ 3', 'answer' => $ans, 'distractors' => [],
                              'params' => ['kind' => 'compare', 'a' => 7, 'b' => 3]];

        $this->assertSame([], $this->validator->validateItem($item('>')));
        $this->assertNotEmpty($this->validator->validateItem($item('<')));
    }

    public function test_it_rejects_a_word_builder_missing_a_letter(): void
    {
        $errors = $this->validator->validateItem([
            'prompt' => 'Spell it', 'answer' => 'cat', 'distractors' => [],
            'params' => ['kind' => 'word_builder', 'word' => 'cat', 'letters' => ['c', 'a', 'x']],
        ]);
        $this->assertContains("letter 't' missing from tiles", $errors);
    }

    public function test_it_rejects_an_ambiguous_match(): void
    {
        // Two terms sharing a meaning: a child could match correctly and be marked wrong.
        $errors = $this->validator->validateItem([
            'prompt' => 'Match', 'answer' => '{}', 'distractors' => [],
            'params' => ['kind' => 'word_match', 'pairs' => [
                ['left' => 'Force', 'right' => 'a push or pull'],
                ['left' => 'Thrust', 'right' => 'a push or pull'],
            ]],
        ]);
        $this->assertContains('ambiguous match (duplicate right-hand sides)', $errors);
    }

    public function test_it_rejects_a_sort_item_in_an_unknown_bin(): void
    {
        $errors = $this->validator->validateItem([
            'prompt' => 'Sort', 'answer' => '{}', 'distractors' => [],
            'params' => ['kind' => 'sort_bucket', 'bins' => ['Solid', 'Liquid'], 'items' => [
                ['text' => 'ice', 'bin' => 'Solid'],
                ['text' => 'steam', 'bin' => 'Gas'],
            ]],
        ]);
        $this->assertContains("bin 'Gas' not in bins", $errors);
    }

    public function test_it_rejects_sentence_tiles_that_are_not_a_permutation(): void
    {
        $errors = $this->validator->validateItem([
            'prompt' => 'Order the words', 'answer' => 'the dog runs', 'distractors' => [],
            'params' => ['kind' => 'sentence_builder', 'solution' => ['the', 'dog', 'runs'], 'tiles' => ['the', 'dog']],
        ]);
        $this->assertContains('tiles not a permutation of solution', $errors);
    }

    public function test_it_rejects_a_rhyme_whose_answer_is_absent_from_the_options(): void
    {
        $errors = $this->validator->validateItem([
            'prompt' => 'Rhyme', 'answer' => 'hat', 'distractors' => [],
            'params' => ['kind' => 'rhyme_pick', 'word' => 'cat', 'options' => ['dog', 'sun', 'pen']],
        ]);
        $this->assertContains('answer not among options', $errors);
    }

    public function test_fill_blank_requires_a_blank_and_the_answer_among_options(): void
    {
        $ok = [
            'prompt' => 'Complete it', 'answer' => 'photosynthesis', 'distractors' => [],
            'params' => ['kind' => 'fill_blank',
                'sentence' => 'Green plants make food by _____ in their leaves.',
                'options' => ['photosynthesis', 'respiration', 'digestion']],
        ];
        $this->assertSame([], $this->validator->validateItem($ok));

        // No blank in the sentence.
        $noBlank = $ok;
        $noBlank['params']['sentence'] = 'Green plants make food in their leaves.';
        $this->assertContains('fill_blank sentence has no blank', $this->validator->validateItem($noBlank));

        // Answer isn't one of the options.
        $badAns = $ok;
        $badAns['answer'] = 'osmosis';
        $this->assertContains('fill_blank answer not among options', $this->validator->validateItem($badAns));
    }

    public function test_sequence_requires_three_ordered_distinct_steps(): void
    {
        $steps = ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'];
        $ok = [
            'prompt' => 'Order them', 'answer' => implode(' | ', $steps), 'distractors' => [],
            'params' => ['kind' => 'sequence', 'steps' => $steps,
                'shuffled' => ['Telophase', 'Prophase', 'Anaphase', 'Metaphase']],
        ];
        $this->assertSame([], $this->validator->validateItem($ok));

        // Shuffled isn't a permutation of the steps.
        $bad = $ok;
        $bad['params']['shuffled'] = ['Prophase', 'Metaphase', 'Interphase', 'Telophase'];
        $this->assertContains('shuffled is not a permutation of steps', $this->validator->validateItem($bad));

        // Fewer than three steps.
        $short = ['prompt' => 'x', 'answer' => 'A | B', 'params' => ['kind' => 'sequence',
            'steps' => ['A', 'B'], 'shuffled' => ['B', 'A']]];
        $this->assertContains('sequence needs >= 3 steps', $this->validator->validateItem($short));
    }

    public function test_pattern_re_solves_arithmetic_geometric_and_figurate(): void
    {
        $ok = fn ($terms, $answer) => [
            'prompt' => 'Next?', 'answer' => (string) $answer, 'distractors' => [],
            'params' => ['kind' => 'pattern', 'terms' => $terms,
                'options' => [(string) $answer, '99', '77']],
        ];
        // arithmetic 2,4,6,8 → 10 ; geometric 3,6,12,24 → 48 ; triangular 1,3,6,10 → 15.
        $this->assertSame([], $this->validator->validateItem($ok([2, 4, 6, 8], 10)));
        $this->assertSame([], $this->validator->validateItem($ok([3, 6, 12, 24], 48)));
        $this->assertSame([], $this->validator->validateItem($ok([1, 3, 6, 10], 15)));
    }

    public function test_pattern_rejects_a_wrong_next_and_a_missing_answer_option(): void
    {
        $mismatch = [
            'prompt' => 'Next?', 'answer' => '11', 'distractors' => [],
            'params' => ['kind' => 'pattern', 'terms' => [2, 4, 6, 8], 'options' => ['11', '10', '12']],
        ];
        $this->assertContains('pattern solver mismatch', $this->validator->validateItem($mismatch));

        $notAnOption = [
            'prompt' => 'Next?', 'answer' => '10', 'distractors' => [],
            'params' => ['kind' => 'pattern', 'terms' => [2, 4, 6, 8], 'options' => ['12', '14', '16']],
        ];
        $this->assertContains('pattern answer not among options', $this->validator->validateItem($notAnOption));
    }

    public function test_it_rejects_an_unknown_mechanic(): void
    {
        $errors = $this->validator->validateItem(['prompt' => 'x', 'answer' => 'y', 'params' => ['kind' => 'tower_defense']]);
        $this->assertContains("unknown mechanic 'tower_defense'", $errors);
    }

    public function test_an_empty_instance_is_invalid(): void
    {
        [$ok, $errors] = $this->validator->validate([]);
        $this->assertFalse($ok);
        $this->assertContains('no items', $errors);
    }

    public function test_keep_valid_drops_only_the_bad_items(): void
    {
        $good = $this->numberLine('2 + 2 = ?', '4');
        $bad  = $this->numberLine('2 + 2 = ?', '5');

        $kept = $this->validator->keepValid([$good, $bad, $good]);
        $this->assertCount(2, $kept);
    }
}
