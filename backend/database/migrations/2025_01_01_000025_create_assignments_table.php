<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A teacher pushes work to a whole section. `mode` is chosen per assignment:
 *  - fixed        → one generated question set shared by every student (comparable, gradebook)
 *  - personalized → each student gets their own set from their gaps/mastery
 *
 * Per-student results reuse the existing `assessments` / `learning_plans`
 * tables, linked back via a nullable `assignment_id` added below.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained('schools')->cascadeOnDelete();
            $table->foreignId('section_id')->constrained('sections')->cascadeOnDelete();
            $table->foreignId('teacher_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('subject_id')->nullable()->constrained('subjects')->nullOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained('topics')->nullOnDelete();
            $table->enum('type', ['assessment', 'plan', 'topic'])->default('assessment');
            $table->enum('mode', ['fixed', 'personalized'])->default('fixed');
            $table->string('title');
            $table->json('payload')->nullable();          // shared question set (fixed mode), or generation ctx
            $table->timestamp('due_at')->nullable();
            $table->timestamps();
            $table->index(['section_id', 'created_at']);
        });

        // Link a materialised per-student assessment/plan back to its assignment.
        Schema::table('assessments', function (Blueprint $table) {
            $table->foreignId('assignment_id')->nullable()->after('id')
                ->constrained('assignments')->nullOnDelete();
        });
        Schema::table('learning_plans', function (Blueprint $table) {
            $table->foreignId('assignment_id')->nullable()->after('id')
                ->constrained('assignments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('learning_plans', function (Blueprint $table) {
            $table->dropConstrainedForeignId('assignment_id');
        });
        Schema::table('assessments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('assignment_id');
        });
        Schema::dropIfExists('assignments');
    }
};
