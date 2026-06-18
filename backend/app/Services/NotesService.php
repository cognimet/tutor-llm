<?php

namespace App\Services;

use App\Models\TopicNote;
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
