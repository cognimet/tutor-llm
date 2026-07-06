<?php

namespace App\Support;

use App\Models\ConceptMastery;
use App\Models\KnowledgeGap;
use App\Models\ProgressSnapshot;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Shared analytics used by both the School and Teacher panels, so their
 * insights are computed identically. Everything is keyed by user id and driven
 * by a set of student ids, keeping the controllers thin and consistent.
 */
class Insights
{
    /** Mastery % (0..100) per student, from EWMA concept scores. */
    public static function masteryByUser(Collection $ids): Collection
    {
        if ($ids->isEmpty()) return collect();
        return ConceptMastery::whereIn('user_id', $ids)
            ->selectRaw('user_id, AVG(score) as m')->groupBy('user_id')
            ->pluck('m', 'user_id')->map(fn ($m) => (int) round((float) $m * 100));
    }

    /** Open-gap counts per student: {open, high, medium, low}. */
    public static function gapAggByUser(Collection $ids): Collection
    {
        if ($ids->isEmpty()) return collect();
        return KnowledgeGap::whereIn('user_id', $ids)->where('resolved', false)
            ->selectRaw("user_id,
                COUNT(*) as open,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low")
            ->groupBy('user_id')->get()->keyBy('user_id');
    }

    /** The most-severe open-gap concept per student (for "why at risk"). */
    public static function topConceptByUser(Collection $ids): Collection
    {
        if ($ids->isEmpty()) return collect();
        $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
        return KnowledgeGap::whereIn('user_id', $ids)->where('resolved', false)
            ->get(['user_id', 'concept', 'severity'])
            ->groupBy('user_id')
            ->map(fn ($g) => $g->sortBy(fn ($x) => $rank[$x->severity] ?? 3)->first()->concept);
    }

    /** School/section-wide severity totals: {open, high, medium, low}. */
    public static function severityTotals(Collection $ids): array
    {
        $s = $ids->isEmpty() ? collect() : KnowledgeGap::whereIn('user_id', $ids)->where('resolved', false)
            ->selectRaw('severity, COUNT(*) as c')->groupBy('severity')->pluck('c', 'severity');
        return [
            'open'   => (int) $s->sum(),
            'high'   => (int) ($s['high'] ?? 0),
            'medium' => (int) ($s['medium'] ?? 0),
            'low'    => (int) ($s['low'] ?? 0),
        ];
    }

    /** Average mastery % per topic (weakest first) — what to reteach. */
    public static function topicMastery(Collection $ids, int $limit = 6): Collection
    {
        if ($ids->isEmpty()) return collect();
        return ConceptMastery::whereIn('user_id', $ids)
            ->selectRaw('topic_name, AVG(score) as m, COUNT(DISTINCT user_id) as students')
            ->groupBy('topic_name')->orderBy('m')->limit($limit)->get()
            ->map(fn ($r) => [
                'topic' => $r->topic_name,
                'mastery' => (int) round((float) $r->m * 100),
                'students' => (int) $r->students,
            ]);
    }

    /** Open gaps grouped by topic (hotspots): [{topic_name, c}]. */
    public static function topicGaps(Collection $ids, int $limit = 6): Collection
    {
        if ($ids->isEmpty()) return collect();
        return KnowledgeGap::whereIn('user_id', $ids)->where('resolved', false)
            ->selectRaw('topic_name, COUNT(*) as c')
            ->groupBy('topic_name')->orderByDesc('c')->limit($limit)->get();
    }

    /** Top weak-concept clusters: [{concept, c, high}]. */
    public static function gapClusters(Collection $ids, int $limit = 8): Collection
    {
        if ($ids->isEmpty()) return collect();
        return KnowledgeGap::whereIn('user_id', $ids)->where('resolved', false)
            ->selectRaw("concept, COUNT(*) as c, SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high")
            ->groupBy('concept')->orderByDesc('c')->limit($limit)->get();
    }

    /** Average mastery per day over the last N days: [{day, mastery}]. */
    public static function masteryTrend(Collection $ids, int $days = 14): array
    {
        $raw = $ids->isEmpty() ? collect() : ProgressSnapshot::whereIn('user_id', $ids)
            ->where('day', '>=', Carbon::today()->subDays($days - 1)->toDateString())
            ->selectRaw('day, AVG(mastery) as m')->groupBy('day')->pluck('m', 'day');

        $out = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $day = Carbon::today()->subDays($i)->toDateString();
            $out[] = ['day' => $day, 'mastery' => (int) round((float) ($raw[$day] ?? 0))];
        }
        return $out;
    }

