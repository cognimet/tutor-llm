<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Knowledge gaps detected from an assessment.
        Schema::create('knowledge_gaps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('assessment_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name');
            $table->string('concept');
            $table->enum('severity', ['low', 'medium', 'high'])->default('medium');
            $table->text('recommendation')->nullable();
            $table->boolean('resolved')->default(false);
            $table->timestamps();
        });

        // Personalized learning plan (light next-steps).
        Schema::create('learning_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->string('topic_name')->nullable();
            $table->enum('status', ['active', 'archived'])->default('active');
            $table->timestamps();
        });

        Schema::create('learning_plan_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('learning_plan_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->text('detail')->nullable();
            $table->string('concept')->nullable();
            $table->unsignedInteger('estimated_minutes')->default(15);
            $table->enum('status', ['todo', 'done'])->default('todo');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });

        // Progress snapshot over time (retention metric).
        Schema::create('progress_snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('day');
            $table->unsignedInteger('mastery')->default(0);     // 0..100 rolling mastery
            $table->unsignedInteger('topics_studied')->default(0);
            $table->unsignedInteger('questions_answered')->default(0);
            $table->unsignedInteger('gaps_closed')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'day']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('progress_snapshots');
        Schema::dropIfExists('learning_plan_items');
        Schema::dropIfExists('learning_plans');
        Schema::dropIfExists('knowledge_gaps');
    }
};
