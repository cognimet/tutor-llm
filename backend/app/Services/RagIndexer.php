<?php

namespace App\Services;

use App\Models\ContentChunk;
use App\Models\Topic;
use Illuminate\Support\Facades\Log;

/**
 * Pushes curriculum content_chunks into the vector store (via the AI service).
 *
 * The chunk's primary key is reused as the Qdrant point id, so re-indexing a
 * chunk overwrites its vector cleanly. `indexed_at` records what is live.
 */
class RagIndexer
{
    public function __construct(protected AiClient $ai) {}

    /** Index every not-yet-indexed (or all) chunk. Returns count indexed. */
    public function indexAll(bool $onlyPending = false, ?callable $progress = null): int
    {
        $this->ai->ensureCollection();

        $query = ContentChunk::with('topic');
        if ($onlyPending) {
            $query->whereNull('indexed_at');
        }

        $total = 0;
        // chunkById, NOT chunk: the callback sets indexed_at, which removes
        // rows from the --pending filter mid-iteration. Offset-based chunk()
        // then skips every other page (e.g. indexes 159 of 259); keyset
        // pagination by id is immune to the shrinking result set.
        $query->chunkById(100, function ($chunks) use (&$total, $progress) {
            $points = $chunks->map(fn (ContentChunk $c) => [
                'id' => $c->id,
                'topic' => $c->topic?->name ?? '',
                'type' => $c->type,
                'body' => $c->body,
            ])->all();

            $n = $this->ai->index($points);
            ContentChunk::whereIn('id', $chunks->pluck('id'))->update(['indexed_at' => now()]);
            $total += $n;
            $progress && $progress($total);
        });

        Log::info('RAG index complete', ['indexed' => $total]);
        return $total;
    }

    /** Re-index a single topic's chunks (delete + re-add). */
    public function reindexTopic(Topic $topic): int
    {
        $this->ai->deleteTopic($topic->name);

        $points = ContentChunk::where('topic_id', $topic->id)->get()
            ->map(fn (ContentChunk $c) => [
                'id' => $c->id, 'topic' => $topic->name, 'type' => $c->type, 'body' => $c->body,
            ])->all();

        if (empty($points)) {
            return 0;
        }

        $n = $this->ai->index($points);
        ContentChunk::where('topic_id', $topic->id)->update(['indexed_at' => now()]);
        return $n;
    }
}
