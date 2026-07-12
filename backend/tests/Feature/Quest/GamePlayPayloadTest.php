<?php

namespace Tests\Feature\Quest;

use App\Models\GameInstance;
use Tests\TestCase;

/**
 * The play payload must not contain the answer — in `answer`, and, less obviously,
 * anywhere inside `params`. A leak here would make every mechanic cheatable from
 * the browser's network tab, and would silently corrupt BKT mastery.
 */
class GamePlayPayloadTest extends TestCase
{
    private function play(string $mechanic, array $params, string $answer = 'secret'): array
    {
        $game = new GameInstance([
            'topic_name' => 'T', 'mechanic' => $mechanic, 'difficulty' => 3, 'title' => 'T',
            'items' => [['prompt' => 'p', 'answer' => $answer, 'distractors' => [], 'hint' => 'h', 'params' => $params]],
        ]);
        return $game->forPlay()['items'][0];
    }

    public function test_the_answer_field_is_never_sent(): void
    {
        $item = $this->play('compare', ['kind' => 'compare', 'a' => 7, 'b' => 3]);
        $this->assertArrayNotHasKey('answer', $item);
        $this->assertSame(['prompt', 'hint', 'params'], array_keys($item));
    }

    public function test_number_line_hides_the_result(): void
    {
        $params = $this->play('number_line', [
            'kind' => 'number_line', 'op' => '+', 'a' => 7, 'b' => 5,
            'answer' => 12, 'min' => 0, 'max' => 20,
        ])['params'];

        $this->assertArrayNotHasKey('answer', $params);
        $this->assertSame(7, $params['a']); // the operands ARE the puzzle
    }

    public function test_build_number_and_pizza_hide_their_targets(): void
    {
        $build = $this->play('build_number', ['kind' => 'build_number', 'target' => 342, 'hundreds' => 3, 'tens' => 4, 'ones' => 2])['params'];
        $this->assertSame(['kind'], array_keys($build));

        $pizza = $this->play('pizza', ['kind' => 'pizza', 'parts' => 6, 'shade' => 1])['params'];
        $this->assertArrayNotHasKey('shade', $pizza);
        $this->assertSame(6, $pizza['parts']);
    }

    public function test_word_builder_hides_the_target_word(): void
    {
        $params = $this->play('word_builder', [
            'kind' => 'word_builder', 'word' => 'cat', 'emoji' => '🐱', 'letters' => ['t', 'c', 'a', 'x'],
        ])['params'];

        $this->assertArrayNotHasKey('word', $params);
        $this->assertSame(['t', 'c', 'a', 'x'], $params['letters']);
    }

    public function test_word_match_sends_the_two_columns_apart(): void
    {
        $params = $this->play('word_match', ['kind' => 'word_match', 'pairs' => [
            ['left' => 'Force', 'right' => 'a push or pull'],
            ['left' => 'Mass', 'right' => 'amount of matter'],
        ]])['params'];

        // The pairing is the answer, so `pairs` must not survive.
        $this->assertArrayNotHasKey('pairs', $params);
        $this->assertSame(['Force', 'Mass'], $params['lefts']);
        $this->assertEqualsCanonicalizing(['a push or pull', 'amount of matter'], $params['rights']);
    }

    public function test_sort_bucket_hides_each_items_bin(): void
    {
        $params = $this->play('sort_bucket', ['kind' => 'sort_bucket', 'bins' => ['Solid', 'Liquid'], 'items' => [
            ['text' => 'ice', 'bin' => 'Solid'],
            ['text' => 'water', 'bin' => 'Liquid'],
        ]])['params'];

        $this->assertEqualsCanonicalizing(['ice', 'water'], $params['items']);
        $this->assertSame(['Solid', 'Liquid'], $params['bins']);
        foreach ($params['items'] as $item) {
            $this->assertIsString($item); // not a {text, bin} pair
        }
    }

    public function test_fill_blank_sends_the_sentence_and_options_but_not_the_answer(): void
    {
        $params = $this->play('fill_blank', [
            'kind' => 'fill_blank',
            'sentence' => 'Plants make food by _____ in the leaves.',
            'options' => ['photosynthesis', 'respiration', 'digestion'],
        ], 'photosynthesis')['params'];

        $this->assertArrayNotHasKey('answer', $params);
        $this->assertStringContainsString('_____', $params['sentence']);
        $this->assertContains('photosynthesis', $params['options']); // it's one MCQ option, unmarked
    }

    public function test_sequence_sends_only_the_shuffled_tiles_not_the_correct_order(): void
    {
        $params = $this->play('sequence', [
            'kind' => 'sequence',
            'steps' => ['Prophase', 'Metaphase', 'Anaphase'],       // the answer
            'shuffled' => ['Anaphase', 'Prophase', 'Metaphase'],
        ])['params'];

        $this->assertArrayNotHasKey('steps', $params);              // correct order must not ship
        $this->assertEqualsCanonicalizing(['Prophase', 'Metaphase', 'Anaphase'], $params['tiles']);
    }

    public function test_pattern_sends_the_visible_terms_and_options_but_not_the_answer(): void
    {
        $params = $this->play('pattern', [
            'kind' => 'pattern',
            'terms' => [2, 4, 6, 8],           // the teaching scaffold — safe to show
            'options' => [10, 11, 12],         // the answer is one of these, unmarked
        ], '10')['params'];

        $this->assertArrayNotHasKey('answer', $params);
        $this->assertSame([2, 4, 6, 8], $params['terms']);
        $this->assertContains(10, $params['options']);
    }

    public function test_sentence_builder_hides_the_solution_and_rhyme_hides_its_answer(): void
    {
        $sentence = $this->play('sentence_builder', [
            'kind' => 'sentence_builder', 'solution' => ['the', 'dog', 'runs'], 'tiles' => ['runs', 'the', 'dog'],
        ])['params'];
        $this->assertArrayNotHasKey('solution', $sentence);
        $this->assertSame(['runs', 'the', 'dog'], $sentence['tiles']);

        $rhyme = $this->play('rhyme_pick', [
            'kind' => 'rhyme_pick', 'word' => 'cat', 'answer' => 'hat', 'options' => ['dog', 'hat', 'pen'],
        ])['params'];
        $this->assertArrayNotHasKey('answer', $rhyme);
        $this->assertContains('hat', $rhyme['options']);
    }
}
