<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A teacher (users row, role=teacher) is assigned to many classes, sections,
 * and curriculum subjects. Three plain pivots keep each axis independent so a
 * teacher can, e.g., teach Maths across two sections of Grade 10.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teacher_class', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teacher_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_class_id')->constrained('school_classes')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['teacher_id', 'school_class_id']);
        });

        Schema::create('teacher_section', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teacher_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('section_id')->constrained('sections')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['teacher_id', 'section_id']);
        });

        Schema::create('teacher_subject', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teacher_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('subject_id')->constrained('subjects')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['teacher_id', 'subject_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teacher_subject');
        Schema::dropIfExists('teacher_section');
        Schema::dropIfExists('teacher_class');
    }
};
