<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TopicNote;
use App\Services\CurriculumResolver;
use App\Services\EventTracker;
use App\Services\NotesService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Student study notes. A note can be scoped at the SUBJECT, CHAPTER or TOPIC
 * level — subject/chapter notes apply to every topic underneath them, so the
 * tutor reads them across the whole subject. Notes are the priority source in
 * sessions; an optional ★ "primary / exam-critical" flag weights one highest.
 * Capped at 50 MB per subject.
 */
class NotesController extends Controller
{
    /** Per-subject upload budget (bytes). */
    public const CAP_BYTES = 52428800; // 50 MB

    public function __construct(
        protected NotesService $notes,
        protected EventTracker $events,
        protected CurriculumResolver $resolver,
    ) {}

    /** GET /tutor/notes — notes relevant to the given context (topic + its chapter + its subject) + usage. */
    public function index(Request $request)
    {
        $ids = $this->contextIds($request);
        $notes = $this->relevantQuery($request, $ids)
            ->latest()
            ->get(['id', 'title', 'original_filename', 'mime', 'kind', 'size_bytes', 'status',
                   'scope', 'subject_name', 'chapter_name', 'topic_name', 'is_primary', 'summary', 'meta', 'created_at']);

        return response()->json([
            'notes' => $notes,
            'usage' => [
                'used_bytes' => (int) $this->subjectUsageQuery($request, $ids)->sum('size_bytes'),
                'cap_bytes'  => self::CAP_BYTES,
            ],
        ]);
    }

