<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Uploaded study files, kept as persistent per-topic "notes". The
        // extracted text lets the tutor read them when the student attaches one.
        Schema::create('topic_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name')->nullable();
            $table->string('title');
            $table->string('original_filename');
            $table->string('mime')->nullable();
            $table->string('kind')->default('text');         // pdf|doc|sheet|image|text
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->string('disk')->default('local');
            $table->string('path');
            $table->longText('extracted_text')->nullable();
            $table->longText('summary')->nullable();
            $table->string('status')->default('processing');  // processing|ready|failed
            $table->json('meta')->nullable();                 // flashcards, pages, error...
            $table->timestamps();
            $table->index(['user_id', 'topic_id']);
            $table->index(['user_id', 'topic_name']);
        });

        // Day / Week / Month / Exam study plans built from notes + gaps + mastery.
        Schema::create('study_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name')->nullable();
            $table->string('horizon')->default('week');       // day|week|month|exam
            $table->date('exam_date')->nullable();
            $table->string('title');
            $table->string('status')->default('active');      // active|archived
            $table->json('meta')->nullable();                 // summary, focus concepts
            $table->timestamps();
            $table->index(['user_id', 'topic_id', 'status']);
        });

        Schema::create('study_plan_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('study_plan_id')->constrained()->cascadeOnDelete();
            $table->date('scheduled_for')->nullable();
            $table->unsignedInteger('day_index')->default(0);
            $table->string('title');
            $table->text('detail')->nullable();
            $table->string('concept')->nullable();
            $table->string('kind')->default('learn');         // learn|practice|revise|assess
            $table->unsignedInteger('estimated_minutes')->default(20);
            $table->string('status')->default('todo');        // todo|done
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });

        // Spaced-repetition flashcards (SM-2), sourced from notes and mistakes.
        Schema::create('flashcards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name')->nullable();
            $table->string('source_type')->default('note');   // note|mistake|manual
            $table->unsignedBigInteger('source_id')->nullable();
            $table->text('front');
            $table->text('back');
            $table->float('ease')->default(2.5);
            $table->unsignedInteger('interval_days')->default(0);
            $table->unsignedInteger('repetitions')->default(0);
            $table->timestamp('due_at')->nullable();
            $table->timestamp('last_reviewed_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'topic_name', 'due_at']);
        });

        // Mistake Notebook: every wrong answer, collected for review + re-teaching.
        Schema::create('mistakes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name')->nullable();
            $table->string('concept')->nullable();
            $table->text('question');
            $table->text('student_answer')->nullable();
            $table->text('correct_answer')->nullable();
            $table->text('explanation')->nullable();
            $table->string('source')->default('assessment');  // assessment|quiz|chat
            $table->unsignedBigInteger('source_id')->nullable();
            $table->boolean('resolved')->default(false);
            $table->timestamps();
            $table->index(['user_id', 'topic_name', 'resolved']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mistakes');
        Schema::dropIfExists('flashcards');
        Schema::dropIfExists('study_plan_tasks');
        Schema::dropIfExists('study_plans');
        Schema::dropIfExists('topic_notes');
    }
};
