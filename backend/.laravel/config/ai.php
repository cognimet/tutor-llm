<?php

return [
    // Base URL of the Python AI service (FastAPI). Empty = fall back to the
    // legacy direct-Gemini path in TutorService.
    'service_url' => env('AI_SERVICE_URL', ''),

    'timeout' => (int) env('AI_SERVICE_TIMEOUT', 90),
];
