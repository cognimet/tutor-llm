<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The full Indian education hierarchy, admin-managed end to end:
 *
 *   Stage   (School · Coaching · Undergraduate · Postgraduate · …)
 *     └─ Track   (CBSE · ICSE · JEE · NEET · B.Tech CSE · MBA · …)
 *         └─ Level   (Class 10 · Class 11 – Science · Year 1 · Semester 3 · …)
 *             └─ Subject  →  Chapter  →  Topic
 *
 * A student is scoped to one Level; the tutor chat happens on a Topic. The full
 * ancestor path is what we feed the AI for precise, syllabus-aware answers.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Level 1 — broad stage of education.
        Schema::create('stages', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('emoji')->nullable();
            $table->string('blurb')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Level 2 — board / exam / programme.
        Schema::create('tracks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stage_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('slug');
            $table->string('emoji')->nullable();
            $table->string('tint')->default('indigo');
            $table->string('blurb')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['stage_id', 'slug']);
        });

        // Level 3 — class / year / semester (+ optional stream).
        Schema::create('levels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('track_id')->constrained()->cascadeOnDelete();
            $table->string('name');                 // "Class 10", "Class 11 – Science", "Semester 3"
            $table->string('slug');
            $table->string('stream')->nullable();   // science | commerce | arts | null
            $table->unsignedTinyInteger('class_number')->nullable(); // 1..12 for school, null otherwise
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['track_id', 'slug']);
        });

        // Level 4 — subject, scoped to a single level.
        Schema::create('subjects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('level_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('slug')->index();
            $table->string('emoji')->nullable();
            $table->string('tint')->default('indigo');
            $table->string('blurb')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('chapters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subject_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('slug');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });

        Schema::create('topics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('chapter_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('slug');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('topics');
        Schema::dropIfExists('chapters');
        Schema::dropIfExists('subjects');
        Schema::dropIfExists('levels');
        Schema::dropIfExists('tracks');
        Schema::dropIfExists('stages');
    }
};
