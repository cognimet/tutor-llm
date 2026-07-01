<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * High-frequency engagement + integrity telemetry, captured during assessments
 * and lessons. Separate from learning_events (the semantic system-of-record)
 * because these are dense behavioural pings — tab blur/focus, per-question
 * dwell, answer changes, drop-off — aggregated into engagement & integrity
 * scores, never embedded for recall.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('engagement_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('assessment_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('chat_session_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('question_id')->nullable();   // assessment_question id (soft ref)

            // tab_blur | tab_focus | question_view | answer_change | section_time |
            // assessment_start | assessment_submit | drop_off | confidence
            $table->string('event_type', 40);
            $table->unsignedInteger('duration_ms')->nullable();      // dwell / focus-away length
            $table->json('meta')->nullable();                        // {from_idx,to_idx,confidence,section,...}
            $table->timestamp('created_at')->nullable();

            $table->index(['user_id', 'created_at']);
            $table->index(['user_id', 'event_type']);
            $table->index(['assessment_id', 'event_type']);
        });

        // Richer per-answer signals for gap + behaviour analysis.
        Schema::table('assessment_answers', function (Blueprint $table) {
            $table->unsignedInteger('time_spent_ms')->nullable()->after('is_correct');
            $table->unsignedSmallInteger('answer_changes')->default(0)->after('time_spent_ms');
            $table->unsignedTinyInteger('confidence')->nullable()->after('answer_changes'); // 1..5 self-report
        });
    }

    public function down(): void
    {
        Schema::table('assessment_answers', function (Blueprint $table) {
            $table->dropColumn(['time_spent_ms', 'answer_changes', 'confidence']);
        });
        Schema::dropIfExists('engagement_events');
    }
};
