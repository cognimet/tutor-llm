<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin client over the Google Gemini generateContent API.
 *
 * Two entry points:
 *   - text(): free-form text generation (used by the tutor chat).
 *   - json(): forces a JSON response and decodes it (assessments, gaps, plans).
 *
 * If no API key is configured (or GEMINI_MOCK=true) it returns deterministic
 * mock data so the entire product flow works without external calls.
 */
class GeminiService
{
    protected ?string $apiKey;
    protected string $model;
    protected string $baseUrl;
    protected int $timeout;
    protected bool $mock;

    public function __construct()
    {
        $this->apiKey  = config('gemini.api_key');
        $this->model   = config('gemini.model');
        $this->baseUrl = rtrim(config('gemini.base_url'), '/');
        $this->timeout = (int) config('gemini.timeout', 45);
        $this->mock    = (bool) config('gemini.mock') || empty($this->apiKey);
    }

    public function isMock(): bool
    {
        return $this->mock;
    }

    /** Generate plain text from a system + user prompt. */
    public function text(string $system, string $user): string
    {
        if ($this->mock) {
            return MockAI::text($system, $user);
        }

        $data = $this->call($system, $user, jsonMode: false);
        return $this->extractText($data) ?? '';
    }

    /** Generate and decode a JSON object/array from a prompt. */
    public function json(string $system, string $user, array $fallback = []): array
    {
        if ($this->mock) {
            return MockAI::json($system, $user, $fallback);
        }

        $data = $this->call($system, $user, jsonMode: true);
        $text = $this->extractText($data) ?? '';
        $decoded = $this->decodeJson($text);

        return $decoded ?? $fallback;
    }

    /**
     * Stream plain text generation token-by-token.
     *
     * $onDelta is invoked with each incremental text chunk as it arrives.
     * Returns the full accumulated text. Returns '' if the upstream request
     * never produced any content (the caller can then fall back to text()).
     */
    public function stream(string $system, string $user, callable $onDelta): string
    {
        if ($this->mock) {
            $full = MockAI::text($system, $user);
            // Simulate streaming so the UX is identical without an API key.
            foreach (preg_split('//u', $full, -1, PREG_SPLIT_NO_EMPTY) as $i => $char) {
                $onDelta($char);
                if ($i % 3 === 0) {
                    usleep(6000);
                }
            }
            return $full;
        }

        $url = "{$this->baseUrl}/models/{$this->model}:streamGenerateContent?alt=sse";

        $payload = [
            'systemInstruction' => ['parts' => [['text' => $system]]],
            'contents' => [[
                'role' => 'user',
                'parts' => [['text' => $user]],
            ]],
            'generationConfig' => ['temperature' => 0.7, 'maxOutputTokens' => 2048],
        ];

        $full = '';

        try {
            $response = Http::timeout($this->timeout)
                ->withHeaders(['x-goog-api-key' => $this->apiKey])
                ->withOptions(['stream' => true])
                ->post($url, $payload);

            if (! $response->successful()) {
                Log::warning('Gemini stream error', ['status' => $response->status()]);
                return '';
            }

            $body = $response->toPsrResponse()->getBody();
            $buffer = '';

            while (! $body->eof()) {
                $buffer .= $body->read(8192);

                // SSE frames are newline-delimited "data: {...}" lines.
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = rtrim(substr($buffer, 0, $pos), "\r");
                    $buffer = substr($buffer, $pos + 1);

                    if (! str_starts_with($line, 'data:')) {
                        continue;
                    }

                    $json = trim(substr($line, 5));
                    if ($json === '' || $json === '[DONE]') {
                        continue;
                    }

                    $data = json_decode($json, true);
                    $delta = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
                    if ($delta !== '') {
                        $full .= $delta;
                        $onDelta($delta);
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('Gemini stream failed', ['error' => $e->getMessage()]);
            // Return whatever streamed so far; caller handles empty.
        }

        return $full;
    }

    /* ------------------------------------------------------------------ */

    protected function call(string $system, string $user, bool $jsonMode): array
    {
        $url = "{$this->baseUrl}/models/{$this->model}:generateContent";

        $generationConfig = ['temperature' => 0.7, 'maxOutputTokens' => 2048];
        if ($jsonMode) {
            $generationConfig['responseMimeType'] = 'application/json';
            $generationConfig['temperature'] = 0.4;
        }

        $payload = [
            'systemInstruction' => ['parts' => [['text' => $system]]],
            'contents' => [[
                'role' => 'user',
                'parts' => [['text' => $user]],
            ]],
            'generationConfig' => $generationConfig,
        ];

        // Gemini frequently returns transient 503 ("model overloaded") and 429
        // (rate limit) responses. Retry those (and connection errors) with a
        // short linear backoff so a single blip doesn't surface as a failed
        // chat reply or "could not generate an assessment".
        $transient = [429, 500, 502, 503, 504];
        $maxAttempts = 3;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $response = Http::timeout($this->timeout)
                    ->withHeaders(['x-goog-api-key' => $this->apiKey])
                    ->post($url, $payload);

                if ($response->successful()) {
                    return $response->json() ?? [];
                }

                if (in_array($response->status(), $transient, true) && $attempt < $maxAttempts) {
                    usleep($attempt * 800 * 1000); // 0.8s, 1.6s
                    continue;
                }

                Log::warning('Gemini API error', [
                    'status' => $response->status(),
                    'attempt' => $attempt,
                    'body' => $response->body(),
                ]);
                return [];
            } catch (\Throwable $e) {
                if ($attempt < $maxAttempts) {
                    usleep($attempt * 800 * 1000);
                    continue;
                }
                Log::error('Gemini request failed', ['error' => $e->getMessage()]);
                return [];
            }
        }

        return [];
    }

    protected function extractText(array $data): ?string
    {
        return $data['candidates'][0]['content']['parts'][0]['text'] ?? null;
    }

    protected function decodeJson(string $text): ?array
    {
        $text = trim($text);
        // Strip ```json ... ``` fences if present.
        $text = preg_replace('/^```(?:json)?|```$/m', '', $text);
        $text = trim($text);

        $decoded = json_decode($text, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // Try to grab the first {...} or [...] block.
        if (preg_match('/(\{.*\}|\[.*\])/s', $text, $m)) {
            $decoded = json_decode($m[1], true);
            return is_array($decoded) ? $decoded : null;
        }

        return null;
    }
}
