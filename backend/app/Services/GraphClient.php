<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Client for the GraphRAG "AI mind" endpoints on the Python AI service
 * (Neo4j knowledge graph + Qdrant `events`/`documents` vectors).
 *
 * Laravel never talks to Neo4j/Qdrant directly — exactly like AiClient for the
 * LLM. Every call is best-effort: the graph is an enhancement, so a failure is
 * logged and swallowed and never breaks the originating request (the durable
 * copy already lives in Postgres).
 */
class GraphClient
{
    protected string $url;
    protected ?string $key;
    protected int $timeout;

    public function __construct()
    {
        $this->url     = rtrim((string) config('ai_service.url'), '/');
        $this->key     = config('ai_service.key');
        // Graph writes embed + persist; keep a short ceiling so a slow/offline
        // graph can never stall a chat turn or submit.
        $this->timeout = (int) config('ai_service.graph_timeout', 12);
    }

    /** Mirror the curriculum hierarchy into the graph. */
    public function syncCurriculum(array $topics, array $nextPairs = [], array $concepts = []): int
    {
        $data = $this->post('/ai/graph/curriculum/upsert', [
            'topics' => array_values($topics),
            'next_pairs' => array_values($nextPairs),
            'concepts' => array_values($concepts),
        ]);
        return (int) ($data['upserted'] ?? 0);
    }

    /**
     * Record one tracked user action (embeds it + creates the graph :Event).
     * @return array{id:?string,qdrant_id:?string}
     */
    public function recordEvent(array $payload): array
    {
        $data = $this->post('/ai/graph/event', $payload);
        return ['id' => $data['id'] ?? null, 'qdrant_id' => $data['qdrant_id'] ?? null];
    }

    /** Mirror MindService state (mastery, misconceptions, next focus). */
    public function setState(array $payload): void
    {
        $this->post('/ai/graph/state', $payload);
    }

    /** The student's single cross-topic next focused area ([] when none/off). */
    public function focus(int $studentId): array
    {
        $data = $this->get('/ai/graph/focus', ['student_id' => $studentId]);
        return is_array($data['focus'] ?? null) ? $data['focus'] : [];
    }

    public function status(): array
    {
        return $this->get('/ai/graph/status', []);
    }

    /* ----------------------------- internals ----------------------------- */

    protected function post(string $path, array $payload): array
    {
        try {
            $r = Http::timeout($this->timeout)->withHeaders($this->headers())
                ->post("{$this->url}{$path}", $payload);
            if ($r->successful()) {
                return $r->json() ?? [];
            }
            Log::warning('Graph service error', ['path' => $path, 'status' => $r->status()]);
        } catch (\Throwable $e) {
            Log::warning('Graph service request failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
        return [];
    }

    protected function get(string $path, array $query): array
    {
        try {
            $r = Http::timeout($this->timeout)->withHeaders($this->headers())
                ->get("{$this->url}{$path}", $query);
            if ($r->successful()) {
                return $r->json() ?? [];
            }
        } catch (\Throwable $e) {
            Log::warning('Graph service GET failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
        return [];
    }

    protected function headers(): array
    {
        return $this->key ? ['Authorization' => "Bearer {$this->key}"] : [];
    }
}
