<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Study from my notes" revamp (Class 6–10 gamified Quest flow).
 *
 * Adds the data layer for: student gamification (XP / level / streak / badges),
 * AI note-inspector insights (auto-scope confidence, extracted keywords, flagged
 * corrections), and a Leitner box on existing flashcards for the Play Hub.
 *
 * Adapted to this codebase's real tables: notes live in `topic_notes` and there
 * is already a spaced-repetition `flashcards` table, so we extend those rather
 * than create the spec's generic `notes` / duplicate `student_flashcards`.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Gamification stats on the student.
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('xp_points')->default(0)->after('avatar');
            $table->unsignedInteger('level')->default(1)->after('xp_points');
            $table->unsignedInteger('current_streak')->default(0)->after('level');
            $table->date('last_active_date')->nullable()->after('current_streak');
        });

        // Unlocked badges (one row per student per badge).
        Schema::create('student_badges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('users')->cascadeOnDelete();
            $table->string('badge_key', 50);                 // note_ninja | perfect_score | night_owl | streak_saver | ...
            $table->timestamp('unlocked_at')->useCurrent();
            $table->timestamps();
            $table->unique(['student_id', 'badge_key']);     // never unlock twice
        });

        // AI note-inspector output: auto-scoping + audit, one row per note.
        Schema::create('note_insights', function (Blueprint $table) {
            $table->id();
            $table->foreignId('note_id')->constrained('topic_notes')->cascadeOnDelete();
            $table->longText('extracted_text')->nullable();
            $table->json('key_terms')->nullable();           // ["voltage","current","circuit"]
            $table->json('corrections')->nullable();         // [{"wrong_text","corrected_text","explanation"}]
            $table->float('confidence_score')->default(0);   // 0..1 auto-scope confidence
            $table->boolean('diagrams_found')->default(false);
            $table->unsignedInteger('formula_count')->default(0);
            $table->timestamps();
            $table->index('note_id');
        });

        // Leitner spacing box for the Play Hub flashcards (alongside the existing
        // SM-2 fields). Box 1 = review often … box 5 = mastered.
        Schema::table('flashcards', function (Blueprint $table) {
            $table->unsignedTinyInteger('box_level')->default(1)->after('repetitions');
        });
    }

    public function down(): void
    {
        Schema::table('flashcards', fn (Blueprint $t) => $t->dropColumn('box_level'));
        Schema::dropIfExists('note_insights');
        Schema::dropIfExists('student_badges');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['xp_points', 'level', 'current_streak', 'last_active_date']);
        });
    }
};
