<?php

namespace App\Services\Quest;

use App\Models\User;

/**
 * Engine 4 — the adaptive path, delivered as a quest map.
 *
 * Port of LearnQuest's `engines/path_engine.py`.
 *
 *  - {@see next()} picks what to practise now: gap-ranked topics from the ready
 *    set (prerequisites mastered, not yet mastered), falling back to spaced review
 *    of a mastered topic whose confidence has slipped. Rewards track *learning*,
 *    never time-on-app (blueprint §5).
 *  - {@see questMap()} renders the curriculum as locked / available / in-progress /
 *    mastered nodes. The map *is* the learning path — the student experiences
 *    pathing as exploration; the teacher sees it as a coverage dashboard.
 */
class PathEngineService
{
    /** A mastered topic whose confidence has decayed below this is due for review. */
    private const REVIEW_CEILING = 0.95;

    public const STATUS_LOCKED      = 'locked';
    public const STATUS_AVAILABLE   = 'available';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_MASTERED    = 'mastered';

    public function __construct(
        protected SkillGraphService $graph,
        protected KnowledgeTracingService $bkt,
        protected AbilityService $ability,
    ) {}

    /**
     * Aim for the flow band from the mastery estimate alone. Used when the learner
     * has no per-subject IRT history yet; otherwise the caller prefers
     * {@see AbilityService::recommendDifficulty()}, which uses real response data.
     */
    public function difficultyFor(float $pMastered): int
    {
        if ($pMastered < 0.25) return 1;
        if ($pMastered < 0.50) return 2;
        if ($pMastered < 0.70) return 3;
        if ($pMastered < 0.85) return 4;
        return 5;
    }

    /**
     * The next thing this student should play in a subject.
     *
     * @return array{topic_id:int,topic_name:string,reason:string,recommended_difficulty:int,is_review:bool}|null
     *         null when nothing is ready — i.e. the subject has no topics, or every
     *         ready topic is already mastered and nothing needs review.
     */
    public function next(User $user, int $subjectId): ?array
    {
        $topicIds = $this->graph->skillIds($subjectId);
        if (! $topicIds) {
            return null;
        }

        $mastered = $this->bkt->masteredSet($user, $topicIds);
        $ready    = array_flip($this->graph->readySet($subjectId, $mastered));

        // 1) New learning: the highest-scoring gap that is ready to learn.
        foreach ($this->bkt->gaps($user, $subjectId) as $gap) {
            if (! isset($ready[$gap['topic_id']])) {
                continue;
            }
            return [
                'topic_id'   => $gap['topic_id'],
                'topic_name' => $gap['name'],
                'reason'     => trim(sprintf(
                    'Ready to learn — prerequisites mastered. %sUnlocks %d later topic%s.',
                    $gap['is_root'] ? 'This is a root gap. ' : '',
                    $gap['downstream_impact'],
                    $gap['downstream_impact'] === 1 ? '' : 's',
                )),
                'recommended_difficulty' => $this->pickDifficulty($user, $subjectId, $gap['p_mastered']),
                'is_review'              => false,
            ];
        }

        // 2) Spaced review: the mastered topic whose confidence has slipped most.
        $pm = $this->bkt->pMasteredMap($user, $mastered);
        $reviewable = array_filter($pm, fn ($p) => $p < self::REVIEW_CEILING);
        if ($reviewable) {
            asort($reviewable);
            $topicId = (int) array_key_first($reviewable);
            return [
                'topic_id'   => $topicId,
                'topic_name' => $this->graph->topic($subjectId, $topicId)['name'] ?? '',
                'reason'     => 'Spaced review to keep a mastered topic fresh.',
                'recommended_difficulty' => $this->pickDifficulty($user, $subjectId, $reviewable[$topicId]),
                'is_review'              => true,
            ];
        }

        return null;
    }

    /**
     * The curriculum as a game world: prerequisites are locked gates that open as
     * mastery grows.
     *
     * @return array<int,array{topic_id:int,name:string,status:string,p_mastered:float,prerequisites:int[]}>
     */
    public function questMap(User $user, int $subjectId): array
    {
        $topicIds = $this->graph->skillIds($subjectId);
        if (! $topicIds) {
            return [];
        }

        $pm       = $this->bkt->pMasteredMap($user, $topicIds);
        $obs      = $this->bkt->observationsMap($user, $topicIds);
        $mastered = $this->bkt->masteredSet($user, $topicIds);
        $relevant = array_flip($topicIds);

        $nodes = [];
        // Prerequisites before dependents, so the map reads top-to-bottom.
        foreach ($this->graph->topoOrder($subjectId) as $id) {
            if (! isset($relevant[$id])) {
                continue;
            }
            $topic = $this->graph->topic($subjectId, $id);

            if (in_array($id, $mastered, true)) {
                $status = self::STATUS_MASTERED;
            } elseif ($this->graph->isReady($subjectId, $id, $mastered)) {
                $status = $obs[$id] > 0 ? self::STATUS_IN_PROGRESS : self::STATUS_AVAILABLE;
            } else {
                $status = self::STATUS_LOCKED;
            }

            $nodes[] = [
                'topic_id'      => $id,
                'name'          => $topic['name'] ?? '',
                'mechanic'      => $topic['mechanic'] ?? null,
                'status'        => $status,
                'p_mastered'    => round($pm[$id], 3),
                'observations'  => $obs[$id],
                'prerequisites' => array_values(array_filter(
                    $this->graph->prerequisites($subjectId, $id),
                    fn ($p) => isset($relevant[$p]),
                )),
            ];
        }
        return $nodes;
    }

    /**
     * Prefer the IRT estimate once the learner has answered anything in this
     * subject; fall back to the BKT mastery heuristic on a cold start.
     */
    protected function pickDifficulty(User $user, int $subjectId, float $pMastered): int
    {
        $estimate = $this->ability->theta($user, $subjectId);
        return $estimate !== 0.0
            ? $this->ability->recommendDifficulty($user, $subjectId)
            : $this->difficultyFor($pMastered);
    }
}
