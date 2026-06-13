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
    public function text(string $system, string $user, ?string $topic = null, ?string $action = null): string
    {
        $data = $this->post('/ai/text', array_filter([
            'system' => $system, 'user' => $user, 'topic' => $topic, 'action' => $action,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data);
        return (string) ($data['text'] ?? '');
    }

    public function json(string $system, string $user, array $fallback = [], ?string $topic = null, ?string $action = null): array
    {
        $data = $this->post('/ai/json', array_filter([
            'system' => $system, 'user' => $user, 'fallback' => $fallback, 'topic' => $topic, 'action' => $action,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data);
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
    public function stream(string $system, string $user, callable $onDelta, ?string $topic = null): string
    {
        $full = '';
        try {
            $response = Http::timeout($this->timeout)
                ->withHeaders($this->headers())
                ->withOptions(['stream' => true])
                ->post("{$this->url}/ai/stream", array_filter([
                    'system' => $system, 'user' => $user, 'topic' => $topic,
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

    /** Summarise a student's notes -> {summary, flashcards:[{front,back}]}. */
    public function notesIngest(int $studentId, string $text, ?string $topic = null): array
    {
        $data = $this->post('/ai/notes/ingest', array_filter([
            'student_id' => $studentId, 'text' => $text, 'topic' => $topic,
        ], fn ($v) => $v !== null));
        $this->captureUsage($data);
        return [
            'summary' => (string) ($data['summary'] ?? ''),
            'flashcards' => is_array($data['flashcards'] ?? null) ? $data['flashcards'] : [],
        ];
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

    protected function headers(): array
    {
        return $this->key ? ['Authorization' => "Bearer {$this->key}"] : [];
    }

    protected function captureUsage(array $data): void
    {
        if (isset($data['usage']) && is_array($data['usage'])) {
            $this->lastUsage = $data['usage'];
        }
    }
}
