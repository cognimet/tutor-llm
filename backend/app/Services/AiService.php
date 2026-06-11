<?php

namespace App\Services;

use App\Models\ConceptMastery;
use App\Models\Misconception;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Client for the Python AI service (FastAPI) — the single place all LLM calls
 * live (architecture doc §1: Laravel never calls a model directly when the
 * service is configured). Every response carries `usage` token counts which
 * callers must pass to TokenMeter::meter().
 */
class AiService
{
    protected string $url;
    protected int $timeout;

    public function __construct()
    {
        $this->url = rtrim((string) config('ai.service_url'), '/');
        $this->timeout = (int) config('ai.timeout', 90);
    }

    public function enabled(): bool
    {
        return $this->url !== '';
    }

    /** Student context payload: identity + memory + mastery (spec D9). */
    public function studentContext(User $user, ?string $topic = null): array
    {
        $mastery = [];
        $misconceptions = [];
        if ($topic) {
            $mastery = ConceptMastery::where('user_id', $user->id)
                ->where('topic_name', $topic)
                ->get()
                ->map(fn ($m) => [
                    'concept' => $m->concept,
                    'score' => round($m->score, 2),
                    'confidence' => $m->confidence,
                ])->all();

            $misconceptions = Misconception::where('user_id', $user->id)
                ->where('topic_name', $topic)
                ->where('status', 'open')
                ->pluck('description')->all();
        }

        return [
            'name' => $user->name,
            'curriculum_path' => $user->curriculum_path,
            'board' => $user->board,
            'grade' => $user->grade ? (string) $user->grade : null,
            'language' => $user->language ?? 'en',
            'memory' => array_filter([
                'curriculum' => $user->curriculum_path,
                'preferred_language' => $user->language,
            ]),
            'concept_mastery' => $mastery,
            'open_misconceptions' => $misconceptions,
        ];
    }

    /** Non-streaming tutor turn. Returns [reply, meta, usage] or null on failure. */
    public function chatTurn(array $payload): ?array
    {
        return $this->post('/ai/chat/turn', $payload + ['stream' => false]);
    }

    /**
     * Streaming tutor turn. Proxies the AI service's SSE: invokes $onDelta per
     * text chunk; returns the final [reply, meta, usage] from the `done` event,
     * or null if the stream failed before completing.
     */
    public function chatTurnStream(array $payload, callable $onDelta): ?array
    {
        $final = null;

        try {
            $response = Http::timeout($this->timeout)
                ->withOptions(['stream' => true])
                ->withHeaders(['Accept' => 'text/event-stream'])
                ->post($this->url . '/ai/chat/turn', $payload + ['stream' => true]);

            if (! $response->successful()) {
                Log::warning('AI service stream error', ['status' => $response->status()]);
                return null;
            }

            $body = $response->toPsrResponse()->getBody();
            $buffer = '';
            $event = 'message';

            while (! $body->eof()) {
                $buffer .= $body->read(8192);

                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = rtrim(substr($buffer, 0, $pos), "\r");
                    $buffer = substr($buffer, $pos + 1);

                    if (str_starts_with($line, 'event:')) {
                        $event = trim(substr($line, 6));
                        continue;
                    }
                    if (! str_starts_with($line, 'data:')) {
                        continue;
                    }

                    $data = json_decode(trim(substr($line, 5)), true);
                    if (! is_array($data)) {
                        continue;
                    }

                    if ($event === 'delta' && ($data['text'] ?? '') !== '') {
                        $onDelta($data['text']);
                    } elseif ($event === 'done') {
                        $final = $data;
                    } elseif ($event === 'error') {
                        Log::warning('AI service emitted error', $data);
                        return null;
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('AI service stream failed', ['error' => $e->getMessage()]);
            return null;
        }

        return $final;
    }

    public function generateAssessment(array $payload): ?array
    {
        return $this->post('/ai/assessment/generate', $payload);
    }

    public function gradeAnswers(array $payload): ?array
    {
        return $this->post('/ai/assessment/grade', $payload);
    }

    public function analyzeGaps(array $payload): ?array
    {
        return $this->post('/ai/gap/analyze', $payload);
    }

    public function buildPlan(array $payload): ?array
    {
        return $this->post('/ai/plan/build', $payload);
    }

    public function parentReport(array $payload): ?array
    {
        return $this->post('/ai/report/parent', $payload);
    }

    /* ------------------------------------------------------------------ */

    protected function post(string $path, array $payload): ?array
    {
        try {
            $response = Http::timeout($this->timeout)->post($this->url . $path, $payload);
            if ($response->successful()) {
                return $response->json();
            }
            Log::warning('AI service error', ['path' => $path, 'status' => $response->status()]);
        } catch (\Throwable $e) {
            Log::error('AI service unreachable', ['path' => $path, 'error' => $e->getMessage()]);
        }

        return null;
    }
}
