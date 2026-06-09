<?php

namespace App\Services;

use App\Models\ProgressSnapshot;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * Maintains a rolling daily progress snapshot per student and produces the
 * summary consumed by the student/parent dashboards.
 */
class ProgressService
{
    public function recordActivity(User $user, int $topicsStudied = 0, int $questionsAnswered = 0, int $gapsClosed = 0, int $masteryDelta = 0): ProgressSnapshot
    {
        $snap = ProgressSnapshot::firstOrCreate(
            ['user_id' => $user->id, 'day' => Carbon::today()->toDateString()],
            ['mastery' => 0, 'topics_studied' => 0, 'questions_answered' => 0, 'gaps_closed' => 0]
        );

        $snap->increment('topics_studied', $topicsStudied);
        $snap->increment('questions_answered', $questionsAnswered);
        $snap->increment('gaps_closed', $gapsClosed);

        if ($masteryDelta !== 0) {
            $snap->mastery = max(0, min(100, $snap->mastery + $masteryDelta));
            $snap->save();
        }

        return $snap;
    }

    public function summary(User $user): array
    {
        $snaps = $user->progressSnapshots()->orderBy('day')->get();
        $assessments = $user->assessments()->where('status', 'completed')->get();

        $totalQ = (int) $snaps->sum('questions_answered');
        $totalCorrect = (int) $assessments->sum('score');
        $totalAsked = (int) $assessments->sum('total');
        $accuracy = $totalAsked > 0 ? round($totalCorrect / $totalAsked * 100) : 0;

        $openGaps = $user->knowledgeGaps()->where('resolved', false)->count();
        $closedGaps = $user->knowledgeGaps()->where('resolved', true)->count();

        // Rolling mastery = latest snapshot mastery, else accuracy.
        $mastery = (int) ($snaps->last()->mastery ?? $accuracy);

        return [
            'mastery'            => $mastery,
            'accuracy'           => $accuracy,
            'topics_studied'     => (int) $snaps->sum('topics_studied'),
            'questions_answered' => $totalQ,
            'assessments_taken'  => $assessments->count(),
            'open_gaps'          => $openGaps,
            'closed_gaps'        => $closedGaps,
            'streak_days'        => $this->streak($snaps->pluck('day')->all()),
            'trend'              => $snaps->map(fn ($s) => [
                'day'     => (string) $s->day->toDateString(),
                'mastery' => (int) $s->mastery,
            ])->values(),
        ];
    }

    protected function streak(array $days): int
    {
        if (empty($days)) return 0;
        $set = collect($days)->map(fn ($d) => Carbon::parse($d)->toDateString())->unique()->flip();
        $streak = 0;
        $cursor = Carbon::today();
        while ($set->has($cursor->toDateString())) {
            $streak++;
            $cursor->subDay();
        }
        return $streak;
    }
}
