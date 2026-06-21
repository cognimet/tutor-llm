<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Client for the Python AI service.
 *
 * Drop-in replacement for GeminiService: exposes the same text()/json()/stream()
 * interface so TutorService is unchanged, but every call now goes through the
 * single AI service (Laravel never calls the LLM directly). Each response
 * carries token `usage`, captured in $lastUsage so the metering layer can
 * record real cost per call.
 */
class AiClient
{
    protected string $url;
    protected ?string $key;
    protected int $timeout;

    /** Token usage from the most recent call: ['model','prompt_tokens','completion_tokens','total_tokens','mock']. */
    public array $lastUsage = [];

    public function __construct()
    {
        $this->url     = rtrim(config('ai_service.url'), '/');
        $this->key     = config('ai_service.key');
        $this->timeout = (int) config('ai_service.timeout', 60);
    }

    /** The AI service reports whether it is running in mock mode via /health. */
    public function isMock(): bool
    {
        try {
            $r = Http::timeout(5)->get("{$this->url}/health");
            return (bool) ($r->json('mock') ?? false);
        } catch (\Throwable) {
            return true; // if the service is unreachable, behave as mock/degraded
        }
    }

    /**
     * @param ?string $topic  when set, the AI service injects RAG curriculum
     *                        context for that topic before generating.
     */
    /**
     * @param ?array $usage  out-param: receives THIS call's token usage. Prefer
     *                       it over the shared {@see $lastUsage} property, which
     *                       is unsafe under concurrent (async) request handling.
     */
    public function text(string $system, string $user, ?string $topic = null, ?string $action = null, ?int $studentId = null, ?int $subjectId = null, ?array &$usage = null): string
    {
        $data = $this->post('/ai/text', array_filter([
            'system' => $system, 'user' => $user, 'topic' => $topic, 'action' => $action,
            'student_id' => $studentId, 'subject_id' => $subjectId,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data, $usage);
        return (string) ($data['text'] ?? '');
    }

    /** @param ?array $usage  out-param: this call's token usage (see text()). */
    public function json(string $system, string $user, array $fallback = [], ?string $topic = null, ?string $action = null, ?int $studentId = null, ?int $subjectId = null, ?array &$usage = null): array
    {
        $data = $this->post('/ai/json', array_filter([
            'system' => $system, 'user' => $user, 'fallback' => empty($fallback) ? (object) $fallback : $fallback, 'topic' => $topic, 'action' => $action,
            'student_id' => $studentId, 'subject_id' => $subjectId,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data, $usage);
        $out = $data['data'] ?? $fallback;
        return is_array($out) ? $out : $fallback;
    }

    /** OCR a problem photo (snap-a-doubt). Returns the extracted text ('' on failure). */
    public function ocr(string $imageBase64, string $languages = 'eng+hin'): string
    {
        $data = $this->post('/ai/ocr', [
            'image_base64' => $imageBase64,
            'languages' => $languages,
        ]);
        $this->captureUsage($data);
        return (string) ($data['text'] ?? '');
    }

    /**
     * Stream tutor text. Reads the AI service's SSE stream and invokes $onDelta
     * per chunk. Returns the full accumulated text ('' if nothing streamed).
     */
    /** @param ?array $usage  out-param: this call's token usage (see text()). */
    public function stream(string $system, string $user, callable $onDelta, ?string $topic = null, ?int $studentId = null, ?int $subjectId = null, ?array &$usage = null): string
    {
        $full = '';
        try {
            $response = Http::timeout($this->timeout)
                ->withHeaders($this->headers())
                ->withOptions(['stream' => true])
                ->post("{$this->url}/ai/stream", array_filter([
                    'system' => $system, 'user' => $user, 'topic' => $topic,
                    'student_id' => $studentId, 'subject_id' => $subjectId,
                ], fn ($v) => $v !== null));

            if (! $response->successful()) {
                Log::warning('AI stream error', ['status' => $response->status()]);
                return '';
            }

            $body = $response->toPsrResponse()->getBody();
            $buffer = '';
            while (! $body->eof()) {
                $buffer .= $body->read(8192);
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = rtrim(substr($buffer, 0, $pos), "\r");
                    $buffer = substr($buffer, $pos + 1);
                    if (! str_starts_with($line, 'data:')) {
                        continue;
                    }
                    $payload = json_decode(trim(substr($line, 5)), true);
                    if (! is_array($payload)) {
                        continue;
                    }
                    if (isset($payload['delta']) && $payload['delta'] !== '') {
                        $full .= $payload['delta'];
                        $onDelta($payload['delta']);
                    }
                    if (! empty($payload['done']) && isset($payload['usage'])) {
                        $this->lastUsage = $payload['usage'] ?? [];
                        $usage = $this->lastUsage;
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('AI stream failed', ['error' => $e->getMessage()]);
        }
        return $full;
    }

    /* ---- role endpoints (richer PRD features; available to new callers) ---- */

    /** Call a role endpoint directly, e.g. roleCall('/ai/gap/analyze', [...]). */
    public function roleCall(string $path, array $payload): array
    {
        $data = $this->post($path, $payload);
        $this->captureUsage($data);
        return $data;
    }

    /**
     * Extract plain text from an uploaded study file (pdf/docx/xlsx/txt/image).
     * Returns ['text','kind','meta','error']; `error` holds the service's detail
     * message on an unsupported/unreadable file (so the UI can be specific).
     */
    public function extract(string $filename, ?string $mime, string $contentBase64): array
    {
        try {
            $r = Http::timeout($this->timeout)
                ->withHeaders($this->headers())
                ->post("{$this->url}/ai/extract", [
                    'filename' => $filename, 'mime' => $mime, 'content_base64' => $contentBase64,
                ]);

            if ($r->successful()) {
                $data = $r->json() ?? [];
                $this->captureUsage($data);
                return [
                    'text' => (string) ($data['text'] ?? ''),
                    'kind' => (string) ($data['kind'] ?? 'text'),
                    'meta' => is_array($data['meta'] ?? null) ? $data['meta'] : [],
                    'error' => null,
                ];
            }

            $detail = $r->json('detail') ?: 'Could not read this file.';
            Log::warning('AI extract error', ['status' => $r->status(), 'file' => $filename]);
            return ['text' => '', 'kind' => 'text', 'meta' => [], 'error' => $detail];
        } catch (\Throwable $e) {
            Log::error('AI extract failed', ['error' => $e->getMessage()]);
            return ['text' => '', 'kind' => 'text', 'meta' => [], 'error' => 'The extraction service is unavailable.'];
        }
    }

    /**
     * Check an uploaded document's content belongs to the chosen scope.
     * @return array{match:bool,detected:?string,confidence:float,reason:string}
     *         Defaults to match=true when the service is unavailable (never block on failure).
     */
    public function validateNoteScope(string $text, string $scope, array $names): array
    {
        $data = $this->roleCall('/ai/notes/validate-scope', [
            'text' => mb_substr($text, 0, 6000), 'scope' => $scope,
            'subject' => $names['subject'] ?? null,
            'chapter' => $names['chapter'] ?? null,
            'topic' => $names['topic'] ?? null,
        ]);
        return [
            'match'      => (bool) ($data['match'] ?? true),
            'detected'   => $data['detected'] ?? null,
            'confidence' => (float) ($data['confidence'] ?? 0),
            'reason'     => (string) ($data['reason'] ?? ''),
        ];
    }

    /**
     * Summarise a student's notes -> {summary, flashcards, chunks_indexed}.
     * When $noteId is given, the AI service also chunks + embeds the note into
     * the Qdrant `documents` collection and links it in the graph for RAG.
     */
    public function notesIngest(int $studentId, string $text, ?string $topic = null,
                                ?int $noteId = null, ?string $title = null, array $scope = []): array
    {
        $data = $this->post('/ai/notes/ingest', array_filter([
            'student_id' => $studentId, 'text' => $text, 'topic' => $topic,
            'note_id' => $noteId, 'title' => $title,
            'subject_id' => $scope['subject_id'] ?? null,
            'chapter_id' => $scope['chapter_id'] ?? null,
            'topic_id' => $scope['topic_id'] ?? null,
            'is_primary' => $scope['is_primary'] ?? null,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data);
        return [
            'summary' => (string) ($data['summary'] ?? ''),
            'flashcards' => is_array($data['flashcards'] ?? null) ? $data['flashcards'] : [],
            'chunks_indexed' => (int) ($data['chunks_indexed'] ?? 0),
        ];
    }

    /**
     * Validate generated questions against the topic's curriculum (RAG).
     * @return int[]  0-based indices (into $questions) to KEEP. Falls back to
     *               all indices if the service is unavailable/returns nothing.
     */
    public function validateAssessment(string $topic, array $questions): array
    {
        $data = $this->roleCall('/ai/assessment/validate', [
            'topic' => $topic, 'questions' => array_values($questions),
        ]);
        $keep = $data['keep'] ?? null;
        if (! is_array($keep)) {
            return array_keys(array_values($questions)); // service down -> keep all
        }
        return array_values(array_filter(array_map('intval', $keep),
            fn ($i) => $i >= 0 && $i < count($questions)));
    }

    /** Build a dated study schedule -> {title, summary, tasks:[...]}. */
    public function studySchedule(array $payload): array
    {
        $data = $this->post('/ai/study/schedule', $payload);
        $this->captureUsage($data);
        return [
            'title' => (string) ($data['title'] ?? 'Your study plan'),
            'summary' => (string) ($data['summary'] ?? ''),
            'tasks' => is_array($data['tasks'] ?? null) ? $data['tasks'] : [],
        ];
    }

    /* ----------------------- Textbook diagram ingest ----------------------- */

    /**
     * Start (or resume) ingesting a big textbook PDF: the AI service rasterises
     * every page, reads it with the vision model, and embeds each diagram as a
     * retrievable FIGURE. $relPath is relative to the shared storage volume.
     */
    public function startTextbookIngest(int $noteId, string $relPath, int $userId, array $scope = []): array
    {
        return $this->post('/ai/pdf/ingest', array_filter([
            'note_id' => $noteId, 'rel_path' => $relPath, 'user_id' => $userId,
            'subject_id' => $scope['subject_id'] ?? null,
            'subject' => $scope['subject'] ?? null,
            'topic' => $scope['topic'] ?? null,
            'topic_id' => $scope['topic_id'] ?? null,
            'is_primary' => $scope['is_primary'] ?? null,
        ], fn ($v) => $v !== null));
    }

    /** Progress for a textbook ingest: {state,total,done,figures,blank,failed,...}. */
    public function textbookIngestStatus(int $noteId): array
    {
        return $this->get("/ai/pdf/ingest/{$noteId}");
    }

    /** Textbook figures relevant to a topic/subject (for the in-chat strip). */
    public function figures(int $userId, ?int $subjectId = null, ?string $topic = null, int $k = 12): array
    {
        $data = $this->get('/ai/figures', array_filter([
            'user_id' => $userId, 'subject_id' => $subjectId, 'topic' => $topic, 'k' => $k,
        ], fn ($v) => $v !== null));
        return is_array($data['figures'] ?? null) ? $data['figures'] : [];
    }

    /* ----------------------- RAG / curriculum indexing --------------------- */

    /** Ensure the vector collection exists. */
    public function ensureCollection(): array
    {
        return $this->post('/ai/embed/ensure', []);
    }

    /**
     * Embed + upsert curriculum chunks.
     * @param array $points  [['id'=>int,'topic'=>string,'type'=>string,'body'=>string], ...]
     * @return int  number indexed
     */
    public function index(array $points): int
    {
        $data = $this->post('/ai/embed/index', ['points' => array_values($points)]);
        return (int) ($data['indexed'] ?? 0);
    }

    /** Remove all chunks for a topic (before re-indexing it). */
    public function deleteTopic(string $topic): void
    {
        $this->post('/ai/embed/delete-topic', ['topic' => $topic]);
    }

    /* ----------------------------- internals ------------------------------- */

    protected function post(string $path, array $payload): array
    {
        try {
            $r = Http::timeout($this->timeout)
                ->withHeaders($this->headers())
                ->post("{$this->url}{$path}", $payload);

            if ($r->successful()) {
                return $r->json() ?? [];
            }
            Log::warning('AI service error', ['path' => $path, 'status' => $r->status()]);
        } catch (\Throwable $e) {
            Log::error('AI service request failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
        return [];
    }

    protected function get(string $path, array $query = []): array
    {
        try {
            $r = Http::timeout($this->timeout)
                ->withHeaders($this->headers())
                ->get("{$this->url}{$path}", $query);

            if ($r->successful()) {
                return $r->json() ?? [];
            }
            Log::warning('AI service error', ['path' => $path, 'status' => $r->status()]);
        } catch (\Throwable $e) {
            Log::error('AI service request failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
        return [];
    }

    protected function headers(): array
    {
        return $this->key ? ['Authorization' => "Bearer {$this->key}"] : [];
    }

    /**
     * Record a call's token usage. Sets the shared {@see $lastUsage} (kept for
     * existing callers) and, when given, the per-call $usage out-param — which
     * is race-free because it lives on the caller's stack frame.
     */
    protected function captureUsage(array $data, ?array &$usage = null): void
    {
        if (isset($data['usage']) && is_array($data['usage'])) {
            $this->lastUsage = $data['usage'];
            $usage = $data['usage'];
        }
    }
}
