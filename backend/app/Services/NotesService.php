<?php

namespace App\Services;

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
            $note->meta = $meta;
            $note->status = 'ready';
            $note->save();

            // 3) Persist flashcards for spaced repetition (due immediately).
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
