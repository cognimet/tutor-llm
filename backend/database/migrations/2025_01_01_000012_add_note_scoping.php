<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Study from my notes": let a student's uploaded notes be scoped at the
 * SUBJECT, CHAPTER or TOPIC level (not just per-topic), and let study plans be
 * built for a whole subject from those notes. The student's own notes are the
 * priority source in sessions / assessments; curriculum supplements them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('topic_notes', function (Blueprint $table) {
            $table->string('scope')->default('topic')->after('topic_name');   // subject|chapter|topic
            $table->foreignId('subject_id')->nullable()->after('scope')->constrained()->nullOnDelete();
            $table->string('subject_name')->nullable()->after('subject_id');
            $table->foreignId('chapter_id')->nullable()->after('subject_name')->constrained()->nullOnDelete();
            $table->string('chapter_name')->nullable()->after('chapter_id');
            $table->boolean('is_primary')->default(false)->after('chapter_name'); // ★ exam-critical: weighted highest
            $table->index(['user_id', 'subject_id']);
            $table->index(['user_id', 'chapter_id']);
        });

        Schema::table('study_plans', function (Blueprint $table) {
            $table->string('scope')->default('topic')->after('topic_name');   // subject|topic
            $table->foreignId('subject_id')->nullable()->after('scope')->constrained()->nullOnDelete();
            $table->string('subject_name')->nullable()->after('subject_id');
            $table->boolean('from_notes')->default(false)->after('subject_name'); // notes-driven plan
            $table->index(['user_id', 'subject_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('topic_notes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('subject_id');
            $table->dropConstrainedForeignId('chapter_id');
            $table->dropColumn(['scope', 'subject_name', 'chapter_name', 'is_primary']);
        });
        Schema::table('study_plans', function (Blueprint $table) {
            $table->dropConstrainedForeignId('subject_id');
            $table->dropColumn(['scope', 'subject_name', 'from_notes']);
        });
    }
};
