<?php

return [
    // Base URL of the Python AI service (owns all LLM/RAG work).
    'url' => env('AI_SERVICE_URL', 'http://ai-service:8001'),

    // Shared secret sent as `Authorization: Bearer <key>`.
    'key' => env('AI_SERVICE_KEY'),

    // Generous default: free/slow models + 429 retries can take 1-2 minutes
    // for structured generation (assessments). Keep above the AI service's
    // LLM_TIMEOUT so Laravel doesn't abandon a call that will still succeed.
    'timeout' => env('AI_SERVICE_TIMEOUT', 180),
];
