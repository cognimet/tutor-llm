<?php

namespace App\Services\Quest;

use App\Models\EvidenceEvent;
use App\Models\SkillMastery;
use App\Models\User;

/**
 * Engine 3 — Bayesian Knowledge Tracing + root-cause gap detection.
 *
 * Port of LearnQuest's `engines/knowledge_model.py`. BKT tracks P(mastered) per
 * (student, topic) with four parameters:
 *
 *   P_L0  prior probability of mastery before any evidence
 *   P_T   probability of learning during an opportunity
 *   P_S   slip:  P(wrong   | mastered)
 *   P_G   guess: P(correct | not mastered)
 *
 * After each observation we apply Bayes' rule given correct/incorrect, then the
 * learning transition. BKT is chosen over a deep model deliberately: it is
 * interpretable, proven in ed-tech, and works on the sparse play data a single
 * learner produces (blueprint §9).
 *
 * The app already has {@see \App\Models\ConceptMastery} — a flat EWMA per concept.
 * BKT is not a replacement: EWMA answers "how well did recent answers go", BKT
 * answers "what is the probability this skill is learned", which is what the
 * prerequisite graph needs in order to unlock the next node.
 */
class KnowledgeTracingService
{
    public const P_L0 = 0.10;
    public const P_T  = 0.20;
    public const P_S  = 0.10;
    public const P_G  = 0.20;

    /** A topic counts as mastered at or above this probability. */
    public const MASTERY_THRESHOLD = 0.85;

    public function __construct(protected SkillGraphService $graph) {}

    /**
     * Apply one evidence event and persist the new state.
     *
     * Returns the posterior P(mastered). Callers hand us an already-persisted
     * EvidenceEvent so the immutable stream is written exactly once.
     */
    public function observe(User $user, EvidenceEvent $event): float
    {
        if (! $event->topic_id) {
            return 0.0; // ungraphed topic (note-only quest) — nothing to trace
        }

        $state = SkillMastery::firstOrNew(
            ['user_id' => $user->id, 'topic_id' => $event->topic_id],
            ['p_mastered' => self::P_L0, 'observations' => 0],
        );

        $prior = $state->exists ? (float) $state->p_mastered : self::P_L0;

        // Bayes: P(mastered | observation).
        if ($event->correct) {
            $num = $prior * (1 - self::P_S);
            $den = $prior * (1 - self::P_S) + (1 - $prior) * self::P_G;
        } else {
            $num = $prior * self::P_S;
            $den = $prior * self::P_S + (1 - $prior) * (1 - self::P_G);
        }
        $posterior = $den > 0 ? $num / $den : $prior;

        // Learning transition: they may have learned during the opportunity.
        $p = $posterior + (1 - $posterior) * self::P_T;

        $state->p_mastered   = max(0.0, min(1.0, $p));
        $state->observations = $state->observations + 1;
        $state->save();

        return (float) $state->p_mastered;
    }

    /** P(mastered) for one topic — the BKT prior when there is no evidence yet. */
    public function pMastered(User $user, int $topicId): float
    {
        $row = SkillMastery::where('user_id', $user->id)->where('topic_id', $topicId)->first();
        return $row ? (float) $row->p_mastered : self::P_L0;
    }

    /** P(mastered) for many topics at once: [topic_id => float]. */
    public function pMasteredMap(User $user, array $topicIds): array
    {
        if (! $topicIds) {
            return [];
        }
        $rows = SkillMastery::where('user_id', $user->id)
            ->whereIn('topic_id', $topicIds)
            ->pluck('p_mastered', 'topic_id');

        $out = [];
        foreach ($topicIds as $id) {
            $out[$id] = isset($rows[$id]) ? (float) $rows[$id] : self::P_L0;
        }
        return $out;
    }

    /** Observation counts for many topics: [topic_id => int]. */
    public function observationsMap(User $user, array $topicIds): array
    {
        if (! $topicIds) {
            return [];
        }
        $rows = SkillMastery::where('user_id', $user->id)
            ->whereIn('topic_id', $topicIds)
            ->pluck('observations', 'topic_id');

        $out = [];
        foreach ($topicIds as $id) {
            $out[$id] = (int) ($rows[$id] ?? 0);
        }
        return $out;
    }

    /** Topic ids at or above the mastery threshold. */
    public function masteredSet(User $user, array $topicIds): array
    {
        $map = $this->pMasteredMap($user, $topicIds);
        return array_values(array_keys(array_filter($map, fn ($p) => $p >= self::MASTERY_THRESHOLD)));
    }

    /**
     * Rank unmastered topics as gaps.
     *
     *   score = (1 - p_mastered) x (1 + downstream_impact) x root_bonus
     *
     * A *root* gap is one whose own prerequisites are already mastered — the
     * cause rather than the symptom. It gets a 1.5x boost so the path engine
     * sends the student to fix place value, not to grind regrouping.
     *
     * @return array<int,array{topic_id:int,name:string,p_mastered:float,downstream_impact:int,is_root:bool,score:float}>
     */
    public function gaps(User $user, int $subjectId): array
    {
        $topicIds = $this->graph->skillIds($subjectId);
        if (! $topicIds) {
            return [];
        }

        $pm       = $this->pMasteredMap($user, $topicIds);
        $relevant = array_flip($topicIds);
        $gaps     = [];

        foreach ($topicIds as $id) {
            if ($pm[$id] >= self::MASTERY_THRESHOLD) {
                continue;
            }

            $downstream = count(array_filter(
                $this->graph->allDownstream($subjectId, $id),
                fn ($d) => isset($relevant[$d]),
            ));

            $prereqGap = false;
            foreach ($this->graph->prerequisites($subjectId, $id) as $pre) {
                if (($pm[$pre] ?? self::P_L0) < self::MASTERY_THRESHOLD) {
                    $prereqGap = true;
                    break;
                }
            }
            $isRoot = ! $prereqGap;

            $gaps[] = [
                'topic_id'          => $id,
                'name'              => $this->graph->topic($subjectId, $id)['name'] ?? '',
                'p_mastered'        => round($pm[$id], 4),
                'downstream_impact' => $downstream,
                'is_root'           => $isRoot,
                'score'             => round((1 - $pm[$id]) * (1 + $downstream) * ($isRoot ? 1.5 : 1.0), 4),
            ];
        }

        usort($gaps, fn ($a, $b) => $b['score'] <=> $a['score']);
        return $gaps;
    }
}
