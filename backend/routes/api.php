<?php

use App\Http\Controllers\Api\AdminContentController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AdminCurriculumController;
use App\Http\Controllers\Api\AdminGapController;
use App\Http\Controllers\Api\AdminUsageController;
use App\Http\Controllers\Api\AssessmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CurriculumController;
use App\Http\Controllers\Api\FlashcardController;
use App\Http\Controllers\Api\LearnerProfileController;
use App\Http\Controllers\Api\LearningPlanController;
use App\Http\Controllers\Api\FigureController;
use App\Http\Controllers\Api\MistakeController;
use App\Http\Controllers\Api\GamificationController;
use App\Http\Controllers\Api\NotesController;
use App\Http\Controllers\Api\ParentController;
use App\Http\Controllers\Api\PlannerController;
use App\Http\Controllers\Api\ProgressController;
use App\Http\Controllers\Api\ReminderController;
use App\Http\Controllers\Api\TelemetryController;
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
    Route::post('/me/avatar', [AuthController::class, 'uploadAvatar']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // --- Curriculum (read for any authed user) ---
    Route::get('/curriculum', [CurriculumController::class, 'index']);

    // --- Student features ---
    Route::middleware('role:student')->group(function () {
        // Topic-wise AI tutor chat
        Route::get('/tutor/sessions', [TutorController::class, 'sessions']);
        Route::post('/tutor/sessions', [TutorController::class, 'startSession']);
        Route::get('/tutor/sessions/{session}', [TutorController::class, 'show']);
        Route::patch('/tutor/sessions/{session}', [TutorController::class, 'update']);   // rename
        Route::get('/tutor/sessions/{session}/mind', [TutorController::class, 'mind']);  // "shows its mind" panel
        // Durable storybook progress: log gate attempts / continue clicks, and re-hydrate on load.
        Route::post('/tutor/sessions/{session}/progress-log', [TutorController::class, 'logProgress']);
        Route::get('/tutor/sessions/{session}/progress-state', [TutorController::class, 'getProgressState']);
        // Snap-a-doubt: photo -> OCR text (client then sends it as a message)
        Route::post('/tutor/snap', [TutorController::class, 'snap'])
            ->middleware('token.gate:snap');
        // AI-triggering routes pass the token gate (quota check + 402 upsell)
        // BEFORE the AI call; real usage is metered after via TokenMeter.
        Route::post('/tutor/sessions/{session}/send', [TutorController::class, 'send'])
            ->middleware('token.gate:chat');
        Route::post('/tutor/sessions/{session}/stream', [TutorController::class, 'stream'])
            ->middleware('token.gate:chat');
        Route::post('/tutor/sessions/{session}/regenerate', [TutorController::class, 'regenerate'])
            ->middleware('token.gate:chat');
        Route::post('/tutor/messages/{message}/feedback', [TutorController::class, 'feedback']);

        // Mini-assessment + gap detection
        Route::get('/assessments/readiness', [AssessmentController::class, 'readiness']); // soft learning-gate
        Route::post('/assessments/generate', [AssessmentController::class, 'generate'])
            ->middleware('token.gate:assess_gen');
        Route::post('/assessments/{assessment}/submit', [AssessmentController::class, 'submit'])
            ->middleware('token.gate:gap');
        Route::get('/assessments/history', [AssessmentController::class, 'history']);

        // Learning plans (light next-steps)
        Route::get('/plans', [LearningPlanController::class, 'index']);
        Route::post('/plans/generate', [LearningPlanController::class, 'generate'])
            ->middleware('token.gate:plan');
        Route::patch('/plans/items/{item}/toggle', [LearningPlanController::class, 'toggleItem']);

        // Study notes: upload files (pdf/doc/sheet/image/text) kept per topic.
        Route::get('/tutor/notes', [NotesController::class, 'index']);
        Route::post('/tutor/notes', [NotesController::class, 'store'])
            ->middleware('token.gate:notes');
        // Zero-friction "Smart Drop": AI auto-scopes + audits the upload.
        Route::post('/tutor/notes/auto-scope', [NotesController::class, 'autoScope'])
            ->middleware('token.gate:notes');
        Route::get('/tutor/notes/{note}', [NotesController::class, 'show']);
        Route::get('/tutor/notes/{note}/flashcards', [NotesController::class, 'flashcards']);
        Route::delete('/tutor/notes/{note}', [NotesController::class, 'destroy']);

        // Gamification (XP / level / streak / badges) for the Quest flow.
        Route::get('/tutor/me/gamification', [GamificationController::class, 'stats']);
        Route::post('/tutor/quest/reward', [GamificationController::class, 'reward']);

        // Universal (Dual-Engine) Gamification — spec §8 (Junior + Senior).
        Route::prefix('gamification')->group(function () {
            Route::get('/profile', [GamificationController::class, 'profile']);
            Route::post('/claim-reward', [GamificationController::class, 'claimReward']);
            Route::get('/stickers', [GamificationController::class, 'stickers']);
            Route::post('/stickers/place', [GamificationController::class, 'placeSticker']);
            Route::post('/companion/interact', [GamificationController::class, 'companionInteract']);
            Route::post('/shield', [GamificationController::class, 'buyShield']);
        });

        // Textbook diagrams: figures ingested from an uploaded book (page images
        // the chat shows beside the lesson) + ingest progress for the upload UI.
        Route::get('/tutor/figures', [FigureController::class, 'index']);
        Route::get('/tutor/figures/{noteId}/{page}/image', [FigureController::class, 'image'])
            ->whereNumber('noteId')->whereNumber('page');
        Route::get('/tutor/textbooks/{note}/status', [FigureController::class, 'status']);

        // Day/Week/Month/Exam planner (notes + gaps + mastery + exam countdown)
        Route::get('/tutor/planner', [PlannerController::class, 'index']);
        Route::post('/tutor/planner/generate', [PlannerController::class, 'generate'])
            ->middleware('token.gate:plan');
        Route::post('/tutor/planner/{plan}/replan', [PlannerController::class, 'replan'])
            ->middleware('token.gate:plan');
        Route::patch('/tutor/planner/tasks/{task}/toggle', [PlannerController::class, 'toggleTask']);
        // A cleared in-chat Progress Gate auto-ticks the matching plan task.
        Route::post('/tutor/planner/cover', [PlannerController::class, 'cover']);
        Route::delete('/tutor/planner/{plan}', [PlannerController::class, 'destroy']);

        // Spaced-repetition flashcards (from notes + mistakes)
        Route::get('/tutor/flashcards', [FlashcardController::class, 'index']);
        Route::get('/tutor/flashcards/due', [FlashcardController::class, 'due']);
        Route::post('/tutor/flashcards/{card}/review', [FlashcardController::class, 'review']);

        // Mistake Notebook (auto-collected from wrong assessment answers)
        Route::get('/tutor/mistakes', [MistakeController::class, 'index']);
        Route::patch('/tutor/mistakes/{mistake}/resolve', [MistakeController::class, 'resolve']);

        // In-app Plan Reminders (today/tomorrow/overdue/exam countdown + next focus)
        Route::get('/tutor/reminders', [ReminderController::class, 'index']);

        // Learner profile / "current stage" dashboard + behavioural telemetry
        Route::get('/tutor/profile', [LearnerProfileController::class, 'show']);
        Route::post('/tutor/telemetry', [TelemetryController::class, 'store']);

        // Progress snapshot + credit meter
        Route::get('/progress', [ProgressController::class, 'summary']);
        Route::get('/usage', [UsageController::class, 'me']);
    });

    // --- Parent features ---
    Route::middleware('role:parent')->prefix('parent')->group(function () {
        Route::get('/children', [ParentController::class, 'children']);
        Route::get('/children/{child}/report', [ParentController::class, 'childReport']);
        Route::get('/children/{child}/usage', [UsageController::class, 'child']);
        Route::get('/children/{child}/gaps', [ParentController::class, 'childGaps']);
        Route::post('/children', [ParentController::class, 'addChild']);
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

        // --- Gap analytics (cohort weak spots, students at risk) ---
        Route::get('/gaps', [AdminGapController::class, 'overview']);

        // --- AI usage & billing (raw tokens + ₹ visible only here) ---
        Route::get('/usage', [AdminUsageController::class, 'overview']);
        Route::get('/users/{user}/usage', [AdminUsageController::class, 'userLedger']);
        Route::patch('/users/{user}/plan', [AdminUsageController::class, 'setUserPlan']);
        Route::post('/users/{user}/grant-credits', [AdminUsageController::class, 'grantCredits']);
        Route::get('/plans', [AdminUsageController::class, 'plans']);
        Route::patch('/plans/{plan}', [AdminUsageController::class, 'updatePlan']);
        Route::get('/model-rates', [AdminUsageController::class, 'modelRates']);
        Route::post('/model-rates', [AdminUsageController::class, 'storeModelRate']);

        // --- Curriculum content (RAG knowledge base) ---
        Route::get('/topics/{topic}/content', [AdminContentController::class, 'index']);
        Route::post('/topics/{topic}/content', [AdminContentController::class, 'store']);
        Route::patch('/content/{chunk}', [AdminContentController::class, 'update']);
        Route::delete('/content/{chunk}', [AdminContentController::class, 'destroy']);
        Route::post('/topics/{topic}/reindex', [AdminContentController::class, 'reindexTopic']);
        Route::post('/rag/reindex', [AdminContentController::class, 'reindexAll']);

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
