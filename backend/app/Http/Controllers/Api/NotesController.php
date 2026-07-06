<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NoteInsight;
use App\Models\TopicNote;
use App\Services\CurriculumResolver;
use App\Services\EventTracker;
use App\Services\GamificationService;
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
        protected GamificationService $gamify,
    ) {}

    /**
     * POST /tutor/notes/auto-scope — Zero-friction "Smart Drop" (spec §4.1, §5.2).
     * Upload a file with NO scope selection: the AI reads it, auto-detects the
     * subject/chapter/topic, audits it for mistakes, stores it, and returns an
     * Auto-Confirm card payload (+ XP/badge rewards). Low-confidence results are
     * flagged so the UI can offer a manual pick.
     */
    public function autoScope(Request $request)
    {
        $request->validate([
            'file' => ['required', 'file', 'max:51200',
                'mimes:pdf,doc,docx,txt,md,csv,xls,xlsx,png,jpg,jpeg,webp,gif,bmp,tiff'],
        ]);
        $user = $request->user();
        $file = $request->file('file');
        $size = $file->getSize();

        // 1) Extract text.
        $extract = $this->notes->extract($file);
        if (! empty($extract['error'])) {
            return response()->json(['message' => $extract['error']], 422);
        }
        $text = trim($extract['text'] ?? '');
        if ($text === '') {
            return response()->json([
                'message' => "We couldn't read any text from this — try a clearer, well-lit photo. 📸",
            ], 422);
        }

        // 2) AI inspect: auto-scope + audit + flashcard candidates. The PDF's
        //    embedded-image count (from PyMuPDF) is fed in so the inspector can
        //    reliably detect diagram-heavy chapters.
        $imagesCount = (int) ($extract['meta']['images_count'] ?? 0);
        $insight = $this->notes->inspect($user, $text, $imagesCount);
        $confidence = (float) ($insight['confidence_score'] ?? 0);
        // A PDF with embedded images is a diagram even if the LLM missed it.
        $diagramsFound = (bool) ($insight['diagrams_found'] ?? false) || $imagesCount > 0;

        // 3) Map the detected names back to curriculum ids.
        $r = $this->resolver->resolve(
            $user,
            $this->cleanName($insight['detected_subject'] ?? null),
            $this->cleanName($insight['detected_chapter'] ?? null),
            $this->cleanName($insight['detected_topic'] ?? null),
            null,
        );
        $scope = $r['topic_id'] ? 'topic' : ($r['chapter_id'] ? 'chapter' : 'subject');

        // 4) Per-subject cap (50 MB).
        $ids = ['subject_id' => $r['subject_id'], 'topic_name' => $r['topic_name']];
        $used = (int) $this->subjectUsageQuery($request, $ids)->sum('size_bytes');
        if ($used + $size > self::CAP_BYTES) {
            return response()->json([
                'message' => 'This subject\'s 50 MB notes limit is full. Delete a note to free up space.',
                'used_bytes' => $used, 'cap_bytes' => self::CAP_BYTES,
            ], 422);
        }

        // 5) Store + process the note (summary, embeddings, flashcards).
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
            'is_primary'        => false,
            'title'             => $file->getClientOriginalName(),
            'original_filename' => $file->getClientOriginalName(),
            'mime'              => $file->getClientMimeType(),
            'kind'              => $extract['kind'] ?? 'text',
            'size_bytes'        => $size,
            'disk'              => 'local',
            'path'              => $path,
            'extracted_text'    => $text,
            'meta'              => ['extract' => $extract['meta'] ?? [], 'auto_scoped' => true],
            'status'            => 'processing',
        ]);
        $this->notes->process($note);
        $note = $note->fresh();

        // 6) Persist the inspector output.
        $corrections = array_values(array_filter((array) ($insight['corrections'] ?? []), 'is_array'));
        NoteInsight::create([
            'note_id'          => $note->id,
            'extracted_text'   => mb_substr($text, 0, 20000),
            'key_terms'        => array_values(array_filter((array) ($insight['core_keywords'] ?? []), 'is_string')),
            'corrections'      => $corrections,
            'confidence_score' => max(0, min(1, $confidence)),
            'diagrams_found'   => $diagramsFound,
            'formula_count'    => (int) ($insight['formula_count'] ?? 0),
        ]);

        // 7) Gamify: award upload XP (+ first-note bonus / badges inside the engine).
        $reward = $this->gamify->award($user, 'upload_note', ['topic' => $note->topic_name]);

        if ($note->status === 'ready') {
            $this->events->track(
                $user, EventTracker::NOTE_UPLOAD,
                "Smart-dropped note '{$note->title}'" . ($r['subject_name'] ? " ({$r['subject_name']})" : ''),
                $note->topic_name, $note->topic_id, [],
                ['note_id' => $note->id, 'auto_scoped' => true, 'confidence' => $confidence],
            );
        }

        return response()->json([
            'status'     => 'success',
            'note_id'    => $note->id,
            'confidence' => round($confidence, 2),
            'low_confidence' => $confidence < 0.5,
            'detected'   => [
                'subject_id'   => $r['subject_id'],
                'subject_name' => $r['subject_name'],
                'chapter_id'   => $r['chapter_id'],
                'chapter_name' => $r['chapter_name'],
                'topic_id'     => $r['topic_id'],
                'topic_name'   => $r['topic_name'],
            ],
            'insights'   => [
                'keywords'       => array_values(array_filter((array) ($insight['core_keywords'] ?? []), 'is_string')),
                'formula_count'  => (int) ($insight['formula_count'] ?? 0),
                'diagrams_found' => $diagramsFound,
                'corrections'    => $corrections,
            ],
            'gamification' => $reward,
            'note'       => $note,
        ], 201);
    }

    /** GET /tutor/notes/{note}/flashcards — term/definition cards minted from this note (Play Hub). */
    public function flashcards(Request $request, TopicNote $note)
    {
        $this->authorizeNote($request, $note);
        $cards = $request->user()->flashcards()
            ->where('source_type', 'note')->where('source_id', $note->id)
            ->orderBy('box_level')->orderBy('id')
            ->get(['id', 'front', 'back', 'box_level', 'due_at']);

        return response()->json([
            'note_id'    => $note->id,
            'flashcards' => $cards->map(fn ($c) => [
                'id' => $c->id, 'term' => $c->front, 'definition' => $c->back,
                'box_level' => (int) $c->box_level,
            ]),
        ]);
    }

    /** Trim "Unknown"/empty AI scope values to null so the resolver doesn't match them. */
    protected function cleanName(?string $name): ?string
    {
        $n = trim((string) $name);
        return ($n === '' || strcasecmp($n, 'unknown') === 0) ? null : $n;
    }

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

        // Full cleanup: diagram + anchor nodes, flashcards, rendered assets,
        // Qdrant vectors, the file, and the row — so nothing keeps surfacing in
        // the tutor's retrieval after the note is deleted.
        $this->notes->deleteNote($note);

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
