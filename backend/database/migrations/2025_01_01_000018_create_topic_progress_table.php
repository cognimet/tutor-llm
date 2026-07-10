<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-topic learning progress + completion for a student. A single row rolls up
 * the three signals a topic's journey is made of — Learn (real tutor turns),
 * Practice (assessments taken), and Mastery (concept EWMA) — into a 0–100
 * percent and a Not started / In progress / Completed status.
 *
 * Keyed by topic_id when the topic is a curriculum node, else by topic_name
 * (note-grounded / whole-subject quests carry no id), mirroring the app-wide
 * `topic_id ?? topic_name` convention.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('topic_progress', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name');
            $table->string('subject_name')->nullable();
            $table->string('chapter_name')->nullable();

            // not_started | in_progress | completed (kept a plain string so we
            // never need a CHECK-constraint migration to add a state later).
            $table->string('status')->default('not_started');
            $table->unsignedTinyInteger('percent')->default(0);

            // Denormalised component signals, so the UI can render the "what's
            // left" checklist + bars without recomputing anything.
            $table->unsignedInteger('chat_turns')->default(0);
            $table->unsignedInteger('assessments_taken')->default(0);
            $table->unsignedTinyInteger('best_score_pct')->default(0);
            $table->unsignedTinyInteger('mastery_pct')->default(0);

            $table->timestamp('completed_at')->nullable();
            $table->timestamp('last_activity_at')->nullable();
            $table->timestamps();

            // One row per (student, curriculum topic). topic_id null rows are
            // deduped by name at the service layer.
            $table->unique(['user_id', 'topic_id']);
            $table->index(['user_id', 'topic_name']);
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('topic_progress');
    }
};