    /** POST /tutor/notes — multipart upload; stores + processes the file at the chosen scope. */
    public function store(Request $request)
    {
        $data = $request->validate([
            'file'         => ['required', 'file', 'max:51200', // 50 MB (KB units)
                'mimes:pdf,doc,docx,txt,md,csv,xls,xlsx,png,jpg,jpeg,webp,gif,bmp,tiff'],
            'scope'        => ['nullable', 'in:subject,chapter,topic'],
            'subject_name' => ['nullable', 'string', 'max:160'],
            'chapter_name' => ['nullable', 'string', 'max:160'],
            'topic_id'     => ['nullable', 'exists:topics,id'],
            'topic_name'   => ['nullable', 'string', 'max:160', 'required_if:scope,topic'],
            'is_primary'   => ['nullable', 'boolean'],
            'force'        => ['nullable', 'boolean'],   // skip the off-syllabus warning
            'title'        => ['nullable', 'string', 'max:160'],
        ]);

        $user = $request->user();
        $scope = $data['scope'] ?? 'topic';

        // Resolve canonical curriculum ids from the names the client has.
        $r = $this->resolver->resolve(
            $user, $data['subject_name'] ?? null, $data['chapter_name'] ?? null,
            $data['topic_name'] ?? null, $data['topic_id'] ?? null,
        );

        $file = $request->file('file');
        $size = $file->getSize();

        // Enforce the 50 MB-per-subject cap.
        $ids = ['subject_id' => $r['subject_id'], 'topic_name' => $r['topic_name']];
        $used = (int) $this->subjectUsageQuery($request, $ids)->sum('size_bytes');
        if ($used + $size > self::CAP_BYTES) {
            $remaining = max(0, self::CAP_BYTES - $used);
            return response()->json([
                'message' => 'This subject\'s 50 MB notes limit is full. Delete a note to free up space.',
                'used_bytes' => $used, 'cap_bytes' => self::CAP_BYTES, 'remaining_bytes' => $remaining,
            ], 422);
        }

        // Extract the text up-front so we can VALIDATE the document belongs to
        // the chosen subject/chapter/topic before storing it as a note.
        $extract = $this->notes->extract($file);
        if (! empty($extract['error'])) {
            return response()->json(['message' => $extract['error']], 422);
        }
        $text = trim($extract['text'] ?? '');

        $scopeLabel = $scope === 'subject' ? $r['subject_name']
            : ($scope === 'chapter' ? $r['chapter_name'] : $r['topic_name']);

        if ($text !== '' && ! $request->boolean('force')) {
            $v = $this->notes->validateScope($text, $scope, [
                'subject' => $r['subject_name'], 'chapter' => $r['chapter_name'], 'topic' => $r['topic_name'],
            ]);
            if (! $v['match'] && $v['confidence'] >= 0.6) {
                $detected = $v['detected'] ?: 'a different subject';
                return response()->json([
                    'message'    => "This document looks like {$detected} — not {$scopeLabel}. "
                        . 'Upload it anyway, or pick the right subject/chapter/topic.',
                    'validation' => [
                        'off_scope' => true, 'detected' => $v['detected'],
                        'reason' => $v['reason'], 'scope' => $scope, 'scope_label' => $scopeLabel,
                    ],
                ], 422);
            }
        }

        $bucket = $r['subject_id'] ? "sub-{$r['subject_id']}" : ($r['topic_id'] ? "topic-{$r['topic_id']}" : 'misc');
        $path = $file->store("notes/{$user->id}/{$bucket}", 'local');

        $note = $user->notes()->create([
            'scope'             => $scope,
            'subject_id'        => $r['subject_id'],
            'subject_name'      => $r['subject_name'],
            'chapter_id'        => $scope === 'subject' ? null : $r['chapter_id'],
            'chapter_name'      => $scope === 'subject' ? null : $r['chapter_name'],
            'topic_id'          => $scope === 'topic' ? $r['topic_id'] : null,
            'topic_name'        => $scope === 'topic' ? $r['topic_name'] : null,
            'is_primary'        => (bool) ($data['is_primary'] ?? false),
            'title'             => ($data['title'] ?? null) ?: $file->getClientOriginalName(),
            'original_filename' => $file->getClientOriginalName(),
            'mime'              => $file->getClientMimeType(),
            'kind'              => $extract['kind'] ?? 'text',
            'size_bytes'        => $size,
            'disk'              => 'local',
            'path'              => $path,
            'extracted_text'    => $text,   // reused by process() — no re-extraction
            'meta'              => ['extract' => $extract['meta'] ?? []],
            'status'            => 'processing',
        ]);

        // Synchronous for the MVP (one cheap LLM summarise; text already extracted).
        $this->notes->process($note);
        $note = $note->fresh();

        if ($note->status === 'ready') {
            $label = $note->scope === 'subject' ? $note->subject_name
                : ($note->scope === 'chapter' ? $note->chapter_name : $note->topic_name);
            $this->events->track(
                $user, EventTracker::NOTE_UPLOAD,
                "Uploaded {$note->scope} note '{$note->title}'" . ($label ? " for {$label}" : '')
                . ($note->summary ? ': ' . mb_substr($note->summary, 0, 400) : ''),
                $note->topic_name, $note->topic_id, [],
                ['note_id' => $note->id, 'kind' => $note->kind, 'scope' => $note->scope, 'primary' => $note->is_primary],
            );
        }

        return response()->json(['note' => $note], 201);
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

    /** Resolve the curriculum ids for the request's scope context. */
    protected function contextIds(Request $request): array
    {
        return $this->resolver->resolve(
            $request->user(),
            $request->query('subject_name'),
            $request->query('chapter_name'),
            $request->query('topic_name'),
            $request->filled('topic_id') ? $request->integer('topic_id') : null,
        );
    }

    /** Notes that APPLY to the context: the topic's own + its chapter's + its subject's. */
    protected function relevantQuery(Request $request, array $ids)
    {
        return $request->user()->notes()->where(function ($w) use ($ids) {
            $any = false;
            if (! empty($ids['topic_id']))   { $w->orWhere('topic_id', $ids['topic_id']);     $any = true; }
            if (! empty($ids['chapter_id'])) { $w->orWhere('chapter_id', $ids['chapter_id']); $any = true; }
            if (! empty($ids['subject_id'])) { $w->orWhere('subject_id', $ids['subject_id']); $any = true; }
            // Legacy / unresolved fallback: match by topic name.
            if (! $any && ! empty($ids['topic_name'])) { $w->orWhere('topic_name', $ids['topic_name']); }
            if (! $any && empty($ids['topic_name']))    { $w->whereRaw('1=0'); } // no context -> nothing
        });
    }

    /** Usage counts toward the per-subject cap (falls back to topic for unresolved). */
    protected function subjectUsageQuery(Request $request, array $ids)
    {
        $q = $request->user()->notes();
        if (! empty($ids['subject_id'])) {
            return $q->where('subject_id', $ids['subject_id']);
        }
        return $q->where('topic_name', $ids['topic_name'] ?? '');
    }

    protected function authorizeNote(Request $request, TopicNote $note): void
    {
        abort_unless($note->user_id === $request->user()->id, 403, 'Not your note.');
    }
}
