<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The tutor's "mind" (Chat Page Spec §6, master prompt C1):
 *  - student_memory: durable facts the tutor learns about the student
 *  - concept_masteries: EWMA mastery per (student, topic, concept)
 *  - misconceptions: caught live in chat / assessments, tracked open -> resolved
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('student_memory', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key');                 // learning_style, struggles_with, likes, ...
            $table->text('value');
            $table->timestamps();
            $table->unique(['user_id', 'key']);
        });

        Schema::create('concept_masteries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('topic_name');
            $table->string('concept');
            $table->float('score')->default(0);              // 0..1 EWMA (alpha ~0.4)
            $table->unsignedInteger('confidence')->default(0); // observation count
            $table->timestamp('last_seen_at')->nullable();   // retention decay later
            $table->timestamps();
            $table->unique(['user_id', 'topic_name', 'concept']);
        });

        Schema::create('misconceptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('chat_session_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name');
            $table->string('description', 300);
            $table->string('status')->default('open');       // open | resolved
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
        Schema::dropIfExists('student_memory');
    }
};
