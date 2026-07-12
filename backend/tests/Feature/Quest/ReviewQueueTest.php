<?php

namespace Tests\Feature\Quest;

use App\Models\EvidenceEvent;
use App\Models\GameInstance;
use App\Models\SkillMastery;
use App\Models\User;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Spaced repetition + daily goal. The review queue must surface mastered topics
 * gone stale — and ONLY those — and the daily goal must count learning wins
 * (passed games/quizzes), never raw activity.
 */
class ReviewQueueTest extends TestCase
{
    use DatabaseTransactions, BuildsCurriculum;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCurriculum();
        $this->user = $this->student();
        Sanctum::actingAs($this->user);
    }

    private function master(string $topic, int $daysAgo): void
    {
        SkillMastery::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topics[$topic]->id,
            'p_mastered' => 0.95, 'observations' => 5,
        ]);
        $e = EvidenceEvent::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topics[$topic]->id,
            'topic_name' => $topic, 'subject_id' => $this->subject->id,
            'correct' => true, 'difficulty' => 3,
        ]);
        DB::table('evidence_events')->where('id', $e->id)
            ->update(['created_at' => now()->subDays($daysAgo)]);
    }

    public function test_a_stale_mastered_topic_is_due_and_a_fresh_one_is_not(): void
    {
        $this->master('A', 10); // stale → due
        $this->master('B', 2);  // fresh → not due

        $res = $this->getJson('/api/quest/review')->assertOk();

        $this->assertSame(1, $res->json('total_due'));
        $this->assertSame($this->topics['A']->id, $res->json('due.0.topic_id'));
        $this->assertGreaterThanOrEqual(7, $res->json('due.0.days_since'));
    }

    public function test_an_unmastered_topic_is_never_in_the_review_queue(): void
    {
        // Stale evidence but low mastery — that's a gap, not a review.
        SkillMastery::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topics['A']->id,
            'p_mastered' => 0.40, 'observations' => 2,
        ]);
        $e = EvidenceEvent::create([
            'user_id' => $this->user->id, 'topic_id' => $this->topics['A']->id,
            'topic_name' => 'A', 'subject_id' => $this->subject->id,
            'correct' => false, 'difficulty' => 3,
        ]);
        DB::table('evidence_events')->where('id', $e->id)
            ->update(['created_at' => now()->subDays(20)]);

        $this->getJson('/api/quest/review')->assertOk()->assertJson(['total_due' => 0]);
    }

    public function test_the_daily_goal_counts_a_passed_game_today_by_first_attempts(): void
    {
        $game = GameInstance::create([
            'topic_id' => $this->topics['A']->id, 'topic_name' => 'A',
            'subject_id' => $this->subject->id, 'mechanic' => 'compare',
            'difficulty' => 2, 'title' => 'A', 'validated' => true,
            'items' => [[], [], []],
        ]);
        // 3 items: two right, one missed then fixed — first attempts = 2/3 = 67%?
        // No: 2 correct + 1 wrong first attempt = 67% < 70 → not a win yet.
        foreach ([[0, true], [1, true], [2, false], [2, true]] as [$i, $ok]) {
            EvidenceEvent::create([
                'user_id' => $this->user->id, 'topic_id' => $this->topics['A']->id,
                'topic_name' => 'A', 'subject_id' => $this->subject->id,
                'game_instance_id' => $game->id, 'item_index' => $i,
                'correct' => $ok, 'difficulty' => 2,
            ]);
        }
        $daily = app(GamificationService::class)->dailyProgress($this->user);
        $this->assertSame(0, $daily['done']); // the retry can't buy the win

        // A clean 3/3 game IS a win.
        $game2 = $game->replicate()->fill(['items' => [[], [], []]]);
        $game2->save();
        foreach ([0, 1, 2] as $i) {
            EvidenceEvent::create([
                'user_id' => $this->user->id, 'topic_id' => $this->topics['A']->id,
                'topic_name' => 'A', 'subject_id' => $this->subject->id,
                'game_instance_id' => $game2->id, 'item_index' => $i,
                'correct' => true, 'difficulty' => 2,
            ]);
        }
        $daily = app(GamificationService::class)->dailyProgress($this->user);
        $this->assertSame(1, $daily['done']);
        $this->assertSame(GamificationService::DAILY_GOAL, $daily['goal']);
        $this->assertFalse($daily['met']);
    }

    public function test_the_stats_payload_carries_the_daily_goal(): void
    {
        $this->getJson('/api/tutor/me/gamification')->assertOk()
            ->assertJsonPath('daily.goal', GamificationService::DAILY_GOAL)
            ->assertJsonPath('daily.done', 0);
    }
}
