<?php

return [
    // Base URL of the Python AI service (owns all LLM/RAG work).
    'url' => env('AI_SERVICE_URL', 'http://ai-service:8001'),

    // Shared secret sent as `Authorization: Bearer <key>`.
    'key' => env('AI_SERVICE_KEY'),

    'timeout' => env('AI_SERVICE_TIMEOUT', 60),
];
