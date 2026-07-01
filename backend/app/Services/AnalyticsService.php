<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\AssessmentAnswer;
use App\Models\ConceptMastery;
use App\Models\EngagementEvent;
use App\Models\KnowledgeGap;
use App\Models\LearningEvent;
use App\Models\Misconception;
use App\Models\Mistake;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The analytics + insights engine. Turns raw signals (assessment answers,
 * concept mastery, gaps, misconceptions, engagement pings) into structured,
 * decision-ready insight for three audiences:
 *
 *   - userAnalytics()   per-student: gaps, strengths, accuracy trend, attention,
 *                       integrity, time, attempts, actionable recommendations.
 *   - childAnalytics()  same core, framed for a parent + suggested interventions.
 *   - adminAnalytics()  cohort: segmentation, gap trends, integrity reports,
 *                       completion/engagement/retention, exportable rows.
 *
 * All scores are 0..100 ints so the UI can render scorecards/gauges directly.
 */
class AnalyticsService
{
    /* ============================================================ INDIVIDUAL */

    public function userAnalytics(User $user, int $days = 30): array
    {
        $since = now()->subDays($days);
        $uid = $user->id;

        $answers = AssessmentAnswer::where('user_id', $uid)
            ->where('created_at', '>=', $since)
            ->with('question:id,concept,assessment_id')
            ->get();

        $accuracy = $this->accuracy($answers);
        $perf = $this->performanceBands($uid);
        $engagement = $this->engagementScore($uid, $since);
        $integrity = $this->integrityReport($uid, $since);
        $study = $this->studyTime($uid, $since);

        return [
            'period_days'   => $days,
            'headline'      => [
                'accuracy'         => $accuracy['pct'],
                'questions'        => $accuracy['total'],
                'engagement_score' => $engagement['score'],
                'integrity_score'  => $integrity['score'],
                'mastery_avg'      => $perf['mastery_avg'],
                'open_gaps'        => KnowledgeGap::where('user_id', $uid)->where('resolved', false)->count(),
                'total_min'        => $study['total_min'],
                'focus_min'        => $study['focus_min'],
                'active_days'      => $study['active_days'],
            ],
            'strengths'        => $perf['strengths'],
            'weaknesses'       => $perf['weaknesses'],
            'gap_analysis'     => $this->gapAnalysis($uid),
            'accuracy_trend'   => $this->accuracyTrend($uid, $days),
            'attempt_trend'    => $this->attemptTrend($uid),
            'time_insights'    => $this->timeInsights($answers),
            'study_time'       => $study,
            'subjects'         => $this->subjectBreakdown($uid, $since, $study),
            'weekly_trend'     => $this->weeklyTrend($uid),
            'patterns'         => $this->engagementPatterns($user, $since, $study),
            'benchmark'        => $this->benchmark($uid, $days),
            'difficulty'       => $this->difficultyCorrelation($uid, $since),
            'attention'        => $engagement,
            'integrity'        => $integrity,
            'recommendations'  => $this->recommendations($perf, $engagement, $integrity, $accuracy),
        ];
    }

    public function childAnalytics(User $child, int $days = 30): array
    {
        $core = $this->userAnalytics($child, $days);
        $core['child'] = [
            'id' => $child->id, 'name' => $child->name, 'grade' => $child->grade,
        ];
        $core['interventions'] = $this->interventions($core);
        return $core;
    }

    /* ================================================================ COHORT */

    public function adminAnalytics(int $days = 30): array
    {
        $since = now()->subDays($days);

        $students = User::where('role', 'student')->count();
        $activeStudents = EngagementEvent::where('created_at', '>=', $since)
            ->distinct('user_id')->count('user_id');

        $started = Assessment::where('created_at', '>=', $since)->count();
        $completed = Assessment::where('status', 'completed')
            ->where('created_at', '>=', $since)->count();

        return [
            'period_days' => $days,
            'totals' => [
                'students'         => $students,
                'active_students'  => $activeStudents,
                'assessments'      => $started,
                'completion_rate'  => $started > 0 ? (int) round($completed / $started * 100) : null,
                'avg_engagement'   => $this->cohortAvgEngagement($since),
                'avg_integrity'    => $this->cohortAvgIntegrity($since),
            ],
            'segmentation'     => $this->segmentation($since),
            'gap_trends'       => $this->cohortGapTrends($days),
            'top_gap_concepts' => $this->cohortTopGaps(),
            'integrity_report' => $this->cohortIntegrity($since),
            'completion_trend' => $this->completionTrend($days),
            'engagement_trend' => $this->cohortEngagementTrend($days),
            'export_rows'      => $this->exportRows($since),
        ];
    }

