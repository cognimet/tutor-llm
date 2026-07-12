<?php

namespace Tests\Feature;

use App\Models\Assessment;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Models\ConceptMastery;
use App\Models\EvidenceEvent;
use App\Models\GameInstance;
use App\Models\SkillMastery;
use App\Services\TopicProgressService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Quest\BuildsCurriculum;
use Tests\TestCase;

/**
 * Per-topic progress is a *cache* recomputed from the real signals, so these
 * tests write the signals and assert the derived row — never the other way round.
 */
class TopicProgressServiceTest extends TestCase
{
    // DatabaseTransactions, never RefreshDatabase: each test rolls back rather
    // than dropping and recreating the schema. See Tests\TestCase.
    use DatabaseTransactions, BuildsCurriculum;

    private TopicProgressService $service;
    private \App\Models\User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCurriculum(['Fractions']);
        $this->user = $this->student();
        $this->service = app(TopicProgressService::class);
    }

    private function topic(): \App\Models\Topic
    {
        return $this->topics['Fractions'];
    }

    private function recompute(): \App\Models\TopicProgress
    {
        return $this->service->recompute($this->user, $this->topic()->id, 'Fractions');
    }

    private function chatTurns(int $n): void
    {
        $session = ChatSession::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topic()->id,
            'title' => 'Fractions', 'topic_name' => 'Fractions',
        ]);
        for ($i = 0; $i < $n; $i++) {
            ChatMessage::create(['chat_session_id' => $session->id, 'role' => 'user', 'content' => "q{$i}"]);
            ChatMessage::create(['chat_session_id' => $session->id, 'role' => 'tutor', 'content' => "a{$i}"]);
        }
    }

    private function quiz(int $score, int $total): void
    {
        Assessment::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topic()->id, 'topic_name' => 'Fractions',
            'status' => 'completed', 'score' => $score, 'total' => $total, 'completed_at' => now(),
        ]);
    }

    /** A finished game: `hits` of `total` items correct. */
    private function game(int $hits, int $total): GameInstance
    {
        $game = GameInstance::create([
            'topic_id' => $this->topic()->id, 'topic_name' => 'Fractions', 'subject_id' => $this->subject->id,
            'mechanic' => 'pizza', 'difficulty' => 3, 'title' => 'g', 'items' => [], 'validated' => true,
        ]);
        for ($i = 0; $i < $total; $i++) {
            EvidenceEvent::create([
                'user_id' => $this->user->id, 'topic_id' => $this->topic()->id, 'topic_name' => 'Fractions',
                'subject_id' => $this->subject->id, 'game_instance_id' => $game->id,
                'item_index' => $i, 'correct' => $i < $hits, 'difficulty' => 3,
            ]);
        }
        return $game;
    }

    private function conceptMastery(float $score): void
    {
        ConceptMastery::updateOrCreate(
            ['user_id' => $this->user->id, 'topic_name' => 'Fractions', 'concept' => 'equivalence'],
            ['score' => $score, 'confidence' => 3, 'last_seen_at' => now()],
        );
    }

    /** Cover (and, at score >= 0.8, master) $n distinct syllabus concepts. */
    private function coverConcepts(int $n, float $score = 0.85): void
    {
        for ($i = 0; $i < $n; $i++) {
            ConceptMastery::updateOrCreate(
                ['user_id' => $this->user->id, 'topic_name' => 'Fractions', 'concept' => "concept-{$i}"],
                ['score' => $score, 'confidence' => 3, 'last_seen_at' => now()],
            );
        }
    }

    /* ------------------------------ zero state ---------------------------- */

    public function test_a_topic_with_no_activity_is_not_started(): void
    {
        $row = $this->recompute();
        $this->assertSame('not_started', $row->status);
        $this->assertSame(0, $row->percent);
    }

    public function test_a_missing_row_presents_as_the_zero_state(): void
    {
        $view = $this->service->present(null);
        $this->assertSame('not_started', $view['status']);
        $this->assertSame(0, $view['percent']);
        $this->assertFalse($view['checklist']['learned']);
    }

    /* -------------------------------- blend ------------------------------- */

    public function test_learn_fills_to_a_quarter_over_three_turns(): void
    {
        $this->chatTurns(1);
        $this->assertSame(8, $this->recompute()->percent); // 1/3 * 25 ≈ 8

        $this->chatTurns(2); // 3 user turns total
        $row = $this->recompute();
        $this->assertSame(25, $row->percent);
        $this->assertSame('in_progress', $row->status);
    }

    public function test_learn_does_not_exceed_its_share(): void
    {
        $this->chatTurns(20);
        $this->assertSame(25, $this->recompute()->percent);
    }

    public function test_concept_mastery_drives_the_largest_share(): void
    {
        $this->conceptMastery(0.6);
        $row = $this->recompute();

        $this->assertSame(60, $row->mastery_pct);
        // 0.6*50 mastery (30) + partial learn credit for covering 1 of 3 concepts
        // (1/3 * 25 ≈ 8); no practice yet.
        $this->assertSame(38, $row->percent);
    }

    /* ------------------------- games as practice -------------------------- */

    public function test_a_played_game_counts_as_practice_and_records_its_best_score(): void
    {
        $this->game(hits: 5, total: 6); // 83%
        $row = $this->recompute();

        $this->assertSame(1, $row->games_played);
        $this->assertSame(83, $row->best_game_pct);
        $this->assertSame(0, $row->assessments_taken);
        $this->assertSame('in_progress', $row->status);
        $this->assertGreaterThanOrEqual(25, $row->percent, 'practice share is earned by play');
    }

    public function test_the_best_game_wins_and_a_later_worse_game_does_not_lower_it(): void
    {
        $this->game(hits: 6, total: 6);
        $this->game(hits: 1, total: 6);

        $row = $this->recompute();
        $this->assertSame(2, $row->games_played);
        $this->assertSame(100, $row->best_game_pct);
    }

    public function test_bkt_mastery_is_used_when_it_beats_the_concept_ewma(): void
    {
        $this->conceptMastery(0.40);
        SkillMastery::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topic()->id,
            'p_mastered' => 0.90, 'observations' => 4,
        ]);

        $this->assertSame(90, $this->recompute()->mastery_pct);
    }

    public function test_an_unobserved_bkt_prior_does_not_inflate_mastery(): void
    {
        // The 0.10 prior means "no evidence", not "10% mastered".
        SkillMastery::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topic()->id,
            'p_mastered' => 0.10, 'observations' => 0,
        ]);

        $this->assertSame(0, $this->recompute()->mastery_pct);
    }

    /* ------------------------------ completion ---------------------------- */

    public function test_a_topic_completes_when_the_syllabus_is_covered_mastered_and_a_quiz_passed(): void
    {
        $this->chatTurns(3);
        $this->coverConcepts(3, 0.85); // 3 syllabus concepts covered AND mastered
        $this->quiz(8, 10);            // 80% >= 70

        $row = $this->recompute();
        $this->assertSame('completed', $row->status);
        $this->assertSame(100, $row->percent);
        $this->assertNotNull($row->completed_at);
        $this->assertSame(3, $row->concepts_covered);
        $this->assertSame(3, $row->concepts_passed);
    }

    public function test_chatting_without_covering_the_syllabus_does_not_complete(): void
    {
        // Ten chat turns + a passed quiz, but only ONE syllabus concept actually
        // engaged: the topic is NOT learned. Completion is the syllabus, not chatter.
        $this->chatTurns(10);
        $this->quiz(10, 10);
        $this->conceptMastery(0.95); // one concept only

        $row = $this->recompute();
        $this->assertNotSame('completed', $row->status);
        $this->assertFalse($this->service->present($row)['checklist']['learned']);
    }

    public function test_covering_the_syllabus_without_mastering_it_does_not_complete(): void
    {
        // Three concepts touched but weak (below the pass bar): covered, not mastered.
        $this->chatTurns(4);
        $this->coverConcepts(3, 0.5); // score 0.5 → not passed
        $this->quiz(9, 10);

        $row = $this->recompute();
        $this->assertNotSame('completed', $row->status);
        $this->assertSame(3, $row->concepts_covered);
        $this->assertSame(0, $row->concepts_passed);
    }

    public function test_a_passed_game_can_complete_a_topic_without_a_quiz(): void
    {
        $this->chatTurns(3);
        $this->game(hits: 6, total: 6);
        SkillMastery::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topic()->id,
            'p_mastered' => 0.90, 'observations' => 6,
        ]);

        $this->assertSame('completed', $this->recompute()->status);
    }

    public function test_mastery_alone_does_not_complete_a_topic(): void
    {
        $this->conceptMastery(0.95);
        $this->assertNotSame('completed', $this->recompute()->status);
    }

    public function test_completion_is_sticky_across_a_later_failure(): void
    {
        $this->chatTurns(3);
        $this->quiz(9, 10);
        $this->coverConcepts(3, 0.9);
        $this->assertSame('completed', $this->recompute()->status);
        $completedAt = $this->recompute()->completed_at;

        // A bad day later must not take the badge away, nor dip the bar.
        $this->quiz(2, 10);
        $row = $this->recompute();

        $this->assertSame('completed', $row->status);
        $this->assertSame(100, $row->percent);
        $this->assertEquals($completedAt, $row->completed_at, 'completed_at is not rewritten');
    }

    /* ------------------------------- lookups ------------------------------ */

    public function test_the_bulk_map_is_keyed_by_both_id_and_name(): void
    {
        $this->chatTurns(1);
        $this->recompute();

        $map = $this->service->mapFor($this->user, [$this->topic()->id], ['Fractions']);
        $this->assertArrayHasKey('id:' . $this->topic()->id, $map);
        $this->assertArrayHasKey('name:Fractions', $map);
    }

    public function test_in_progress_lists_only_unfinished_topics(): void
    {
        $this->chatTurns(1);
        $this->recompute();
        $this->assertCount(1, $this->service->inProgress($this->user));

        $this->quiz(10, 10);
        $this->coverConcepts(3, 0.95);
        $this->chatTurns(3);
        $this->recompute();

        $this->assertCount(0, $this->service->inProgress($this->user));
    }

    public function test_recording_a_game_recomputes_the_topic(): void
    {
        $game = $this->game(hits: 4, total: 6);
        $row = $this->service->recordGame($this->user, $game);

        $this->assertSame(1, $row->games_played);
        $this->assertSame(67, $row->best_game_pct);
    }
}
