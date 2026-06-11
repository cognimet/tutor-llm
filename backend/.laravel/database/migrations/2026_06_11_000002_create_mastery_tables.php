<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Concept-level mastery + live misconception tracking — the data behind the
 * chat page's "shows its mind" panel (Chat Page Spec §6, master prompt C1).
 */
return new class extends Migration
{
    public function up(): void
    {
        // EWMA mastery per (student, topic, concept). Concepts are the atomic
        // unit of mastery; topics pass only when ALL concepts pass.
        Schema::create('concept_masteries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('topic_name');
            $table->string('concept');
            $table->float('score')->default(0);            // 0..1 EWMA, alpha ~0.4
            $table->unsignedInteger('confidence')->default(0); // observation count
            $table->timestamp('last_seen_at')->nullable(); // drives retention decay
            $table->timestamps();
            $table->unique(['user_id', 'topic_name', 'concept']);
        });

        // Misconceptions caught live in chat or via assessment distractors.
        Schema::create('misconceptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('chat_session_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name');
            $table->string('description');
            $table->enum('status', ['open', 'resolved'])->default('open');
            $table->timestamp('detected_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'topic_name', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('misconceptions');
        Schema::dropIfExists('concept_masteries');
    }
};