    /* ============================================================== HELPERS */

    private function accuracy(Collection $answers): array
    {
        $total = $answers->count();
        $correct = $answers->where('is_correct', true)->count();
        return [
            'total'   => $total,
            'correct' => $correct,
            'pct'     => $total > 0 ? (int) round($correct / $total * 100) : null,
        ];
    }

    /** Strengths/weaknesses from EWMA concept mastery (master-prompt C1). */
    private function performanceBands(int $uid): array
    {
        $rows = ConceptMastery::where('user_id', $uid)->get();
        $mastery = $rows->map(fn ($r) => [
            'concept'    => $r->concept,
            'topic'      => $r->topic_name,
            'score'      => (int) round($r->score * 100),
            'confidence' => (int) $r->confidence,
        ]);
        return [
            'mastery_avg' => $rows->count() ? (int) round($rows->avg('score') * 100) : null,
            'strengths'   => $mastery->where('score', '>=', 75)->sortByDesc('score')->take(6)->values(),
            'weaknesses'  => $mastery->where('score', '<', 55)->sortBy('score')->take(6)->values(),
        ];
    }

    /** Knowledge + skill gaps with severity and recommendation. */
    private function gapAnalysis(int $uid): array
    {
        $gaps = KnowledgeGap::where('user_id', $uid)->where('resolved', false)
            ->orderByRaw("CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END")
            ->limit(20)->get(['concept', 'topic_name', 'severity', 'recommendation']);

        $bySeverity = $gaps->groupBy('severity')->map->count();
        $skillGaps = Misconception::where('user_id', $uid)->where('status', 'open')
            ->limit(10)->get(['description', 'topic_name']);

        return [
            'knowledge_gaps' => $gaps,
            'skill_gaps'     => $skillGaps,
            'by_severity'    => [
                'high'   => (int) ($bySeverity['high'] ?? 0),
                'medium' => (int) ($bySeverity['medium'] ?? 0),
                'low'    => (int) ($bySeverity['low'] ?? 0),
            ],
        ];
    }

