<?php

namespace App\Console\Commands;

use App\Models\ConceptMastery;
use App\Models\Topic;
use App\Services\GraphClient;
use Illuminate\Console\Command;

/**
 * Sync the curriculum hierarchy into the Neo4j knowledge graph (the GraphRAG
 * "AI mind"):
 *   Stage → Track → Level → Subject → Chapter → Topic   (+ NEXT ordering)
 *   plus any already-observed Concept nodes (from concept_masteries).
 *
 *   php artisan graph:sync             # full curriculum
 *   php artisan graph:sync --pending   # same (idempotent MERGE; for entrypoint parity)
 *
 * Curriculum CONTENT vectors stay in Qdrant (run `php artisan rag:index`); this
 * command only builds the graph structure the tutor reasons over. The graph is
 * fully rebuildable from Postgres, so this is safe to re-run any time.
 */
class GraphSync extends Command
{
    protected $signature = 'graph:sync {--pending : Accepted for entrypoint parity; the sync is idempotent}';
    protected $description = 'Sync the curriculum hierarchy + concepts into the Neo4j knowledge graph';

    public function handle(GraphClient $graph): int
    {
        $this->info('Syncing curriculum into the knowledge graph…');

        $topics = Topic::with('chapter.subject.level.track.stage')
            ->orderBy('chapter_id')->orderBy('position')->get();

        if ($topics->isEmpty()) {
            $this->warn('No topics found — nothing to sync.');
            return self::SUCCESS;
        }

        $rows = [];
        $byChapter = [];   // chapter_id => [topic names in order]
        foreach ($topics as $t) {
            $ch = $t->chapter;
            $sb = $ch?->subject;
            $lv = $sb?->level;
            $tr = $lv?->track;
            $st = $tr?->stage;
            if (! $ch || ! $sb || ! $lv || ! $tr || ! $st) {
                continue; // orphaned topic — skip
            }
            $rows[] = [
                'stage_id'   => $st->id, 'stage'   => $st->name,
                'track_id'   => $tr->id, 'track'   => $tr->name,
                'level_id'   => $lv->id, 'level'   => $lv->name,
                'subject_id' => $sb->id, 'subject' => $sb->name,
                'chapter_id' => $ch->id, 'chapter' => $ch->name,
                'topic_id'   => $t->id,  'topic'   => $t->name,
                'position'   => (int) $t->position,
            ];
            $byChapter[$ch->id][] = $t->name;
        }

        // NEXT edges: consecutive topics within a chapter (already ordered).
        $nextPairs = [];
        foreach ($byChapter as $names) {
            $names = array_values($names);
            for ($i = 1; $i < count($names); $i++) {
                $nextPairs[] = [$names[$i - 1], $names[$i]];
            }
        }

        // Concepts observed so far (per-student mastery accrues these over time;
        // usually empty on a fresh seed — they fill in as students learn).
        $concepts = ConceptMastery::query()
            ->select('topic_name', 'concept')->distinct()->get()
            ->map(fn ($c) => ['topic' => $c->topic_name, 'name' => $c->concept])
            ->all();

        $total = 0;
        foreach (array_chunk($rows, 200) as $batch) {
            $total += $graph->syncCurriculum($batch);
            $this->output->write("\r  topics synced: {$total}");
        }
        $this->newLine();

        // Send ordering + concepts once (they reference already-merged topics).
        $graph->syncCurriculum([], $nextPairs, $concepts);

        $this->info("✅ Synced {$total} topic(s), " . count($nextPairs) . ' ordering edge(s), '
            . count($concepts) . ' concept(s) into the graph.');

        return self::SUCCESS;
    }
}
