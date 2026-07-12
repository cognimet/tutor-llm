<?php

namespace Tests\Feature\Quest;

use App\Models\EvidenceEvent;
use App\Models\User;
use App\Services\Quest\AbilityService;
use App\Services\Quest\KnowledgeTracingService;
use App\Services\Quest\PathEngineService;
use App\Services\Quest\SkillGraphService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * The four engines, exercised together over a three-topic chain A → B → C.
 * These mirror LearnQuest's `tests/test_core_loop.py`, retargeted at the
 * curriculum-backed graph.
 */
class QuestEngineTest extends TestCase
{
    // DatabaseTransactions, never RefreshDatabase: each test rolls back rather
    // than dropping and recreating the schema. See Tests\TestCase.
    use DatabaseTransactions, BuildsCurriculum;

    private SkillGraphService $graph;
    private KnowledgeTracingService $bkt;
    private AbilityService $ability;
    private PathEngineService $path;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedCurriculum();
        $this->user = $this->student();

        $this->graph   = app(SkillGraphService::class);
        $this->ability = app(AbilityService::class);
        $this->bkt     = new KnowledgeTracingService($this->graph);
        $this->path    = new PathEngineService($this->graph, $this->bkt, $this->ability);
    }

    /** Record one answer on a topic, updating BKT (and IRT when a subject is known). */
    private function answer(string $topicName, bool $correct, int $difficulty = 3): float
    {
        $event = EvidenceEvent::create([
            'user_id'    => $this->user->id,
            'topic_id'   => $this->topics[$topicName]->id,
            'topic_name' => $topicName,
            'subject_id' => $this->subject->id,
            'correct'    => $correct,
            'difficulty' => $difficulty,
        ]);
        $this->ability->observe($this->user, $this->subject->id, $difficulty, $correct);
        return $this->bkt->observe($this->user, $event);
    }

    private function master(string $topicName): void
    {
        // Three correct answers take BKT from the 0.10 prior past the 0.85 threshold.
        for ($i = 0; $i < 3; $i++) {
            $this->answer($topicName, true);
        }
    }

    /* ----------------------------- skill graph ---------------------------- */

    public function test_the_graph_exposes_prerequisites_and_transitive_dependents(): void
    {
        $s = $this->subject->id;

        $this->assertSame([$this->topics['A']->id], $this->graph->prerequisites($s, $this->topics['B']->id));
        $this->assertSame([], $this->graph->prerequisites($s, $this->topics['A']->id));

        // A blocks both B and C.
        $downstream = $this->graph->allDownstream($s, $this->topics['A']->id);
        sort($downstream);
        $this->assertSame([$this->topics['B']->id, $this->topics['C']->id], $downstream);
    }

    public function test_topological_order_puts_prerequisites_first(): void
    {
        $order = $this->graph->topoOrder($this->subject->id);
        $this->assertSame(
            [$this->topics['A']->id, $this->topics['B']->id, $this->topics['C']->id],
            $order,
        );
    }

    public function test_only_the_first_topic_is_ready_before_any_mastery(): void
    {
        $this->assertSame([$this->topics['A']->id], $this->graph->readySet($this->subject->id, []));
    }

    /* -------------------------------- BKT --------------------------------- */

    public function test_a_correct_answer_raises_mastery_and_a_wrong_one_lowers_it(): void
    {
        $after = $this->answer('A', true);
        $this->assertGreaterThan(KnowledgeTracingService::P_L0, $after);

        $before = $after;
        $this->assertLessThan($before, $this->answer('A', false));
    }

    public function test_three_correct_answers_master_a_topic(): void
    {
        $this->master('A');
        $this->assertGreaterThanOrEqual(
            KnowledgeTracingService::MASTERY_THRESHOLD,
            $this->bkt->pMastered($this->user, $this->topics['A']->id),
        );
        $this->assertSame(
            [$this->topics['A']->id],
            $this->bkt->masteredSet($this->user, $this->graph->skillIds($this->subject->id)),
        );
    }

    public function test_an_untouched_topic_sits_at_the_prior(): void
    {
        $this->assertSame(KnowledgeTracingService::P_L0, $this->bkt->pMastered($this->user, $this->topics['C']->id));
    }

    /* ------------------------------- gaps --------------------------------- */

    public function test_the_root_gap_outranks_its_downstream_symptoms(): void
    {
        $gaps = $this->bkt->gaps($this->user, $this->subject->id);

        $this->assertSame($this->topics['A']->id, $gaps[0]['topic_id'], 'A is the root gap');
        $this->assertTrue($gaps[0]['is_root']);
        $this->assertSame(2, $gaps[0]['downstream_impact']);

        // B is blocked by A, so it is a symptom, not a root.
        $b = collect($gaps)->firstWhere('topic_id', $this->topics['B']->id);
        $this->assertFalse($b['is_root']);
        $this->assertGreaterThan($b['score'], $gaps[0]['score']);
    }

    public function test_a_mastered_topic_stops_being_a_gap(): void
    {
        $this->master('A');
        $ids = array_column($this->bkt->gaps($this->user, $this->subject->id), 'topic_id');
        $this->assertNotContains($this->topics['A']->id, $ids);
    }

    /* ---------------------------- path engine ----------------------------- */

    public function test_the_quest_map_locks_topics_behind_their_prerequisites(): void
    {
        $status = collect($this->path->questMap($this->user, $this->subject->id))
            ->pluck('status', 'topic_id');

        $this->assertSame(PathEngineService::STATUS_AVAILABLE, $status[$this->topics['A']->id]);
        $this->assertSame(PathEngineService::STATUS_LOCKED, $status[$this->topics['B']->id]);
        $this->assertSame(PathEngineService::STATUS_LOCKED, $status[$this->topics['C']->id]);
    }

    public function test_mastering_a_topic_unlocks_the_next_gate(): void
    {
        $this->master('A');

        $status = collect($this->path->questMap($this->user, $this->subject->id))
            ->pluck('status', 'topic_id');

        $this->assertSame(PathEngineService::STATUS_MASTERED, $status[$this->topics['A']->id]);
        $this->assertSame(PathEngineService::STATUS_AVAILABLE, $status[$this->topics['B']->id]);
        $this->assertSame(PathEngineService::STATUS_LOCKED, $status[$this->topics['C']->id]);
    }

    public function test_a_touched_but_unmastered_topic_reads_as_in_progress(): void
    {
        $this->answer('A', false);
        $status = collect($this->path->questMap($this->user, $this->subject->id))->pluck('status', 'topic_id');
        $this->assertSame(PathEngineService::STATUS_IN_PROGRESS, $status[$this->topics['A']->id]);
    }

    public function test_next_recommends_the_ready_root_gap(): void
    {
        $next = $this->path->next($this->user, $this->subject->id);

        $this->assertSame($this->topics['A']->id, $next['topic_id']);
        $this->assertFalse($next['is_review']);
        $this->assertStringContainsString('root gap', $next['reason']);
    }

    public function test_next_advances_once_the_first_topic_is_mastered(): void
    {
        $this->master('A');
        $this->assertSame($this->topics['B']->id, $this->path->next($this->user, $this->subject->id)['topic_id']);
    }

    public function test_next_falls_back_to_spaced_review_when_confidence_has_slipped(): void
    {
        // Mastered (>= 0.85) but below the 0.95 review ceiling — the state a
        // learner decays into. Set it directly; three clean answers overshoot it.
        foreach (['A', 'B', 'C'] as $name) {
            \App\Models\SkillMastery::create([
                'user_id' => $this->user->id, 'topic_id' => $this->topics[$name]->id,
                'p_mastered' => $name === 'B' ? 0.87 : 0.93, 'observations' => 5,
            ]);
        }

        $next = $this->path->next($this->user, $this->subject->id);
        $this->assertNotNull($next);
        $this->assertTrue($next['is_review'], 'everything mastered -> review');
        $this->assertSame($this->topics['B']->id, $next['topic_id'], 'the weakest mastered topic is reviewed first');
    }

    public function test_next_is_null_when_everything_is_confidently_mastered(): void
    {
        foreach (['A', 'B', 'C'] as $name) {
            $this->master($name); // three correct answers -> p ≈ 0.97, above the review ceiling
        }
        $this->assertNull($this->path->next($this->user, $this->subject->id));
    }

    public function test_next_is_null_for_a_subject_with_no_topics(): void
    {
        $empty = \App\Models\Subject::create([
            'level_id' => $this->subject->level_id, 'name' => 'Art', 'slug' => 'art',
        ]);
        $this->assertNull($this->path->next($this->user, $empty->id));
    }

    /* ------------------------------ IRT theta ----------------------------- */

    public function test_theta_rises_on_a_correct_answer_and_falls_on_a_wrong_one(): void
    {
        $this->assertSame(0.0, $this->ability->theta($this->user, $this->subject->id));

        $up = $this->ability->observe($this->user, $this->subject->id, 3, true);
        $this->assertGreaterThan(0.0, $up);

        $down = $this->ability->observe($this->user, $this->subject->id, 3, false);
        $this->assertLessThan($up, $down);
    }

    public function test_difficulty_tracks_ability_into_the_success_band(): void
    {
        // A learner at theta = 0 should get an easy-ish level, not the hardest.
        $this->assertSame(2, $this->ability->recommendDifficulty($this->user, $this->subject->id));

        // A strong learner should be stretched.
        for ($i = 0; $i < 20; $i++) {
            $this->ability->observe($this->user, $this->subject->id, 5, true);
        }
        $this->assertGreaterThan(2, $this->ability->recommendDifficulty($this->user, $this->subject->id));
    }

    public function test_theta_is_clamped(): void
    {
        for ($i = 0; $i < 200; $i++) {
            $this->ability->observe($this->user, $this->subject->id, 1, true);
        }
        $this->assertLessThanOrEqual(4.0, $this->ability->theta($this->user, $this->subject->id));
    }

    /* ------------------------- evidence is immutable ---------------------- */

    public function test_mastery_can_be_recomputed_from_the_evidence_stream(): void
    {
        $this->master('A');
        $original = $this->bkt->pMastered($this->user, $this->topics['A']->id);

        // Throw away the derived state; replay the durable events.
        \App\Models\SkillMastery::query()->delete();
        foreach (EvidenceEvent::orderBy('id')->get() as $event) {
            $this->bkt->observe($this->user, $event);
        }

        $this->assertEqualsWithDelta($original, $this->bkt->pMastered($this->user, $this->topics['A']->id), 0.0001);
    }
}
