<?php

namespace App\Console\Commands;

use App\Models\Subject;
use App\Models\TopicPrerequisite;
use App\Services\Quest\SkillGraphService;
use Illuminate\Console\Command;

/**
 * Seed the prerequisite graph from the curriculum's own ordering.
 *
 * LearnQuest hand-authored its edges. Here the curriculum already encodes a
 * teaching order — chapters have `position`, topics have `position` within a
 * chapter — and a syllabus is written so that each topic builds on the one
 * before it. So the default graph is the curriculum chain:
 *
 *   topic[n] requires topic[n-1]   (within a chapter)
 *   chapter[m].first requires chapter[m-1].last
 *
 * This is a *starting* graph, not a claim of pedagogical truth. It gives every
 * subject a working quest map on day one, and a curriculum specialist can then
 * add or remove `topic_prerequisites` rows by hand — this command never deletes
 * an edge it didn't create, and re-running it is a no-op.
 */
class SeedTopicPrerequisites extends Command
{
    protected $signature = 'quest:seed-prerequisites
                            {--subject= : Only this subject id}
                            {--fresh : Delete existing edges for the affected subjects first}';

    protected $description = 'Build the topic prerequisite graph from curriculum ordering';

    public function handle(SkillGraphService $graph): int
    {
        $subjects = Subject::with(['chapters' => fn ($q) => $q->orderBy('position')->orderBy('id'),
                                   'chapters.topics' => fn ($q) => $q->orderBy('position')->orderBy('id')])
            ->when($this->option('subject'), fn ($q, $id) => $q->whereKey($id))
            ->get();

        if ($subjects->isEmpty()) {
            $this->warn('No subjects found.');
            return self::SUCCESS;
        }

        $created = 0;
        $skipped = 0;

        foreach ($subjects as $subject) {
            // The subject's topics, flattened into teaching order.
            $chain = $subject->chapters->flatMap->topics->values();
            if ($chain->count() < 2) {
                continue;
            }

            if ($this->option('fresh')) {
                TopicPrerequisite::whereIn('topic_id', $chain->pluck('id'))->delete();
            }

            for ($i = 1; $i < $chain->count(); $i++) {
                $row = TopicPrerequisite::firstOrCreate([
                    'topic_id'              => $chain[$i]->id,
                    'prerequisite_topic_id' => $chain[$i - 1]->id,
                ]);
                $row->wasRecentlyCreated ? $created++ : $skipped++;
            }

            $graph->forget($subject->id);
            $this->line("  {$subject->name}: {$chain->count()} topics chained");
        }

        $this->info("Prerequisite edges — created: {$created}, already present: {$skipped}");
        return self::SUCCESS;
    }
}
