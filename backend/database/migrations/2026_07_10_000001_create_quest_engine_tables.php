<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The LearnQuest adaptive engine, mapped onto this app's curriculum.
 *
 * LearnQuest models a curriculum as a graph of `Skill` nodes. Here the canonical
 * skill node is the existing `topics` row — so the four engines attach to the
 * curriculum the app already owns rather than a parallel taxonomy:
 *
 *   skill_graph      -> topic_prerequisites   (must-know-before edges)
 *   knowledge_model  -> skill_masteries       (BKT P(mastered) per student/topic)
 *   ability (IRT)    -> ability_estimates     (theta per student/subject)
 *   game_generator   -> game_instances        (validated template + content payload)
 *   play/assessment  -> evidence_events       (append-only; the analytics goldmine)
 *
 * Everything is additive. A curriculum with no prerequisite edges degrades to a
 * flat quest map where every topic is immediately available, and a student with
 * no rows reads as the zero state, so existing data needs no backfill.
 */
return new class extends Migration
{
    public function up(): void
    {
        // --- Engine 1: the prerequisite graph over topics ("must-know-before"). ---
        Schema::create('topic_prerequisites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('topic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('prerequisite_topic_id')->constrained('topics')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['topic_id', 'prerequisite_topic_id'], 'uq_topic_prereq');
            $table->index('prerequisite_topic_id');
        });

        // Topics gain the skill metadata LearnQuest's taxonomy carried.
        Schema::table('topics', function (Blueprint $table) {
            // Preferred game mechanic; null = pick heuristically at generate time.
            $table->string('mechanic')->nullable()->after('slug');
            $table->string('standard_code')->nullable()->after('mechanic'); // CCSS / NCERT code
            $table->string('bloom_level')->default('apply')->after('standard_code');
        });

        // --- Engine 2: generated, validated game instances (cached per skill+difficulty). ---
        Schema::create('game_instances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('topic_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('topic_name');
            $table->foreignId('subject_id')->nullable()->constrained()->nullOnDelete();
            $table->string('mechanic');
            $table->unsignedTinyInteger('difficulty')->default(3); // 1..5
            $table->string('title');
            $table->json('items');                       // [{prompt, answer, distractors, hint, params}]
            $table->boolean('validated')->default(false); // never served unless true
            $table->unsignedBigInteger('seed')->nullable();
            $table->timestamps();
            $table->index(['topic_id', 'difficulty']);
            $table->index(['topic_name', 'difficulty']);
        });

        // --- Engine 3: BKT mastery state per (student, topic). ---
        Schema::create('skill_masteries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->constrained()->cascadeOnDelete();
            $table->float('p_mastered')->default(0.10);   // BKT prior p_L0
            $table->unsignedInteger('observations')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'topic_id'], 'uq_user_skill_mastery');
            $table->index(['user_id', 'p_mastered']);
        });

        // --- Engine 3b: IRT ability (theta) per (student, subject). ---
        Schema::create('ability_estimates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('subject_id')->constrained()->cascadeOnDelete();
            $table->float('theta')->default(0.0);         // logit scale, clamped [-4, 4]
            $table->unsignedInteger('observations')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'subject_id'], 'uq_user_subject_ability');
        });

        // --- The evidence stream. Append-only: never updated, never deleted. ---
        // Keeping this immutable is what lets us recompute mastery when the model
        // improves (blueprint §7). Both engines are derived views of this table.
        Schema::create('evidence_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name');
            $table->foreignId('subject_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('game_instance_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('item_index')->default(0);
            $table->boolean('correct');
            $table->unsignedInteger('time_ms')->default(0);
            $table->unsignedTinyInteger('hints_used')->default(0);
            $table->unsignedTinyInteger('difficulty')->default(3);
            $table->timestamp('created_at')->useCurrent();
            $table->index(['user_id', 'topic_id']);
            $table->index(['user_id', 'created_at']);
        });

        // Play is a first-class practice signal alongside assessments, so the
        // existing per-topic progress blend can see it (TopicProgressService).
        Schema::table('topic_progress', function (Blueprint $table) {
            $table->unsignedInteger('games_played')->default(0)->after('assessments_taken');
            $table->unsignedTinyInteger('best_game_pct')->default(0)->after('best_score_pct');
        });
    }

    public function down(): void
    {
        Schema::table('topic_progress', function (Blueprint $table) {
            $table->dropColumn(['games_played', 'best_game_pct']);
        });
        Schema::dropIfExists('evidence_events');
        Schema::dropIfExists('ability_estimates');
        Schema::dropIfExists('skill_masteries');
        Schema::dropIfExists('game_instances');
        Schema::table('topics', function (Blueprint $table) {
            $table->dropColumn(['mechanic', 'standard_code', 'bloom_level']);
        });
        Schema::dropIfExists('topic_prerequisites');
    }
};
