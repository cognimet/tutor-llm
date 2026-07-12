<?php

namespace App\Services\Quest;

use App\Models\AbilityEstimate;
use App\Models\User;

/**
 * Engine 3b — IRT ability (theta), layered on top of BKT.
 *
 * Port of LearnQuest's `engines/ability.py`. BKT tracks mastery *per skill*; IRT
 * tracks the learner's overall *ability* per subject and models each item with the
 * 2-parameter logistic:
 *
 *   P(correct | theta) = 1 / (1 + exp(-a * (theta - b)))
 *
 * theta is updated online after every response (one stochastic gradient step on
 * the log-likelihood) and is what lets us pick the difficulty that keeps a learner
 * in the ~72% success band — hard enough to learn from, easy enough to stay.
 */
class AbilityService
{
    /** Game difficulty (1..5) mapped onto an IRT difficulty b, on the logit scale. */
    public const DIFFICULTY_TO_B = [1 => -1.5, 2 => -0.7, 3 => 0.0, 4 => 0.8, 5 => 1.6];

    /** The "desirable difficulty" success band we aim the learner at. */
    private const TARGET_SUCCESS = 0.72;

    /** Base learning rate for the online theta update. */
    private const LR = 0.35;

    /** theta is clamped to this range; beyond it the logistic is saturated anyway. */
    private const THETA_MIN = -4.0;
    private const THETA_MAX = 4.0;

    public function sigmoid(float $x): float
    {
        if ($x < -60) return 0.0;
        if ($x > 60)  return 1.0;
        return 1.0 / (1.0 + exp(-$x));
    }

    public function theta(User $user, int $subjectId): float
    {
        $row = AbilityEstimate::where('user_id', $user->id)->where('subject_id', $subjectId)->first();
        return $row ? (float) $row->theta : 0.0;
    }

    /**
     * Online MLE step: theta += lr * a * (y - p). Returns the new theta.
     *
     * The learning rate decays with the number of observations so early answers
     * move theta quickly and later ones only refine it.
     */
    public function observe(User $user, int $subjectId, int $difficulty, bool $correct, float $a = 1.0): float
    {
        $row = AbilityEstimate::firstOrNew(
            ['user_id' => $user->id, 'subject_id' => $subjectId],
            ['theta' => 0.0, 'observations' => 0],
        );

        $theta = (float) ($row->theta ?? 0.0);
        $b     = self::DIFFICULTY_TO_B[$difficulty] ?? 0.0;
        $p     = $this->sigmoid($a * ($theta - $b));

        $lr    = self::LR / (1.0 + 0.03 * $row->observations);
        $theta = $theta + $lr * $a * (($correct ? 1.0 : 0.0) - $p);

        $row->theta        = max(self::THETA_MIN, min(self::THETA_MAX, $theta));
        $row->observations = $row->observations + 1;
        $row->save();

        return (float) $row->theta;
    }

    /**
     * The difficulty (1..5) whose success probability sits closest to the target
     * band for this learner's current theta.
     */
    public function recommendDifficulty(User $user, int $subjectId, float $a = 1.0): int
    {
        $theta   = $this->theta($user, $subjectId);
        $best    = 3;
        $bestGap = INF;

        foreach (self::DIFFICULTY_TO_B as $d => $b) {
            $gap = abs($this->sigmoid($a * ($theta - $b)) - self::TARGET_SUCCESS);
            if ($gap < $bestGap) {
                $bestGap = $gap;
                $best    = $d;
            }
        }
        return $best;
    }

    /** Predicted chance this learner answers a difficulty-$d item correctly. */
    public function successProbability(User $user, int $subjectId, int $difficulty, float $a = 1.0): float
    {
        $b = self::DIFFICULTY_TO_B[$difficulty] ?? 0.0;
        return $this->sigmoid($a * ($this->theta($user, $subjectId) - $b));
    }
}
