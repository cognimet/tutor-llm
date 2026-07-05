<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A grade-group inside a school ("Grade 10"). Named SchoolClass because
 * `Class` is a reserved PHP word and curriculum `Level` already means the
 * "Class 10" syllabus. `level_id` maps the grade to that curriculum Level so
 * a section inherits the right subjects/chapters/topics without duplication.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('school_classes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained('schools')->cascadeOnDelete();
            $table->foreignId('level_id')->nullable()->constrained('levels')->nullOnDelete();
            $table->string('name');                          // "Grade 10"
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
            $table->index(['school_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('school_classes');
    }
};
