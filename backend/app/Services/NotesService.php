<?php

namespace App\Services;

use App\Models\KnowledgeNode;
use App\Models\TopicNote;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Turns an uploaded study file into a usable "note": extract its text (via the
 * AI service), summarise it + mint flashcards, and mark it ready. Runs inline
 * after upload (synchronous for the MVP); safe to move to a queued job later.
 */
class NotesService
{
    public function __construct(
        protected AiClient $ai,
        protected TokenMeter $meter,
    ) {}

    /** Extract plain text from an uploaded file (for up-front scope validation). */
    public function extract(UploadedFile $file): array
    {
        $bytes = @file_get_contents($file->getRealPath());
        if ($bytes === false) {
            return ['text' => '', 'kind' => 'text', 'meta' => [], 'error' => 'The uploaded file could not be read.'];
        }
        return $this->ai->extract($file->getClientOriginalName(), $file->getClientMimeType(), base64_encode($bytes));
    }

    /** Does this document belong to the chosen subject/chapter/topic? (AI check.) */
    public function validateScope(string $text, string $scope, array $names): array
    {
        return $this->ai->validateNoteScope($text, $scope, $names);
    }

    /**
     * Smart Note Inspector + Auto-Scoper (spec §4.1, §4.2, §5.3). Given the
     * extracted note text, the AI maps it to the student's curriculum (subject /
     * chapter / topic with a confidence score), flags conceptual mistakes as
     * friendly "fix-it" corrections, and proposes flashcards — in ONE call.
     *
     * @return array{detected_subject:?string,detected_chapter:?string,detected_topic:?string,
     *               confidence_score:float,core_keywords:array,has_corrections:bool,
     *               corrections:array,flashcard_candidates:array,formula_count:int,diagrams_found:bool}
     */
    public function inspect(User $student, string $text, int $imagesCount = 0): array
    {
        $system =
            "You are an expert CBSE/ICSE teacher analysing a student's study notes or uploaded textbook PDF. "
            . "Perform three operations:\n"
            . "1) SCOPE - Map the document to the correct Subject, Chapter, and Topic using ONLY the provided exact "
            . "curriculum list structure (lowercase name matches, do not invent names). If you match a Chapter, you MUST select the "
            . "most specific Topic inside that chapter from the topics array. Assign a 'confidence_score' from 0.0 to 1.0 (set high >0.8 "
            . "if the text clearly matches the keywords and topics of that chapter, such as Magnets, Magnetic needle, Compasses, etc.).\n"
            . "2) METRICS - Set 'diagrams_found' to true if the text contains graphic indicators like 'Fig.', 'Figure', "
            . "'illustration', 'graph', 'chart', 'image', or visual activity steps, OR if the PDF metadata reports embedded images. "
            . "Count the math/chemical formulas to set 'formula_count'.\n"
            . "3) AUDIT - Locate clear errors, conceptual mistakes, or factual issues in the text, providing encouraging corrections "
            . "for an 11-14 year old (remind them mistakes are part of learning).\n\n"
            . "Return ONLY JSON with these exact keys:\n"
            . "{\n"
            . "  \"detected_subject\": \"string or null\",\n"
            . "  \"detected_chapter\": \"string or null\",\n"
            . "  \"detected_topic\": \"string or null\",\n"
            . "  \"confidence_score\": 0.95,\n"
            . "  \"core_keywords\": [\"keyword1\", \"keyword2\"],\n"
            . "  \"formula_count\": 0,\n"
            . "  \"diagrams_found\": true,\n"
            . "  \"has_corrections\": false,\n"
            . "  \"corrections\": [],\n"
            . "  \"flashcard_candidates\": []\n"
            . "}";

        $pdfMeta = $imagesCount > 0
            ? "\n\nPDF metadata: {$imagesCount} embedded image object(s) were detected in this document."
            : '';

        $user = "Curriculum to scope against:\n" . $this->curriculumOutline($student) . $pdfMeta
            . "\n\nStudent's note text:\n\"\"\"\n" . mb_substr($text, 0, 8000) . "\n\"\"\"\n";

        // Use the dedicated, STRICTLY schema-enforced endpoint so the LLM always
        // returns the exact detected_subject/chapter/topic keys (generic JSON mode
        // would otherwise invent keys like "curriculum"/"SCOPE" on long text and
        // break the mapping → "your notes" fallback).
        $response = $this->ai->roleCall('/ai/notes/inspect', [
            'system' => $system,
            'user'   => $user,
        ]);

        $data = is_array($response['data'] ?? null) ? $response['data'] : [];
        if (! empty($response['usage'])) {
            $this->meter->record($student, 'notes', $response['usage'], ['kind' => 'note_inspect']);
        }

        // Resilience: if the strict endpoint is unreachable (older AI-service
        // image) or returns nothing usable, fall back to the generic JSON path so
        // scoping still degrades gracefully instead of dropping to "your notes".
        if (empty($data) || (empty($data['detected_subject']) && empty($data['detected_chapter']))) {
            $usage = [];
            $fb = $this->ai->json($system, $user, [], null, 'structured', null, null, $usage);
            if (! empty($usage)) {
                $this->meter->record($student, 'notes', $usage, ['kind' => 'note_inspect_fb']);
            }
            if (is_array($fb) && ! empty($fb)) {
                $data = $fb;
            }
        }

        return $data;
    }

