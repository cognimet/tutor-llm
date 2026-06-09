<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'app' => 'Everything AI Tutor API',
    'docs' => '/api',
    'health' => '/up',
]));
