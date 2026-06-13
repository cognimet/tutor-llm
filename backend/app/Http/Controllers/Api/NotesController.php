<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TopicNote;
use App\Services\NotesService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Student study notes: upload files (pdf/doc/sheet/image/text) that persist
 * per topic, are read by the tutor when attached, and feed the planner +
 * flashcards. Capped at 50 MB of uploads per topic.
 */
class NotesController extends Controller
{
    /** Per-topic upload budget (bytes). */
    public const CAP_BYTES = 52428800; // 50 MB

    public function __construct(protected NotesService $notes) {}

    /** GET /tutor/notes?topic_id=&topic_name= — notes for a topic + usage. */
    public function index(Request $request)
    {
        $notes = $this->scopeQuery($request)
            ->latest()
            ->get(['id', 'title', 'original_filename', 'mime', 'kind', 'size_bytes', 'status', 'summary', 'meta', 'created_at']);

        return response()->json([
            'notes' => $notes,
            'usage' => [
                'used_bytes' => (int) $this->scopeQuery($request)->sum('size_bytes'),
                'cap_bytes'  => self::CAP_BYTES,
            ],
        ]);
    }

    /** POST /tutor/notes — multipart upload; stores + processes the file. */
    public function store(Request $request)
    {
        $data = $request->validate([
            'file'         => ['required', 'file', 'max:51200', // 50 MB (KB units)
                'mimes:pdf,doc,docx,txt,md,csv,xls,xlsx,png,jpg,jpeg,webp,gif,bmp,tiff'],
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['required', 'string', 'max:160'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'title'        => ['nullable', 'string', 'max:160'],
        ]);

        $user = $request->user();
        $file = $request->file('file');
        $size = $file->getSize();

        // Enforce the 50 MB-per-topic cap.
        $used = (int) $this->scopeQuery($request)->sum('size_bytes');
        if ($used + $size > self::CAP_BYTES) {
            $remaining = max(0, self::CAP_BYTES - $used);
            return response()->json([
                'message' => 'This topic\'s 50 MB notes limit is full. Delete a note to free up space.',
                'used_bytes' => $used, 'cap_bytes' => self::CAP_BYTES, 'remaining_bytes' => $remaining,
            ], 422);
        }

        $path = $file->store("notes/{$user->id}/" . ($data['topic_id'] ?? 'topic'), 'local');

        $note = $user->notes()->create([
            'topic_id'          => $data['topic_id'] ?? null,
            'topic_name'        => $data['topic_name'],
            'title'             => ($data['title'] ?? null) ?: $file->getClientOriginalName(),
            'original_filename' => $file->getClientOriginalName(),
            'mime'              => $file->getClientMimeType(),
            'kind'              => 'text',
            'size_bytes'        => $size,
            'disk'              => 'local',
            'path'              => $path,
            'status'            => 'processing',
        ]);

        // Synchronous for the MVP (extraction is local; one cheap LLM summarise).
        $this->notes->process($note);

        return response()->json(['note' => $note->fresh()], 201);
    }

    /** GET /tutor/notes/{note} — full note incl. extracted text. */
    public function show(Request $request, TopicNote $note)
    {
        $this->authorizeNote($request, $note);
        return response()->json(['note' => $note]);
    }

    /** DELETE /tutor/notes/{note} — remove the file, row + its flashcards. */
    public function destroy(Request $request, TopicNote $note)
    {
        $this->authorizeNote($request, $note);

        try { Storage::disk($note->disk)->delete($note->path); } catch (\Throwable) { /* ignore */ }
        $request->user()->flashcards()
            ->where('source_type', 'note')->where('source_id', $note->id)->delete();
        $note->delete();

        return response()->json(['deleted' => true]);
    }

    /* ----------------------------------------------------------------- */

    protected function scopeQuery(Request $request)
    {
        $q = $request->user()->notes();
        if ($request->filled('topic_id')) {
            return $q->where('topic_id', $request->integer('topic_id'));
        }
        return $q->where('topic_name', (string) $request->query('topic_name'));
    }

    protected function authorizeNote(Request $request, TopicNote $note): void
    {
        abort_unless($note->user_id === $request->user()->id, 403, 'Not your note.');
    }
}