    private function accuracyTrend(int $uid, int $days): array
    {
        $rows = AssessmentAnswer::where('user_id', $uid)
            ->where('created_at', '>=', now()->subDays($days))
            ->selectRaw('DATE(created_at) as day,
                COUNT(*) as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct')
            ->groupBy('day')->pluck('correct', 'day');
        $tot = AssessmentAnswer::where('user_id', $uid)
            ->where('created_at', '>=', now()->subDays($days))
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total')
            ->groupBy('day')->pluck('total', 'day');

        $out = [];
        for ($d = $days - 1; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $t = (int) ($tot[$day] ?? 0);
            $out[] = [
                'day'      => $day,
                'accuracy' => $t > 0 ? (int) round(((int) ($rows[$day] ?? 0)) / $t * 100) : null,
                'attempts' => $t,
            ];
        }
        return $out;
    }

    /** Improvement across repeated assessment attempts (learning trend). */
    private function attemptTrend(int $uid): array
    {
        // Latest 20 completed, then chronological for the chart (was showing the
        // OLDEST 20 — hid recent progress for active students).
        return Assessment::where('user_id', $uid)->where('status', 'completed')
            ->orderByDesc('completed_at')->limit(20)
            ->get(['id', 'topic_name', 'score', 'total', 'completed_at'])
            ->sortBy('completed_at')
            ->map(fn ($a) => [
                'topic'    => $a->topic_name,
                'score'    => $a->total > 0 ? (int) round($a->score / $a->total * 100) : 0,
                'date'     => optional($a->completed_at)->toDateString(),
            ])->values()->all();
    }

    private function timeInsights(Collection $answers): array
    {
        $timed = $answers->whereNotNull('time_spent_ms')->filter(fn ($a) => $a->time_spent_ms > 0);
        if ($timed->isEmpty()) {
            return ['avg_per_question_s' => null, 'rushed' => 0, 'overthought' => 0, 'avg_changes' => null];
        }
        $avg = $timed->avg('time_spent_ms');
        return [
            'avg_per_question_s' => (int) round($avg / 1000),
            'rushed'             => $timed->where('time_spent_ms', '<', 4000)->count(),   // < 4s
            'overthought'        => $timed->where('time_spent_ms', '>', 90000)->count(),  // > 90s
            'avg_changes'        => round($answers->avg('answer_changes') ?? 0, 1),
        ];
    }

    /**
     * Time-on-task: total study time, focused time, active days, and a
     * per-subject breakdown — from topic_time learning events, rolled up to the
     * subject via topic → chapter → subject.
     */
    private function studyTime(int $uid, Carbon $since): array
    {
        $base = LearningEvent::where('user_id', $uid)->where('created_at', '>=', $since)
            ->where('type', 'topic_time');

        $totalMs = (int) (clone $base)->sum('duration_ms');
        $awayMs = (int) EngagementEvent::where('user_id', $uid)->where('created_at', '>=', $since)
            ->where('event_type', EngagementEvent::TAB_FOCUS)->sum('duration_ms');
        $focusMs = max(0, $totalMs - $awayMs);
        $activeDays = (int) (clone $base)->distinct()
            ->count(DB::raw('DATE(created_at)'));

        $bySubject = DB::table('learning_events as le')
            ->where('le.user_id', $uid)->where('le.created_at', '>=', $since)
            ->where('le.type', 'topic_time')
            ->leftJoin('topics as t', 't.id', '=', 'le.topic_id')
            ->leftJoin('chapters as c', 'c.id', '=', 't.chapter_id')
            ->leftJoin('subjects as s', 's.id', '=', 'c.subject_id')
            ->selectRaw("COALESCE(s.name, le.topic_name, 'General') as label, SUM(le.duration_ms) as ms")
            ->groupByRaw("COALESCE(s.name, le.topic_name, 'General')")
            ->orderByDesc('ms')->limit(8)->get()
            ->map(fn ($r) => ['label' => $r->label, 'minutes' => (int) round($r->ms / 60000)])
            ->all();

        return [
            'total_min'   => (int) round($totalMs / 60000),
            'focus_min'   => (int) round($focusMs / 60000),
            'focus_pct'   => $totalMs > 0 ? (int) round($focusMs / $totalMs * 100) : null,
            'active_days' => $activeDays,
            'avg_min_day' => $activeDays > 0 ? (int) round($totalMs / 60000 / $activeDays) : 0,
            'by_subject'  => $bySubject,
        ];
    }

    /**
     * Per-subject quiz performance, rolled up assessment_answers → question →
     * assessment → topic → chapter → subject. Weighted by question count, so the
     * rows aggregate exactly to the overall accuracy (same source + window).
     */
    private function subjectBreakdown(int $uid, Carbon $since, array $study): array
    {
        $rows = DB::table('assessment_answers as aa')
            ->where('aa.user_id', $uid)->where('aa.created_at', '>=', $since)
            ->join('assessment_questions as q', 'q.id', '=', 'aa.assessment_question_id')
            ->join('assessments as a', 'a.id', '=', 'q.assessment_id')
            ->leftJoin('topics as t', 't.id', '=', 'a.topic_id')
            ->leftJoin('chapters as c', 'c.id', '=', 't.chapter_id')
            ->leftJoin('subjects as s', 's.id', '=', 'c.subject_id')
            ->selectRaw("COALESCE(s.name, a.topic_name, 'General') as subject,
                COUNT(*) as total, SUM(CASE WHEN aa.is_correct THEN 1 ELSE 0 END) as correct")
            ->groupByRaw("COALESCE(s.name, a.topic_name, 'General')")
            ->orderByDesc('total')->get();

        // Study minutes per subject (label-matched from the topic_time rollup).
        $mins = collect($study['by_subject'])->keyBy('label')->map->minutes;

        return $rows->map(fn ($r) => [
            'subject'   => $r->subject,
            'questions' => (int) $r->total,
            'accuracy'  => $r->total > 0 ? (int) round($r->correct / $r->total * 100) : 0,
            'minutes'   => (int) ($mins[$r->subject] ?? 0),
        ])->values()->all();
    }

    /** Accuracy per calendar week — the "improving or declining?" signal. */
    private function weeklyTrend(int $uid): array
    {
        return DB::table('assessment_answers')
            ->where('user_id', $uid)->where('created_at', '>=', now()->subWeeks(8))
            ->selectRaw("TO_CHAR(DATE_TRUNC('week', created_at), 'MM/DD') as week,
                COUNT(*) as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct")
            ->groupByRaw("DATE_TRUNC('week', created_at)")
            ->orderByRaw("DATE_TRUNC('week', created_at)")->get()
            ->map(fn ($r) => [
                'week'     => $r->week,
                'accuracy' => $r->total > 0 ? (int) round($r->correct / $r->total * 100) : 0,
                'attempts' => (int) $r->total,
            ])->all();
    }

    /**
     * Engagement patterns: streak, study consistency, session count, and the
     * peak hours-of-day the student actually studies.
     */
    private function engagementPatterns(User $user, Carbon $since, array $study): array
    {
        $periodDays = max(1, (int) $since->diffInDays(now()));
        $sessions = DB::table('chat_sessions')->where('user_id', $user->id)
            ->where('created_at', '>=', $since)->count();

        $peak = DB::table('learning_events')->where('user_id', $user->id)
            ->where('created_at', '>=', $since)
            ->selectRaw('EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as c')
            ->groupByRaw('EXTRACT(HOUR FROM created_at)')
            ->orderByDesc('c')->limit(3)->get()
            ->map(fn ($r) => ['hour' => (int) $r->hour, 'count' => (int) $r->c])->all();

        return [
            'streak'          => (int) ($user->current_streak ?? 0),
            'active_days'     => $study['active_days'],
            'consistency_pct' => (int) round(min(100, $study['active_days'] / $periodDays * 100)),
            'sessions'        => $sessions,
            'peak_hours'      => $peak,
        ];
    }

    /** This period vs the previous same-length period — personal benchmark. */
    private function benchmark(int $uid, int $days): array
    {
        $now = now();
        $curFrom = $now->copy()->subDays($days);
        $prevFrom = $now->copy()->subDays($days * 2);

        $acc = function ($from, $to) use ($uid) {
            $r = AssessmentAnswer::where('user_id', $uid)
                ->whereBetween('created_at', [$from, $to])
                ->selectRaw('COUNT(*) as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct')->first();
            return $r && $r->total > 0 ? (int) round($r->correct / $r->total * 100) : null;
        };
        $mins = function ($from, $to) use ($uid) {
            return (int) round(((int) LearningEvent::where('user_id', $uid)->where('type', 'topic_time')
                ->whereBetween('created_at', [$from, $to])->sum('duration_ms')) / 60000);
        };

        $curAcc = $acc($curFrom, $now);
        $prevAcc = $acc($prevFrom, $curFrom);
        $curMin = $mins($curFrom, $now);
        $prevMin = $mins($prevFrom, $curFrom);

        return [
            'accuracy'      => ['current' => $curAcc, 'previous' => $prevAcc,
                'delta' => ($curAcc !== null && $prevAcc !== null) ? $curAcc - $prevAcc : null],
            'study_minutes' => ['current' => $curMin, 'previous' => $prevMin,
                'delta' => $curMin - $prevMin],
        ];
    }

    /** Do harder questions correlate with lower accuracy? (difficulty = cohort fail rate per concept) */
    private function difficultyCorrelation(int $uid, Carbon $since): array
    {
        $rows = AssessmentAnswer::where('assessment_answers.user_id', $uid)
            ->where('assessment_answers.created_at', '>=', $since)
            ->join('assessment_questions', 'assessment_questions.id', '=', 'assessment_answers.assessment_question_id')
            ->selectRaw('assessment_questions.concept as concept,
                COUNT(*) as total, SUM(CASE WHEN assessment_answers.is_correct THEN 1 ELSE 0 END) as correct,
                AVG(assessment_answers.time_spent_ms) as avg_ms')
            ->groupBy('concept')->orderByRaw('SUM(CASE WHEN assessment_answers.is_correct THEN 1 ELSE 0 END)*1.0/COUNT(*) ASC')
            ->limit(10)->get();

        return $rows->map(fn ($r) => [
            'concept'  => $r->concept ?: 'General',
            'accuracy' => $r->total > 0 ? (int) round($r->correct / $r->total * 100) : 0,
            'avg_s'    => $r->avg_ms ? (int) round($r->avg_ms / 1000) : null,
            'attempts' => (int) $r->total,
        ])->values()->all();
    }

    /** Engagement = focus + completion + consistency, 0..100. */
    private function engagementScore(int $uid, Carbon $since): array
    {
        $events = EngagementEvent::where('user_id', $uid)->where('created_at', '>=', $since);
        $blurs = (clone $events)->where('event_type', EngagementEvent::TAB_BLUR)->count();
        $focusAwayMs = (clone $events)->where('event_type', EngagementEvent::TAB_FOCUS)->sum('duration_ms');

        // Completion + drop-off from the assessments table (reliable: every quiz
        // has a status), not sparse start/submit pings.
        $sessions = Assessment::where('user_id', $uid)->where('created_at', '>=', $since)->count();
        $submits = Assessment::where('user_id', $uid)->where('status', 'completed')
            ->where('created_at', '>=', $since)->count();
        $dropOffs = max(0, $sessions - $submits);

        $completion = $sessions > 0 ? $submits / $sessions : 1;
        // Penalise frequent tab-aways; reward completion.
        $focusPenalty = min(40, $blurs * 3);
        $dropPenalty = min(25, $dropOffs * 8);
        $score = (int) round(max(0, min(100, 100 * $completion - $focusPenalty - $dropPenalty)));

        return [
            'score'            => $score,
            'tab_switches'     => $blurs,
            'focus_away_s'     => (int) round(($focusAwayMs ?? 0) / 1000),
            'completion_rate'  => $sessions > 0 ? (int) round($completion * 100) : null,
            'drop_offs'        => $dropOffs,
            'band'             => $this->band($score),
        ];
    }

    /** Integrity = assessment authenticity from focus-loss patterns, 0..100. */
    private function integrityReport(int $uid, Carbon $since): array
    {
        // Integrity = assessment-scoped only (events carrying an assessment_id).
        // App-wide tab switches live in engagementScore, not here.
        $events = EngagementEvent::where('user_id', $uid)->where('created_at', '>=', $since)
            ->whereNotNull('assessment_id');
        $blurs = (clone $events)->where('event_type', EngagementEvent::TAB_BLUR)->count();
        $longAways = (clone $events)->where('event_type', EngagementEvent::TAB_FOCUS)
            ->where('duration_ms', '>', 15000)->count();   // away > 15s mid-question
        $assessments = max(1, (clone $events)->where('event_type', EngagementEvent::ASSESSMENT_START)->count());

        $perAssessment = $blurs / $assessments;
        $score = (int) round(max(0, min(100, 100 - $perAssessment * 10 - $longAways * 12)));

        return [
            'score'            => $score,
            'tab_switches'     => $blurs,
            'long_aways'       => $longAways,
            'per_assessment'   => round($perAssessment, 1),
            'flag'             => $score < 60 ? 'review' : ($score < 80 ? 'watch' : 'clean'),
        ];
    }

    private function recommendations(array $perf, array $eng, array $integ, array $acc): array
    {
        $recs = [];
        foreach (($perf['weaknesses'] ?? collect()) as $w) {
            $recs[] = ['type' => 'gap', 'priority' => 'high',
                'text' => "Revise {$w['concept']} ({$w['topic']}) — mastery {$w['score']}%."];
        }
        if (($eng['tab_switches'] ?? 0) >= 5) {
            $recs[] = ['type' => 'focus', 'priority' => 'medium',
                'text' => "Frequent tab-switching ({$eng['tab_switches']}×). Try a distraction-free run."];
        }
        if (($acc['pct'] ?? 100) !== null && $acc['pct'] < 50) {
            $recs[] = ['type' => 'practice', 'priority' => 'high',
                'text' => "Accuracy {$acc['pct']}% — schedule guided practice before new topics."];
        }
        if (($integ['flag'] ?? 'clean') === 'review') {
            $recs[] = ['type' => 'integrity', 'priority' => 'medium',
                'text' => 'Assessment focus pattern needs review for authenticity.'];
        }
        return array_slice($recs, 0, 6);
    }

    private function interventions(array $core): array
    {
        $out = [];
        foreach (($core['gap_analysis']['knowledge_gaps'] ?? []) as $g) {
            $out[] = "Practice {$g['concept']} ({$g['topic_name']}) — {$g['recommendation']}";
        }
        if (($core['attention']['tab_switches'] ?? 0) >= 5) {
            $out[] = 'Set up a quiet, single-screen study slot to improve focus.';
        }
        return array_slice($out, 0, 5);
    }

    private function band(int $score): string
    {
        return $score >= 80 ? 'high' : ($score >= 55 ? 'medium' : 'low');
    }

    /* ----------------------------------------------------------- cohort bits */

    private function cohortAvgEngagement(Carbon $since): ?int
    {
        $ids = EngagementEvent::where('created_at', '>=', $since)->distinct()->pluck('user_id');
        if ($ids->isEmpty()) return null;
        $sum = 0;
        foreach ($ids as $id) $sum += $this->engagementScore($id, $since)['score'];
        return (int) round($sum / $ids->count());
    }

    private function cohortAvgIntegrity(Carbon $since): ?int
    {
        $ids = EngagementEvent::where('created_at', '>=', $since)->distinct()->pluck('user_id');
        if ($ids->isEmpty()) return null;
        $sum = 0;
        foreach ($ids as $id) $sum += $this->integrityReport($id, $since)['score'];
        return (int) round($sum / $ids->count());
    }

    private function segmentation(Carbon $since): array
    {
        // Bucket students by recent accuracy.
        $rows = AssessmentAnswer::where('created_at', '>=', $since)
            ->selectRaw('user_id, COUNT(*) as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct')
            ->groupBy('user_id')->get();
        $buckets = ['excelling' => 0, 'on_track' => 0, 'at_risk' => 0, 'critical' => 0];
        foreach ($rows as $r) {
            $pct = $r->total > 0 ? $r->correct / $r->total * 100 : 0;
            if ($pct >= 80) $buckets['excelling']++;
            elseif ($pct >= 60) $buckets['on_track']++;
            elseif ($pct >= 40) $buckets['at_risk']++;
            else $buckets['critical']++;
        }
        return $buckets;
    }

    private function cohortTopGaps(): array
    {
        return KnowledgeGap::selectRaw(
            'concept, topic_name, COUNT(*) as total,
             SUM(CASE WHEN resolved THEN 0 ELSE 1 END) as open'
        )->groupBy('concept', 'topic_name')
            ->orderByDesc('total')->limit(12)->get()->toArray();
    }

    private function cohortGapTrends(int $days): array
    {
        $since = now()->subDays($days);
        $created = KnowledgeGap::where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $resolved = KnowledgeGap::where('resolved', true)->where('updated_at', '>=', $since)
            ->selectRaw('DATE(updated_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $out = [];
        for ($d = $days - 1; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $out[] = ['day' => $day, 'created' => (int) ($created[$day] ?? 0), 'resolved' => (int) ($resolved[$day] ?? 0)];
        }
        return $out;
    }

    private function cohortIntegrity(Carbon $since): array
    {
        return EngagementEvent::where('created_at', '>=', $since)
            ->where('event_type', EngagementEvent::TAB_BLUR)
            ->selectRaw('user_id, COUNT(*) as switches')
            ->groupBy('user_id')->orderByDesc('switches')->limit(10)->get()
            ->map(function ($r) use ($since) {
                $u = User::select('id', 'name', 'grade')->find($r->user_id);
                return [
                    'user'           => $u,
                    'tab_switches'   => (int) $r->switches,
                    'integrity_score' => $this->integrityReport($r->user_id, $since)['score'],
                ];
            })->values()->all();
    }

    private function completionTrend(int $days): array
    {
        $since = now()->subDays($days);
        $started = Assessment::where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $done = Assessment::where('status', 'completed')->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $out = [];
        for ($d = $days - 1; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $s = (int) ($started[$day] ?? 0);
            $out[] = ['day' => $day, 'started' => $s, 'completed' => (int) ($done[$day] ?? 0),
                'rate' => $s > 0 ? (int) round(((int) ($done[$day] ?? 0)) / $s * 100) : null];
        }
        return $out;
    }

    private function cohortEngagementTrend(int $days): array
    {
        $since = now()->subDays($days);
        $active = EngagementEvent::where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(DISTINCT user_id) as users')
            ->groupBy('day')->pluck('users', 'day');
        $blurs = EngagementEvent::where('created_at', '>=', $since)
            ->where('event_type', EngagementEvent::TAB_BLUR)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')->groupBy('day')->pluck('c', 'day');
        $out = [];
        for ($d = $days - 1; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $out[] = ['day' => $day, 'active_users' => (int) ($active[$day] ?? 0), 'tab_switches' => (int) ($blurs[$day] ?? 0)];
        }
        return $out;
    }

    /** Flat rows for CSV/XLSX export on the admin dashboard. */
    private function exportRows(Carbon $since): array
    {
        return User::where('role', 'student')->select('id', 'name', 'grade')->get()
            ->map(function ($u) use ($since) {
                $ans = AssessmentAnswer::where('user_id', $u->id)->where('created_at', '>=', $since)->get();
                $acc = $this->accuracy($ans);
                return [
                    'student'    => $u->name,
                    'grade'      => $u->grade,
                    'accuracy'   => $acc['pct'],
                    'questions'  => $acc['total'],
                    'engagement' => $this->engagementScore($u->id, $since)['score'],
                    'integrity'  => $this->integrityReport($u->id, $since)['score'],
                    'open_gaps'  => KnowledgeGap::where('user_id', $u->id)->where('resolved', false)->count(),
                ];
            })->values()->all();
    }
}
