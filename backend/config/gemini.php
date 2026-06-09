<?php

return [
    // Google Gemini API configuration.
    // Set GEMINI_API_KEY in your .env file. NEVER commit a real key.
    'api_key' => env('GEMINI_API_KEY'),

    // Model used for tutoring, assessment generation and gap detection.
    'model' => env('GEMINI_MODEL', 'gemini-2.5-flash'),

    'base_url' => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),

    'timeout' => env('GEMINI_TIMEOUT', 45),

    // When true (or when no API key is present) the app returns deterministic
    // mock responses so the whole flow runs without external calls.
    'mock' => env('GEMINI_MOCK', false),
];
