<?php

namespace App\Services\Quest;

use App\Models\Subject;
use App\Models\Topic;
use App\Models\TopicPrerequisite;
use Illuminate\Support\Facades\Cache;

/**
 * Engine 1 — the prerequisite graph over topics.
 *
 * Port of LearnQuest's `engines/skill_graph.py`, backed by `topic_prerequisites`
 * instead of an in-memory taxonomy. A graph is built per subject (the natural
 * traversal boundary here) and memoised for the request; the adjacency itself is
 * cached because curriculum edges change rarely and are read on every quest load.
 *
 * The graph is what makes gap detection meaningful: without it, a wrong answer on
 * "regrouping" looks like a regrouping problem rather than a place-value one.
 */
class SkillGraphService
{
    /** Cache TTL for a subject's adjacency (curriculum edges change rarely). */
    private const CACHE_TTL = 3600;

    /** Per-request memo: subject_id => ['skills'=>[id=>Topic], 'prereqs'=>[id=>[id]], 'deps'=>[id=>[id]]]. */
    private array $memo = [];

    /** Build (or fetch) the adjacency for one subject. */
    public function forSubject(int $subjectId): array
    {
        if (isset($this->memo[$subjectId])) {
            return $this->memo[$subjectId];
        }

        $graph = Cache::remember("skillgraph:subject:{$subjectId}", self::CACHE_TTL, function () use ($subjectId) {
            $topics = Topic::whereHas('chapter', fn ($q) => $q->where('subject_id', $subjectId))
                ->with('chapter:id,subject_id,position')
                ->orderBy('position')
                ->get();

            $ids = $topics->pluck('id')->all();

            $prereqs = array_fill_keys($ids, []);
            $deps    = array_fill_keys($ids, []);

            if ($ids) {
                $edges = TopicPrerequisite::whereIn('topic_id', $ids)
                    ->whereIn('prerequisite_topic_id', $ids)   // stay inside the subject
                    ->get(['topic_id', 'prerequisite_topic_id']);

                foreach ($edges as $e) {
                    $prereqs[$e->topic_id][]            = $e->prerequisite_topic_id;
                    $deps[$e->prerequisite_topic_id][]  = $e->topic_id;
                }
            }

            return [
                'topics'  => $topics->keyBy('id')->map(fn ($t) => [
                    'id'         => $t->id,
                    'name'       => $t->name,
                    'mechanic'   => $t->mechanic,
                    'chapter_id' => $t->chapter_id,
                    'position'   => $t->position,
                ])->all(),
                'prereqs' => $prereqs,
                'deps'    => $deps,
            ];
        });

        return $this->memo[$subjectId] = $graph;
    }

    /** Drop the cached adjacency (call after editing prerequisite edges). */
    public function forget(int $subjectId): void
    {
        unset($this->memo[$subjectId]);
        Cache::forget("skillgraph:subject:{$subjectId}");
    }

    /** All topic ids in the subject, in curriculum order. */
    public function skillIds(int $subjectId): array
    {
        return array_keys($this->forSubject($subjectId)['topics']);
    }

    public function topic(int $subjectId, int $topicId): ?array
    {
        return $this->forSubject($subjectId)['topics'][$topicId] ?? null;
    }

    /** Direct prerequisites of a topic. */
    public function prerequisites(int $subjectId, int $topicId): array
    {
        return $this->forSubject($subjectId)['prereqs'][$topicId] ?? [];
    }

    /** Topics that directly require this one. */
    public function dependents(int $subjectId, int $topicId): array
    {
        return $this->forSubject($subjectId)['deps'][$topicId] ?? [];
    }

    /** Transitive closure of dependents — everything blocked by this topic. */
    public function allDownstream(int $subjectId, int $topicId): array
    {
        $deps = $this->forSubject($subjectId)['deps'];
        $seen = [];
        $stack = $deps[$topicId] ?? [];

        while ($stack) {
            $cur = array_pop($stack);
            if (isset($seen[$cur])) {
                continue;
            }
            $seen[$cur] = true;
            foreach ($deps[$cur] ?? [] as $next) {
                $stack[] = $next;
            }
        }
        return array_keys($seen);
    }

    /** A topic is ready to learn once every prerequisite is mastered. */
    public function isReady(int $subjectId, int $topicId, array $masteredIds): bool
    {
        $mastered = array_flip($masteredIds);
        foreach ($this->prerequisites($subjectId, $topicId) as $pre) {
            if (! isset($mastered[$pre])) {
                return false;
            }
        }
        return true;
    }

    /** Unmastered topics whose prerequisites are all mastered (the ZPD). */
    public function readySet(int $subjectId, array $masteredIds): array
    {
        $mastered = array_flip($masteredIds);
        return array_values(array_filter(
            $this->skillIds($subjectId),
            fn ($id) => ! isset($mastered[$id]) && $this->isReady($subjectId, $id, $masteredIds),
        ));
    }

    /**
     * Topological order (prerequisites before dependents).
     *
     * A cycle would be a curriculum-authoring error. Rather than throw on a page
     * load, we break it: the offending topic is emitted where it was first seen,
     * which degrades the map's ordering but never 500s a student's quest screen.
     */
    public function topoOrder(int $subjectId): array
    {
        $visited = [];
        $order   = [];

        $visit = function (int $id, array $path) use (&$visit, &$visited, &$order, $subjectId) {
            if (isset($visited[$id]) || isset($path[$id])) {
                return; // already emitted, or a cycle — stop descending
            }
            $path[$id] = true;
            foreach ($this->prerequisites($subjectId, $id) as $pre) {
                $visit($pre, $path);
            }
            $visited[$id] = true;
            $order[] = $id;
        };

        foreach ($this->skillIds($subjectId) as $id) {
            $visit($id, []);
        }
        return $order;
    }

    /** The subject a topic belongs to (null when the topic is detached). */
    public function subjectIdOf(Topic $topic): ?int
    {
        return $topic->chapter?->subject_id;
    }

    /** Subjects available to a student's level, in curriculum order. */
    public function subjectsForLevel(?int $levelId)
    {
        return Subject::where('level_id', $levelId)->orderBy('position')->get();
    }
}
