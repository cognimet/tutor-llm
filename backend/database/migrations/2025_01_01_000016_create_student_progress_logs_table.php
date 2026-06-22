<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Durable, per-session record of every interactive checkpoint choice and
 * progressive "continue" click, so the storybook lesson's micro-progress
 * survives refresh / leaving the chat, and feeds adaptive AI + parent telemetry.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('student_progress_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('chat_session_id')->constrained()->cascadeOnDelete();

            // 'read_continue' (progressive-wrapper reveals) or 'quiz_attempt' (Progress Gates).
            $table->string('type');

            // Stable identifier for the specific block (gate:<msg>:<hash> / flow:<msg>:<hash>).
            $table->string('target_id');

            // Quiz result (null for read_continue clicks).
            $table->boolean('is_correct')->nullable();

            // Attempt sequence: 1 = first try, 2 = second try, etc.
            $table->unsignedInteger('attempt_number')->default(1);

            // Rich context: selected index, exact answer string, question text, card index…
            $table->json('metadata')->nullable();

            $table->timestamps();

            // Composite indexes for fast session re-hydration and parent reporting.
            $table->index(['user_id', 'chat_session_id']);
            $table->index(['user_id', 'type', 'target_id']);
            $table->index(['user_id', 'attempt_number', 'is_correct']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('student_progress_logs');
    }
};
