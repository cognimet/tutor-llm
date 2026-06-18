<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TopicNote;
use App\Services\AiClient;
use App\Services\CurriculumResolver;
use Illuminate\Http\Request;

/**
 * Textbook figures (diagrams) ingested from an uploaded book. The AI service
 * rasterises every page, reads it with the vision model, and embeds each
 * diagram into the Qdrant `documents` store; here we expose the page images so
 * the chat UI can show "Diagrams from your book" beside the lesson. Images are
 * read from the shared storage volume the AI service writes them to.
 */
class FigureController extends Controller
{
    public function __construct(
        protected AiClient $ai,
        protected CurriculumResolver $resolver,
    ) {}

    /** GET /tutor/figures — figures relevant to the current topic/subject. */
    public function index(Request $request)
    {
        $user = $request->user();
        $topicId = $request->filled('topic_id') ? $request->integer('topic_id') : null;
        $subjectId = $this->resolver->subjectId($user, $topicId, $request->query('subject_name'));
        $topic = $request->query('topic_name');

        $figures = $this->ai->figures($user->id, $subjectId, $topic, $request->integer('k') ?: 12);

        // Rewrite the AI service's internal image path into an auth'd URL we serve.
        $out = [];
        foreach ($figures as $f) {
            $noteId = (int) ($f['note_id'] ?? 0);
            $page = (int) ($f['page'] ?? 0);
            if (! $noteId || ! $page) continue;
            $out[] = [
                'note_id'     => $noteId,
                'page'        => $page,
                'title'       => $f['title'] ?? "Figure (p.{$page})",
                'labels'      => is_array($f['labels'] ?? null) ? $f['labels'] : [],
                'description' => $f['description'] ?? '',
                // Same-origin relative path so the browser loads it through the
                // frontend's proxy (not the backend's internal container host).
                'image_url'   => "/api/tutor/figures/{$noteId}/{$page}/image",
            ];
        }

        return response()->json(['figures' => $out]);
    }

    /** GET /tutor/figures/{noteId}/{page}/image — stream a rendered page image. */
    public function image(Request $request, int $noteId, int $page)
    {
        // Only the owner of the source textbook note may view its pages.
        $note = TopicNote::find($noteId);
        abort_unless($note && $note->user_id === $request->user()->id, 404);

        // Served from the shared volume root (storage_path('app') == the AI
        // service's UPLOAD_ROOT), where the page images (JPEG) are written.
        $abs = storage_path(sprintf('app/figures/%d/p%04d.jpg', $noteId, $page));
        abort_unless(is_file($abs), 404, 'Figure not found.');

        return response()->file($abs, [
            'Content-Type'  => 'image/jpeg',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /** GET /tutor/textbooks/{note}/status — ingest progress for the upload UI. */
    public function status(Request $request, TopicNote $note)
    {
        abort_unless($note->user_id === $request->user()->id, 403, 'Not your note.');
        return response()->json($this->ai->textbookIngestStatus($note->id));
    }
}
