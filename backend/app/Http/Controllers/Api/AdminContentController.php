<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ContentChunk;
use App\Models\Topic;
use App\Services\RagIndexer;
use Illuminate\Http\Request;

/**
 * Admin: curriculum content (the RAG knowledge base) + indexing controls.
 */
class AdminContentController extends Controller
{
    public function __construct(protected RagIndexer $indexer) {}

    /** GET /admin/topics/{topic}/content */
    public function index(Topic $topic)
    {
        return response()->json([
            'topic' => $topic->only('id', 'name'),
            'chunks' => ContentChunk::where('topic_id', $topic->id)->orderBy('id')->get(),
        ]);
    }

    /** POST /admin/topics/{topic}/content */
    public function store(Request $request, Topic $topic)
    {
        $data = $request->validate([
            'type' => 'required|in:explainer,example,misconception',
            'body' => 'required|string|max:8000',
            'source_ref' => 'nullable|string|max:255',
        ]);

        $chunk = ContentChunk::create([...$data, 'topic_id' => $topic->id]);

        return response()->json($chunk, 201);
    }

    /** PATCH /admin/content/{chunk} */
    public function update(Request $request, ContentChunk $chunk)
    {
        $data = $request->validate([
            'type' => 'sometimes|in:explainer,example,misconception',
            'body' => 'sometimes|string|max:8000',
            'source_ref' => 'nullable|string|max:255',
        ]);

        // Editing invalidates the indexed vector until re-indexed.
        $chunk->update([...$data, 'indexed_at' => null]);

        return response()->json($chunk);
    }

    /** DELETE /admin/content/{chunk} */
    public function destroy(ContentChunk $chunk)
    {
        $chunk->delete();

        return response()->json(['deleted' => true]);
    }

    /** POST /admin/topics/{topic}/reindex */
    public function reindexTopic(Topic $topic)
    {
        $n = $this->indexer->reindexTopic($topic);

        return response()->json(['topic' => $topic->name, 'indexed' => $n]);
    }

    /** POST /admin/rag/reindex  — index everything (or ?pending=1). */
    public function reindexAll(Request $request)
    {
        $n = $this->indexer->indexAll(onlyPending: (bool) $request->boolean('pending'));

        return response()->json(['indexed' => $n]);
    }
}
