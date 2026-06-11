<?php

use App\Http\Controllers\Api\AdminBillingController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AdminCurriculumController;
use App\Http\Controllers\Api\AssessmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CurriculumController;
use App\Http\Controllers\Api\LearningPlanController;
use App\Http\Controllers\Api\ParentController;
use App\Http\Controllers\Api\ProgressController;
use App\Http\Controllers\Api\TutorController;
use App\Http\Controllers\Api\UsageController;
use Illuminate\Support\Facades\Route;

/*
| API routes. Prefixed with /api by Laravel. Auth via Sanctum tokens.
*/

// --- Public ---
Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::get('/curriculum/options', [CurriculumController::class, 'options']); // for the signup selector

Route::middleware('auth:sanctum')->group(function () {
    // --- Account (all roles) ---
    Route::get('/me', [AuthController::class, 'me']);
    Route::put('/me', [AuthController::class, 'updateProfile']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // --- Curriculum (read for any authed user) ---
    Route::get('/curriculum', [CurriculumController::class, 'index']);

    // --- Student features ---
    Route::middleware('role:student')->group(function () {
        // Topic-wise AI tutor chat
        Route::get('/tutor/sessions', [TutorController::class, 'sessions']);
        Route::post('/tutor/sessions', [TutorController::class, 'startSession']);
        Route::get('/tutor/sessions/{session}', [TutorController::class, 'show']);
        Route::get('/tutor/sessions/{session}/mind', [TutorController::class, 'mind']);   // "shows its mind" panel
        Route::patch('/tutor/sessions/{session}/mode', [TutorController::class, 'setMode']);
        Route::post('/tutor/sessions/{session}/send', [TutorController::class, 'send'])->middleware('tokens:chat');
        Route::post('/tutor/sessions/{session}/stream', [TutorController::class, 'stream'])->middleware('tokens:chat');
        Route::post('/tutor/sessions/{session}/regenerate', [TutorController::class, 'regenerate'])->middleware('tokens:chat');
        Route::post('/tutor/messages/{message}/feedback', [TutorController::class, 'feedback']);

        // Mini-assessment + gap detection
        Route::post('/assessments/generate', [AssessmentController::class, 'generate'])->middleware('tokens:assess_gen');
        Route::post('/assessments/{assessment}/submit', [AssessmentController::class, 'submit'])->middleware('tokens:grade');
        Route::get('/assessments/history', [AssessmentController::class, 'history']);

        // Learning plans (light next-steps)
        Route::get('/plans', [LearningPlanController::class, 'index']);
        Route::post('/plans/generate', [LearningPlanController::class, 'generate'])->middleware('tokens:plan');
        Route::patch('/plans/items/{item}/toggle', [LearningPlanController::class, 'toggleItem']);

        // Progress snapshot
        Route::get('/progress', [ProgressController::class, 'summary']);

        // Credit meter (credits, never raw tokens — token spec §7)
        Route::get('/usage', [UsageController::class, 'summary']);
    });

    // --- Parent features ---
    Route::middleware('role:parent')->prefix('parent')->group(function () {
        Route::get('/children', [ParentController::class, 'children']);
        Route::get('/children/{child}/report', [ParentController::class, 'childReport']);
        Route::get('/children/{child}/usage', [ParentController::class, 'childUsage']);
        Route::post('/children/link', [ParentController::class, 'linkChild']);
    });

    // --- Admin features ---
    Route::middleware('role:admin')->prefix('admin')->group(function () {
        Route::get('/stats', [AdminController::class, 'stats']);
        Route::get('/users', [AdminController::class, 'users']);
        Route::get('/users/{user}', [AdminController::class, 'show']);
        Route::get('/users/{user}/progress', [AdminController::class, 'progress']);
        Route::post('/users/{user}/link-child', [AdminController::class, 'linkChild']);
        Route::delete('/users/{parent}/unlink-child/{student}', [AdminController::class, 'unlinkChild']);
        Route::patch('/users/{user}/active', [AdminController::class, 'setActive']);
        Route::patch('/users/{user}', [AdminController::class, 'updateUser']);

        // --- AI usage & billing (token spec §6) ---
        Route::get('/usage', [AdminBillingController::class, 'usage']);
        Route::get('/plans', [AdminBillingController::class, 'plans']);
        Route::post('/plans', [AdminBillingController::class, 'storePlan']);
        Route::patch('/plans/{plan}', [AdminBillingController::class, 'updatePlan']);
        Route::get('/model-rates', [AdminBillingController::class, 'modelRates']);
        Route::post('/model-rates', [AdminBillingController::class, 'storeModelRate']);
        Route::post('/users/{user}/grant-credits', [AdminBillingController::class, 'grantCredits']);

        // --- Curriculum management (Stage → Track → Level → Subject → Chapter → Topic) ---
        Route::prefix('curriculum')->group(function () {
            Route::get('/tree', [AdminCurriculumController::class, 'tree']);

            Route::post('/stages', [AdminCurriculumController::class, 'storeStage']);
            Route::patch('/stages/{stage}', [AdminCurriculumController::class, 'updateStage']);
            Route::delete('/stages/{stage}', [AdminCurriculumController::class, 'destroyStage']);

            Route::post('/tracks', [AdminCurriculumController::class, 'storeTrack']);
            Route::patch('/tracks/{track}', [AdminCurriculumController::class, 'updateTrack']);
            Route::delete('/tracks/{track}', [AdminCurriculumController::class, 'destroyTrack']);

            Route::post('/levels', [AdminCurriculumController::class, 'storeLevel']);
            Route::patch('/levels/{level}', [AdminCurriculumController::class, 'updateLevel']);
            Route::delete('/levels/{level}', [AdminCurriculumController::class, 'destroyLevel']);

            Route::post('/subjects', [AdminCurriculumController::class, 'storeSubject']);
            Route::patch('/subjects/{subject}', [AdminCurriculumController::class, 'updateSubject']);
            Route::delete('/subjects/{subject}', [AdminCurriculumController::class, 'destroySubject']);

            Route::post('/chapters', [AdminCurriculumController::class, 'storeChapter']);
            Route::patch('/chapters/{chapter}', [AdminCurriculumController::class, 'updateChapter']);
            Route::delete('/chapters/{chapter}', [AdminCurriculumController::class, 'destroyChapter']);

            Route::post('/topics', [AdminCurriculumController::class, 'storeTopic']);
            Route::patch('/topics/{topic}', [AdminCurriculumController::class, 'updateTopic']);
            Route::delete('/topics/{topic}', [AdminCurriculumController::class, 'destroyTopic']);
        });
    });
});
