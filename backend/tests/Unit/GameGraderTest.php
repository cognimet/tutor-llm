<?php

namespace Tests\Unit;

use App\Services\Quest\GameGrader;
use PHPUnit\Framework\TestCase;

/** Grading decides mastery, XP and completion — so it must be strict. */
class GameGraderTest extends TestCase
{
    private GameGrader $grader;

    protected function setUp(): void
    {
        parent::setUp();
        $this->grader = new GameGrader();
    }

    public function test_it_grades_numeric_mechanics(): void
    {
        $item = ['answer' => '12', 'params' => ['kind' => 'number_line']];
        $this->assertTrue($this->grader->isCorrect($item, 12));
        $this->assertTrue($this->grader->isCorrect($item, '12'));
        $this->assertFalse($this->grader->isCorrect($item, 13));
    }

    public function test_pizza_grades_the_number_of_shaded_slices(): void
    {
        $item = ['answer' => '1/4', 'params' => ['kind' => 'pizza', 'parts' => 4, 'shade' => 1]];
        $this->assertTrue($this->grader->isCorrect($item, 1));
        $this->assertFalse($this->grader->isCorrect($item, 2));
    }

    public function test_word_builder_is_case_insensitive(): void
    {
        $item = ['answer' => 'photosynthesis', 'params' => ['kind' => 'word_builder']];
        $this->assertTrue($this->grader->isCorrect($item, 'Photosynthesis'));
        $this->assertFalse($this->grader->isCorrect($item, 'photosynthesi'));
    }

    public function test_word_match_requires_every_pair(): void
    {
        $item = ['answer' => '', 'params' => ['kind' => 'word_match', 'pairs' => [
            ['left' => 'Force', 'right' => 'a push or pull'],
            ['left' => 'Mass',  'right' => 'amount of matter'],
        ]]];

        $this->assertTrue($this->grader->isCorrect($item, [
            'Force' => 'a push or pull', 'Mass' => 'amount of matter',
        ]));

        // One right, one wrong -> not a pass.
        $this->assertFalse($this->grader->isCorrect($item, [
            'Force' => 'a push or pull', 'Mass' => 'a push or pull',
        ]));

        // A partial submission is not a pass either.
        $this->assertFalse($this->grader->isCorrect($item, ['Force' => 'a push or pull']));
    }

    public function test_sort_bucket_accepts_a_json_encoded_submission(): void
    {
        $item = ['answer' => '', 'params' => ['kind' => 'sort_bucket', 'items' => [
            ['text' => 'ice', 'bin' => 'Solid'],
            ['text' => 'water', 'bin' => 'Liquid'],
        ]]];

        $this->assertTrue($this->grader->isCorrect($item, json_encode(['ice' => 'Solid', 'water' => 'Liquid'])));
        $this->assertFalse($this->grader->isCorrect($item, json_encode(['ice' => 'Liquid', 'water' => 'Solid'])));
    }

    public function test_fill_blank_grades_the_chosen_term(): void
    {
        $item = ['answer' => 'photosynthesis', 'params' => ['kind' => 'fill_blank']];
        $this->assertTrue($this->grader->isCorrect($item, 'photosynthesis'));
        $this->assertFalse($this->grader->isCorrect($item, 'respiration'));
    }

    public function test_sequence_requires_the_exact_order(): void
    {
        $item = ['answer' => 'A | B | C', 'params' => ['kind' => 'sequence']];
        $this->assertTrue($this->grader->isCorrect($item, ['A', 'B', 'C']));
        $this->assertTrue($this->grader->isCorrect($item, 'A | B | C'));      // pre-joined
        $this->assertFalse($this->grader->isCorrect($item, ['A', 'C', 'B'])); // wrong order
        $this->assertFalse($this->grader->isCorrect($item, ['A', 'B']));      // incomplete
    }

    public function test_pattern_grades_the_next_term_by_value(): void
    {
        $item = ['answer' => '10', 'params' => ['kind' => 'pattern']];
        $this->assertTrue($this->grader->isCorrect($item, 10));
        $this->assertTrue($this->grader->isCorrect($item, '10'));
        $this->assertFalse($this->grader->isCorrect($item, 12));
        $this->assertFalse($this->grader->isCorrect($item, 'ten'));
    }

    public function test_it_never_passes_an_unknown_mechanic_or_junk(): void
    {
        $this->assertFalse($this->grader->isCorrect(['answer' => 'x', 'params' => ['kind' => 'nope']], 'x'));
        $this->assertFalse($this->grader->isCorrect(['answer' => '1', 'params' => ['kind' => 'number_line']], ['not' => 'scalar']));
    }
}