    /** Compact "Subject — Chapters — Topics" outline of the student's curriculum, for scoping. */
    protected function curriculumOutline(User $student): string
    {
        // Eager-load the complete tree INCLUDING topics so the inspector can pick
        // the exact topic name to map against (not just the chapter).
        $level = $student->level_id
            ? $student->level()->with('subjects.chapters.topics')->first()
            : null;

        if (! $level) {
            return '(no curriculum configured — infer the subject/chapter/topic from the text)';
        }

        $lines = [];
        foreach ($level->subjects as $subject) {
            $lines[] = "Subject: \"{$subject->name}\"";
            foreach ($subject->chapters as $chapter) {
                $topicNames = $chapter->topics->pluck('name')->map(fn ($t) => "\"{$t}\"")->implode(', ');
                $lines[] = "  Chapter: \"{$chapter->name}\" — Topics: [" . ($topicNames ?: 'none') . "]";
            }
        }

        return implode("\n", $lines) ?: '(no subjects configured)';
    }

    public function process(TopicNote $note): void
    {
        try {
            $meta = $note->meta ?? [];
            // If the caller already extracted the text (e.g. upload-scope
            // validation in the controller), reuse it — no double extraction.
            $text = trim((string) $note->extracted_text);

            if ($text === '') {
                $bytes = Storage::disk($note->disk)->get($note->path);
                if ($bytes === null) {
                    $this->fail($note, 'The uploaded file could not be read.');
                    return;
                }

                // 1) Extract plain text (local parsers / OCR in the AI service).
                $res = $this->ai->extract($note->original_filename, $note->mime, base64_encode($bytes));
                if (! empty($res['error'])) {
                    $this->fail($note, $res['error']);
                    return;
                }

                $text = trim($res['text'] ?? '');
                $note->kind = $res['kind'] ?? $note->kind;
                $note->extracted_text = $text;
                $meta['extract'] = $res['meta'] ?? [];
            }

            if ($text === '') {
                // Stored, but the tutor has nothing to read from it.
                $note->meta = array_merge($meta, ['empty' => true]);
                $note->status = 'ready';
                $note->save();
                return;
            }

            // 2) Summarise + flashcards (one structured LLM call), metered. The
            //    AI service also chunks + embeds the note into Qdrant `documents`
            //    and links it in the graph (note_id), so the tutor can later
            //    retrieve the student's OWN material.
            $ingest = $this->ai->notesIngest($note->user_id, $text, $note->topic_name, $note->id, $note->title, [
                'subject_id' => $note->subject_id,
                'chapter_id' => $note->chapter_id,
                'topic_id'   => $note->topic_id,
                'is_primary' => $note->is_primary,
            ]);
            $this->meter($note, 'notes');

            $note->summary = $ingest['summary'] ?? '';
            $cards = is_array($ingest['flashcards'] ?? null) ? $ingest['flashcards'] : [];
            $meta['flashcards_count'] = count($cards);
            $meta['chunks_indexed'] = (int) ($ingest['chunks_indexed'] ?? 0);

            // 3) Multimodal diagrams: for image/PDF notes, parse hand-drawn
            //    diagrams into knowledge_nodes (UVSS + 3 assets) so the tutor can
            //    reconstruct or show them. Best-effort — never fails the note.
            $meta['diagrams_count'] = $this->ingestDiagrams($note);

            $note->meta = $meta;
            $note->status = 'ready';
            $note->save();

            // 4) Persist flashcards for spaced repetition (due immediately).
            foreach ($cards as $c) {
                $front = trim((string) ($c['front'] ?? ''));
                $back = trim((string) ($c['back'] ?? ''));
                if ($front === '' || $back === '') continue;
                $note->user->flashcards()->create([
                    'topic_id'    => $note->topic_id,
                    'topic_name'  => $note->topic_name,
                    'source_type' => 'note',
                    'source_id'   => $note->id,
                    'front'       => $front,
                    'back'        => $back,
                    'due_at'      => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('note processing failed', ['note' => $note->id, 'error' => $e->getMessage()]);
            $this->fail($note, 'We couldn\'t process this file. Please try a different one.');
        }
    }

    /**
     * Re-run ONLY diagram ingestion for an existing note (Diagram Isolation
     * backfill). Idempotent — diagram + anchor nodes are keyed on deterministic
     * qdrant_ids (updateOrCreate), so this regenerates the isolated assets and
     * anchor text without duplicating rows or touching the note's flashcards.
     * Used by the `diagrams:reingest` command to build isolated cuts for notes
     * uploaded before the upgrade. Returns the number of diagram nodes.
     */
    public function reingestDiagrams(TopicNote $note): int
    {
        return $this->ingestDiagrams($note);
    }

    /**
     * Fully delete a note and EVERYTHING derived from it, so nothing keeps
     * surfacing after deletion: the diagram + anchor-text knowledge_nodes, its
     * flashcards, the rendered diagram assets on the shared volume, its Qdrant
     * vectors (text chunks / diagrams / anchors / figures), the uploaded file,
     * and finally the note row. Each step is best-effort so a single failure
     * never leaves the row half-deleted.
     */
    public function deleteNote(TopicNote $note): void
    {
        $this->purgeNoteData($note->id, $note->user_id);
        try { Storage::disk($note->disk)->delete($note->path); } catch (\Throwable) { /* ignore */ }
        $note->delete();
    }

    /**
     * Purge everything keyed on a note id WITHOUT needing the row (so it also
     * cleans up after a note that was already deleted via the UI, which used to
     * leave diagram nodes + vectors behind).
     */
    public function purgeNoteData(int $noteId, ?int $userId = null): void
    {
        try { KnowledgeNode::where('note_id', $noteId)->delete(); } catch (\Throwable) { /* ignore */ }
        try {
            \App\Models\Flashcard::where('source_type', 'note')->where('source_id', $noteId)->delete();
        } catch (\Throwable) { /* ignore */ }
        try { $this->ai->deleteNoteVectors($noteId, $userId); } catch (\Throwable) { /* ignore */ }
        try {
            \Illuminate\Support\Facades\File::deleteDirectory(storage_path('app/diagrams/' . $noteId));
        } catch (\Throwable) { /* ignore */ }
        $this->clearNoteChats($noteId, $userId);
    }

    /**
     * Clear the chat grounded in a deleted note: a session studying ONLY this
     * note is deleted outright (its messages cascade via the FK), while a
     * session that also uses other notes just has this one detached so it keeps
     * working. Matched by int value so string/int id storage both resolve.
     */
    protected function clearNoteChats(int $noteId, ?int $userId = null): void
    {
        try {
            $q = \App\Models\ChatSession::whereNotNull('selected_note_ids');
            if ($userId) {
                $q->where('user_id', $userId);
            }
            foreach ($q->get() as $session) {
                $ids = array_map('intval', (array) ($session->selected_note_ids ?? []));
                if (! in_array($noteId, $ids, true)) {
                    continue;
                }
                $remaining = array_values(array_filter($ids, fn ($x) => $x !== $noteId));
                if (empty($remaining)) {
                    $session->delete();                                  // messages cascade
                } else {
                    $session->update(['selected_note_ids' => $remaining]);
                }
            }
        } catch (\Throwable) { /* ignore */ }
    }

    /**
     * Parse diagrams out of an image/PDF note and persist them as knowledge_nodes
     * (UVSS schema + confidence + the rendered assets, incl. the isolated cut),
     * then index them for retrieval. Best-effort and idempotent (keyed on the
     * deterministic qdrant_id), so re-processing a note overwrites rather than
     * duplicating. Returns the number of diagram nodes created. Never throws.
     */
    protected function ingestDiagrams(TopicNote $note): int
    {
        // Only image/PDF uploads can contain hand-drawn diagrams; and the VLM is
        // the classifier, so skip entirely when the AI service is mocked/keyless.
        if (! in_array($note->kind, ['image', 'pdf'], true) || $this->ai->isMock()) {
            return 0;
        }

        try {
            // Read the file through Laravel's own disk (resolves the correct
            // root, incl. Laravel 11's storage/app/private) and hand the bytes to
            // the AI service as base64 — no shared-volume path assumptions.
            $bytes = Storage::disk($note->disk)->get($note->path);
            if ($bytes === null) {
                Log::warning('diagram ingest: could not read note file', ['note' => $note->id, 'path' => $note->path]);
                return 0;
            }

            $res = $this->ai->ingestDiagrams($note->user_id, base64_encode($bytes), $note->id, $note->mime, [
                'subject_id' => $note->subject_id,
                'chapter_id' => $note->chapter_id,
                'topic_id'   => $note->topic_id,
                'topic'      => $note->topic_name,
                'is_primary' => $note->is_primary,
            ]);
            // The VLM cost of parsing diagrams is metered like any notes work.
            $this->meter($note, 'notes');

            $descriptors = $res['nodes'] ?? [];
            if (empty($descriptors)) {
                return 0;
            }

            $indexPayload = [];
            $pageAnchors  = [];   // page => ['diagram' => node, 'text' => surrounding prose]
            foreach ($descriptors as $d) {
                $schema = is_array($d['diagram_schema'] ?? null) ? $d['diagram_schema'] : null;
                $node = KnowledgeNode::updateOrCreate(
                    ['qdrant_id' => $d['qdrant_id'] ?? (string) \Illuminate\Support\Str::uuid()],
                    [
                        'nodeable_type'         => TopicNote::class,
                        'nodeable_id'           => $note->id,
                        'type'                  => 'diagram',
                        'title'                 => $d['title'] ?? 'Diagram',
                        'content'               => trim((string) ($d['summary'] ?? '')) ?: ($d['title'] ?? 'Diagram'),
                        'diagram_schema'        => $schema,
                        'uvss_confidence_score' => (float) ($d['confidence'] ?? 0),
                        'original_crop_url'     => $d['original_crop_rel'] ?? null,
                        'cleaned_crop_url'      => $d['cleaned_crop_rel'] ?? null,
                        'normalized_image_url'  => $d['normalized_image_rel'] ?? null,
                        'isolated_image_url'    => $d['isolated_image_rel'] ?? null,
                        'illustrated_image_url' => $d['illustrated_image_rel'] ?? null,
                        'mask_polygon'          => is_array($d['mask_polygon'] ?? null) ? $d['mask_polygon'] : null,
                        'ocr_text'              => (string) ($d['ocr_text'] ?? ''),
                        'labels'                => is_array($d['labels'] ?? null) ? $d['labels'] : [],
                        'user_id'               => $note->user_id,
                        'subject_id'            => $note->subject_id,
                        'chapter_id'            => $note->chapter_id,
                        'topic_id'              => $note->topic_id,
                        'topic_name'            => $note->topic_name,
                        'is_primary'            => $note->is_primary,
                        'note_id'               => $note->id,
                        'page'                  => (int) ($d['page'] ?? 1),
                        'region_index'          => (int) ($d['region_index'] ?? 0),
                        'status'                => 'ready',
                    ],
                );

                $indexPayload[] = [
                    'node_id'              => $node->id,
                    'user_id'              => $note->user_id,
                    'note_id'              => $note->id,
                    'page'                 => (int) ($d['page'] ?? 1),
                    'region_index'         => (int) ($d['region_index'] ?? 0),
                    'title'                => (string) ($d['title'] ?? ''),
                    'summary'              => (string) ($d['summary'] ?? ''),
                    'labels'               => is_array($d['labels'] ?? null) ? $d['labels'] : [],
                    'confidence'           => (float) ($d['confidence'] ?? 0),
                    'has_schema'           => $schema !== null,
                    'ocr_text'             => (string) ($d['ocr_text'] ?? ''),
                    'original_crop_rel'    => $d['original_crop_rel'] ?? null,
                    'cleaned_crop_rel'     => $d['cleaned_crop_rel'] ?? null,
                    'normalized_image_rel' => $d['normalized_image_rel'] ?? null,
                    'isolated_image_rel'   => $d['isolated_image_rel'] ?? null,
                    'subject_id'           => $note->subject_id,
                    'chapter_id'           => $note->chapter_id,
                    'topic_id'             => $note->topic_id,
                    'topic'                => $note->topic_name,
                    'is_primary'           => (bool) $note->is_primary,
                ];

                // The dominant (first-accepted, i.e. largest) diagram on each page
                // claims that page's surrounding prose as its anchor text (§3.1).
                $page = (int) ($d['page'] ?? 1);
                $surrounding = trim((string) ($d['surrounding_text'] ?? ''));
                if (! isset($pageAnchors[$page]) && $surrounding !== '') {
                    $pageAnchors[$page] = ['diagram' => $node, 'text' => $surrounding];
                }
            }

            // The "Anchor" relationship (§3): persist the OCR'd prose that
            // physically surrounds each diagram as TEXT nodes pointing at their
            // diagram, then index them with linked_diagram_id so retrieving the
            // text automatically surfaces the exact diagram it explains.
            $anchorPayload = $this->persistAnchorTexts($note, $pageAnchors);

            // Embed the persisted nodes (now that they have ids) for RAG.
            $this->ai->indexDiagramNodes($indexPayload, $anchorPayload);

            return count($descriptors);
        } catch (\Throwable $e) {
            Log::warning('diagram ingest failed', ['note' => $note->id, 'error' => $e->getMessage()]);
            return 0;
        }
    }

    /**
     * Persist the page-level surrounding prose as `type=text` knowledge_nodes
     * anchored (parent_diagram_id) to the page's dominant diagram, and build the
     * Qdrant anchor payload (Diagram Isolation upgrade §3). Idempotent: chunk
     * ids are deterministic per note+page+chunk. Returns the index payload.
     *
     * @param array<int,array{diagram:KnowledgeNode,text:string}> $pageAnchors
     */
    protected function persistAnchorTexts(TopicNote $note, array $pageAnchors): array
    {
        $payload = [];
        foreach ($pageAnchors as $page => $info) {
            $diagram = $info['diagram'];
            foreach ($this->chunkAnchorText($info['text']) as $i => $chunk) {
                $anchor = KnowledgeNode::updateOrCreate(
                    ['qdrant_id' => \Ramsey\Uuid\Uuid::uuid5(
                        \Ramsey\Uuid\Uuid::NAMESPACE_URL, "anchor:{$note->id}:{$page}:{$i}")->toString()],
                    [
                        'nodeable_type'     => TopicNote::class,
                        'nodeable_id'       => $note->id,
                        'type'              => 'text',
                        'title'             => ($diagram->title ?: 'Diagram') . ' — notes (p.' . $page . ')',
                        'content'           => $chunk,
                        'parent_diagram_id' => $diagram->id,
                        'user_id'           => $note->user_id,
                        'subject_id'        => $note->subject_id,
                        'chapter_id'        => $note->chapter_id,
                        'topic_id'          => $note->topic_id,
                        'topic_name'        => $note->topic_name,
                        'is_primary'        => $note->is_primary,
                        'note_id'           => $note->id,
                        'page'              => $page,
                        'region_index'      => $i,
                        'status'            => 'ready',
                    ],
                );

                $payload[] = [
                    'node_id'           => $anchor->id,
                    'user_id'           => $note->user_id,
                    'note_id'           => $note->id,
                    'page'              => $page,
                    'chunk_index'       => $i,
                    'linked_diagram_id' => $diagram->id,
                    'body'              => $chunk,
                    'subject_id'        => $note->subject_id,
                    'chapter_id'        => $note->chapter_id,
                    'topic_id'          => $note->topic_id,
                    'topic'             => $note->topic_name,
                    'is_primary'        => (bool) $note->is_primary,
                ];
            }
        }

        return $payload;
    }

    /**
     * Split the OCR'd surrounding prose into embedding-sized chunks on paragraph
     * boundaries (~900 chars), preserving the notes' heading/bullet structure.
     *
     * @return list<string>
     */
    protected function chunkAnchorText(string $text, int $size = 900, int $max = 12): array
    {
        $paras = preg_split("/\n{2,}/", trim($text)) ?: [];
        $chunks = [];
        $buf = '';
        foreach ($paras as $p) {
            $p = trim($p);
            if ($p === '') continue;
            if ($buf !== '' && mb_strlen($buf) + mb_strlen($p) + 2 > $size) {
                $chunks[] = $buf;
                $buf = $p;
            } else {
                $buf = $buf === '' ? $p : "{$buf}\n\n{$p}";
            }
            if (count($chunks) >= $max) break;
        }
        if ($buf !== '' && count($chunks) < $max) {
            $chunks[] = $buf;
        }

        // A single oversized paragraph (no blank lines) still gets hard-wrapped.
        $out = [];
        foreach ($chunks as $c) {
            while (mb_strlen($c) > $size * 1.6 && count($out) < $max) {
                $out[] = mb_substr($c, 0, $size);
                $c = mb_substr($c, $size);
            }
            if (count($out) < $max) $out[] = $c;
        }

        return $out;
    }

    protected function fail(TopicNote $note, string $message): void
    {
        $note->status = 'failed';
        $note->meta = array_merge($note->meta ?? [], ['error' => $message]);
        $note->save();
    }

    protected function meter(TopicNote $note, string $action): void
    {
        if (! empty($this->ai->lastUsage)) {
            $this->meter->record($note->user, $action, $this->ai->lastUsage, ['note_id' => $note->id]);
        }
    }
}