    /**
     * The full analytics block for any cohort of students (a section, a class,
     * a whole school). Takes an already-loaded User collection carrying
     * id, name, last_active_date, current_streak — returns the shape both the
     * School and Teacher detail pages render, so they stay identical.
     */
    public static function cohortReport(Collection $students): array
    {
        $ids = $students->pluck('id');
        $mastery    = self::masteryByUser($ids);
        $gaps       = self::gapAggByUser($ids);
        $topConcept = self::topConceptByUser($ids);

        $rows = $students->map(function ($s) use ($mastery, $gaps, $topConcept) {
            $g = $gaps[$s->id] ?? null;
            $m = (int) ($mastery[$s->id] ?? 0);
            $high = (int) ($g->high ?? 0);
            return [
                'id' => $s->id, 'name' => $s->name,
                'mastery' => $m,
                'open_gaps' => (int) ($g->open ?? 0), 'high_gaps' => $high,
                'band' => self::band($m),
                'top_concept' => $topConcept[$s->id] ?? null,
                'last_active' => $s->last_active_date ? Carbon::parse($s->last_active_date)->diffForHumans() : 'never',
                'active_7d' => $s->last_active_date && Carbon::parse($s->last_active_date)->gte(Carbon::today()->subDays(7)),
                'streak' => (int) $s->current_streak,
                'at_risk' => self::isAtRisk($m, $high),
            ];
        });

        $withData = $rows->where('mastery', '>', 0);
        $bands = $rows->groupBy('band')->map->count();
        $clusters = self::gapClusters($ids);
        $focus = $clusters->first();

        return [
            'kpis' => [
                'avg_mastery' => $withData->isNotEmpty() ? (int) round($withData->avg('mastery')) : 0,
                'students'    => $students->count(),
                'needs_help'  => $rows->where('band', 'needs_help')->count(),
                'on_track'    => $rows->where('band', 'strong')->count(),
                'active_7d'   => $rows->where('active_7d', true)->count(),
            ],
            'distribution' => [
                'strong'     => (int) ($bands['strong'] ?? 0),
                'developing' => (int) ($bands['developing'] ?? 0),
                'needs_help' => (int) ($bands['needs_help'] ?? 0),
                'no_data'    => (int) ($bands['no_data'] ?? 0),
            ],
            'gaps'          => self::severityTotals($ids),
            'gap_clusters'  => $clusters,
            'topic_mastery' => self::topicMastery($ids),
            'focus'         => $focus ? ['concept' => $focus->concept, 'count' => (int) $focus->c] : null,
            'mastery_trend' => self::masteryTrend($ids),
            'students'      => $rows->sortByDesc('mastery')->values(),
            'at_risk'       => $rows->where('at_risk', true)->sortBy('mastery')->values(),
            'top_performers'=> $withData->sortByDesc('mastery')->take(5)->map(fn ($r) => [
                'id' => $r['id'], 'name' => $r['name'], 'mastery' => $r['mastery'], 'streak' => $r['streak'],
            ])->values(),
        ];
    }

    /**
     * Per-section rollup for a class page: [{id, name, students, avg_mastery,
     * open_gaps, at_risk}], richest first. `$students` must carry section_id.
     */
    public static function sectionComparison(Collection $students, Collection $sections): Collection
    {
        $ids = $students->pluck('id');
        $mastery = self::masteryByUser($ids);
        $gaps    = self::gapAggByUser($ids);
        $bySection = $students->groupBy('section_id');

        return $sections->map(function ($sec) use ($bySection, $mastery, $gaps) {
            $g = $bySection[$sec->id] ?? collect();
            $wd = $g->map(fn ($s) => (int) ($mastery[$s->id] ?? 0))->filter(fn ($m) => $m > 0);
            return [
                'id' => $sec->id, 'name' => $sec->name,
                'students'    => $g->count(),
                'avg_mastery' => $wd->isNotEmpty() ? (int) round($wd->avg()) : 0,
                'open_gaps'   => (int) $g->sum(fn ($s) => (int) (($gaps[$s->id]->open ?? 0))),
                'at_risk'     => $g->filter(fn ($s) => self::isAtRisk((int) ($mastery[$s->id] ?? 0), (int) (($gaps[$s->id]->high ?? 0))))->count(),
            ];
        })->sortByDesc('avg_mastery')->values();
    }

    /** Is a student "at risk"? Low mastery OR any high-severity open gap. */
    public static function isAtRisk(int $mastery, int $high): bool
    {
        return $mastery > 0 && ($mastery < 50 || $high > 0);
    }

    /** Mastery band: strong ≥80, developing 50–79, needs_help <50 (with data). */
    public static function band(int $mastery): string
    {
        if ($mastery <= 0) return 'no_data';
        if ($mastery >= 80) return 'strong';
        if ($mastery >= 50) return 'developing';
        return 'needs_help';
    }
}
