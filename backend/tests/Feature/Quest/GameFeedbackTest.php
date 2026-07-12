<?php

namespace Tests\Feature\Quest;

use App\Models\GameInstance;
use Laravel\Sanctum\Sanctum;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * Feedback that teaches: a first miss earns exactly one retry (hint, no answer),
 * the finished item reveals the answer + a mini-lesson, and the final score
 * counts FIRST attempts only — so retrying reinforces but can't be farmed.
 */
class GameFeedbackTest extends TestCase
{
    use DatabaseTransactions, BuildsCurriculum;

    private GameInstance $game;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCurriculum();
        Sanctum::actingAs($this->student());

        $this->game = GameInstance::create([
            'topic_id'   => $this->topics['A']->id,
            'topic_name' => 'A',
            'subject_id' => $this->subject->id,
            'mechanic'   => 'fill_blank',
            'difficulty' => 3,
            'title'      => 'A — Level 3',
            'validated'  => true,
            'items'      => [
                [
                    'prompt' => 'Complete it', 'answer' => 'photosynthesis', 'distractors' => [],
                    'hint'    => 'Plants and sunlight.',
                    'explain' => 'Green plants make their own food using sunlight — that process is photosynthesis.',
                    'params'  => ['kind' => 'fill_blank',
                        'sentence' => 'Plants make food by _____ in the leaves.',
                        'options'  => ['photosynthesis', 'respiration', 'digestion']],
                ],
                [
                    'prompt' => 'Order them', 'answer' => 'Seed | Sprout | Plant', 'distractors' => [],
                    'hint'    => 'What comes out of the ground first?',
                    'explain' => 'A seed sprouts before it can grow into a plant.',
                    'params'  => ['kind' => 'sequence',
                        'steps' => ['Seed', 'Sprout', 'Plant'], 'shuffled' => ['Plant', 'Seed', 'Sprout']],
                ],
            ],
        ]);
    }

    private function answer(int $index, mixed $value)
    {
        return $this->postJson("/api/quest/games/{$this->game->id}/answer", [
            'item_index' => $index, 'answer' => $value,
        ]);
    }

    public function test_a_first_miss_offers_a_retry_and_reveals_nothing(): void
    {
        $res = $this->answer(0, 'respiration');

        $res->assertOk()
            ->assertJson(['correct' => false, 'can_retry' => true])
            ->assertJsonMissingPath('explain')
            ->assertJsonMissingPath('correct_answer');
    }

    public function test_a_second_miss_reveals_the_answer_and_the_mini_lesson(): void
    {
        $this->answer(0, 'respiration');
        $res = $this->answer(0, 'digestion');

        $res->assertOk()
            ->assertJson([
                'correct'        => false,
                'correct_answer' => 'photosynthesis',
                'explain'        => 'Green plants make their own food using sunlight — that process is photosynthesis.',
            ])
            ->assertJsonMissingPath('can_retry');
    }

    public function test_a_correct_answer_gets_the_mini_lesson_immediately(): void
    {
        $res = $this->answer(0, 'photosynthesis');

        $res->assertOk()
            ->assertJson(['correct' => true])
            ->assertJsonPath('explain', 'Green plants make their own food using sunlight — that process is photosynthesis.')
            ->assertJsonMissingPath('can_retry')
            ->assertJsonMissingPath('correct_answer'); // they found it themselves
    }

    public function test_a_revealed_sequence_answer_reads_as_arrows_not_grader_syntax(): void
    {
        $this->answer(1, ['Plant', 'Seed', 'Sprout']);
        $res = $this->answer(1, ['Sprout', 'Seed', 'Plant']);

        $res->assertJsonPath('correct_answer', 'Seed → Sprout → Plant');
    }

    public function test_the_score_counts_only_the_first_attempt_per_item(): void
    {
        // Item 0: missed, then fixed on the retry. Item 1: right first time.
        $this->answer(0, 'respiration');
        $this->answer(0, 'photosynthesis');
        $this->answer(1, ['Seed', 'Sprout', 'Plant']);

        $res = $this->postJson("/api/quest/games/{$this->game->id}/finish");

        // 3 evidence rows, but 2 items — and item 0's FIRST attempt was wrong.
        $res->assertOk()->assertJson(['score' => 1, 'total' => 2, 'percent' => 50]);
    }
}
