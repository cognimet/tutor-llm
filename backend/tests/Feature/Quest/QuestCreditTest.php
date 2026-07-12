<?php

namespace Tests\Feature\Quest;

use App\Models\Plan;
use App\Models\TokenLedger;
use App\Models\UsageCounter;
use App\Services\AiClient;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Building a quest game spends a credit, exactly like generating a quiz.
 *
 * AI_MOCK=true in the test env, so the LLM-authored path returns mock content
 * with no real tokens — we assert the *credit* accounting, which is what the
 * student sees, not the rupee cost.
 */
class QuestCreditTest extends TestCase
{
    use DatabaseTransactions, BuildsCurriculum;

    protected function setUp(): void
    {
        parent::setUp();

        // Never reach the real AI service from a test. With authoring returning
        // nothing, a math topic falls back to the deterministic author — a real,
        // correct game — so credit accounting is exercised hermetically.
        $this->app->instance(AiClient::class, new class extends AiClient {
            public function __construct() {}                       // skip config lookup
            public function authorGame(array $payload): array { return []; }
        });
    }

    private function freePlan(): Plan
    {
        // The metering weights this suite relies on (mirrors PlanSeeder).
        return Plan::create([
            'key' => 'free', 'name' => 'Free',
            'price_inr' => 0, 'billing_period' => 'month', 'tier' => 'free',
            'daily_credit_limit' => 30, 'monthly_credit_limit' => 300,
            'per_action_weights' => ['chat' => 1, 'game_gen' => 1], 'is_active' => true,
        ]);
    }

    private function dailyUsed(int $userId): float
    {
        return (float) (UsageCounter::where('user_id', $userId)
            ->where('metric', 'daily_credits')
            ->where('period_key', now()->toDateString())
            ->value('value') ?? 0);
    }

    public function test_building_a_game_charges_one_credit_and_writes_a_ledger_row(): void
    {
        $this->freePlan();
        $this->seedCurriculum(['Times Tables']); // matches "number_line" — deterministic, no LLM
        $user = $this->student();
        Sanctum::actingAs($user);

        $before = $this->dailyUsed($user->id);

        $this->postJson('/api/quest/games', ['topic_id' => $this->topics['Times Tables']->id])
            ->assertOk()
            ->assertJsonStructure(['game' => ['id', 'mechanic', 'items']]);

        $this->assertSame($before + 1, $this->dailyUsed($user->id), 'one credit is spent');

        $row = TokenLedger::where('user_id', $user->id)->where('action_type', 'game_gen')->latest('id')->first();
        $this->assertNotNull($row);
        $this->assertEquals(1, (float) $row->credits_charged);
        $this->assertSame('deterministic', $row->meta['source']);          // no LLM was used
        $this->assertEquals(0, (int) $row->total_tokens);                   // so no token cost
    }

    public function test_a_student_out_of_credits_is_blocked_before_the_game_is_built(): void
    {
        $plan = $this->freePlan();
        $plan->update(['daily_credit_limit' => 1]);
        $this->seedCurriculum(['Times Tables']);
        $user = $this->student();
        Sanctum::actingAs($user);

        // Spend the one and only daily credit.
        $this->postJson('/api/quest/games', ['topic_id' => $this->topics['Times Tables']->id])->assertOk();
        $gamesBefore = \App\Models\GameInstance::count();

        // The next build is refused with the upsell payload, and nothing is created.
        $this->postJson('/api/quest/games', ['topic_id' => $this->topics['Times Tables']->id])
            ->assertStatus(402)
            ->assertJson(['error' => 'quota_exceeded']);

        $this->assertSame($gamesBefore, \App\Models\GameInstance::count(), 'no game is built when blocked');
    }

    public function test_a_locked_topic_is_refused_and_not_charged(): void
    {
        $this->freePlan();
        $this->seedCurriculum(['A', 'B']); // B requires A; A isn't mastered yet
        $user = $this->student();
        Sanctum::actingAs($user);

        $before = $this->dailyUsed($user->id);

        $this->postJson('/api/quest/games', ['topic_id' => $this->topics['B']->id])
            ->assertStatus(423); // Locked

        $this->assertSame($before, $this->dailyUsed($user->id), 'a blocked build costs nothing');
        $this->assertNull(TokenLedger::where('user_id', $user->id)->where('action_type', 'game_gen')->first());
    }
}
