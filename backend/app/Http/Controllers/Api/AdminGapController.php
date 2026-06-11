<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\Misconception;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Admin: cohort-level gap analytics — the content-quality signal.
 * Most-failed concepts, severity mix, resolution trend, students at risk,
 * mastery by topic, and the misconceptions the tutor keeps catching.
 */
class AdminGapController extends Controller
{
    /** GET /api/admin/gaps?days=30 */
    public function overview(Request $request)
    {
        $days = min(90, max(7, (int) $request->query('days', 30)));
        $since = now()->subDays($days);

        // Headline numbers.
        $open = KnowledgeGap::where('resolved', false)->count();
        $resolvedTotal = KnowledgeGap::where('resolved', true)->count();
        $createdInPeriod = KnowledgeGap::where('created_at', '>=', $since)->count();
        $resolvedInPeriod = KnowledgeGap::where('resolved', true)
            ->where('updated_at', '>=', $since)->count();

        // Open-gap severity mix.
        $bySeverity = KnowledgeGap::where('resolved', false)
            ->selectRaw('severity, COUNT(*) as count')
            ->groupBy('severity')->pluck('count', 'severity');

        // Most-failed concepts (the curriculum's weak spots).
        $topConcepts = KnowledgeGap::selectRaw(
            'concept, topic_name, COUNT(*) as total,
             SUM(CASE WHEN resolved THEN 0 ELSE 1 END) as open'
        )->groupBy('concept', 'topic_name')
            ->orderByDesc('total')->limit(12)->get();

        // Daily created-vs-resolved trend.
        $created = KnowledgeGap::where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as created')
            ->groupBy('day')->pluck('created', 'day');
        $resolved = KnowledgeGap::where('resolved', true)
            ->where('updated_at', '>=', $since)
            ->selectRaw('DATE(updated_at) as day, COUNT(*) as resolved')
            ->groupBy('day')->pluck('resolved', 'day');
        $trend = [];
        for ($d = $days - 1; $d >= 0; $d--) {
            $day = now()->subDays($d)->toDateString();
            $trend[] = [
                'day' => $day,
                'created' => (int) ($created[$day] ?? 0),
                'resolved' => (int) ($resolved[$day] ?? 0),
            ];
        }

        // Students at risk: most open gaps right now.
        $atRisk = KnowledgeGap::where('resolved', false)
            ->selectRaw('user_id, COUNT(*) as open_gaps,
                SUM(CASE WHEN severity = \'high\' THEN 1 ELSE 0 END) as high')
            ->groupBy('user_id')->orderByDesc('open_gaps')->limit(10)->get()
            ->map(function ($r) {
                $u = User::select('id', 'name', 'email', 'grade')->find($r->user_id);
                $weakest = ConceptMastery::where('user_id', $r->user_id)
                    ->orderBy('score')->first();
                $misc = Misconception::where('user_id', $r->user_id)
                    ->where('status', 'open')->count();
                return [
                    'user' => $u,
                    'open_gaps' => (int) $r->open_gaps,
                    'high_severity' => (int) $r->high,
                    'open_misconceptions' => $misc,
                    'weakest_concept' => $weakest
                        ? ['concept' => $weakest->concept, 'score' => (int) round($weakest->score * 100)]
                        : null,
                ];
            });

        // Mastery by topic across the cohort (EWMA averages).
        $masteryByTopic = ConceptMastery::selectRaw(
            'topic_name, COUNT(DISTINCT concept) as concepts,
             COUNT(DISTINCT user_id) as students, AVG(score) as avg_score'
        )->groupBy('topic_name')->orderBy('avg_score')->limit(12)->get()
            ->map(fn ($r) => [
                'topic_name' => $r->topic_name,
                'concepts' => (int) $r->concepts,
                'students' => (int) $r->students,
                'avg_mastery' => (int) round($r->avg_score * 100),
            ]);

        // Misconceptions the tutor keeps catching (live, from chat).
        $misconceptions = Misconception::selectRaw(
            'description, topic_name, COUNT(*) as count,
             SUM(CASE WHEN status = \'open\' THEN 1 ELSE 0 END) as open'
        )->groupBy('description', 'topic_name')
            ->orderByDesc('count')->limit(10)->get();

        return response()->json([
            'period_days' => $days,
            'totals' => [
                'open_gaps' => $open,
                'resolved_total' => $resolvedTotal,
                'created_in_period' => $createdInPeriod,
                'resolved_in_period' => $resolvedInPeriod,
                'resolution_rate' => $createdInPeriod > 0
                    ? (int) round(($resolvedInPeriod / max(1, $createdInPeriod)) * 100) : null,
            ],
            'by_severity' => [
                'high' => (int) ($bySeverity['high'] ?? 0),
                'medium' => (int) ($bySeverity['medium'] ?? 0),
                'low' => (int) ($bySeverity['low'] ?? 0),
            ],
            'top_concepts' => $topConcepts,
            'trend' => $trend,
            'students_at_risk' => $atRisk,
            'mastery_by_topic' => $masteryByTopic,
            'misconceptions' => $misconceptions,
        ]);
    }
}
