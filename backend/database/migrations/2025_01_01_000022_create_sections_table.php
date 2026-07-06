<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A section ("A", "B") inside a SchoolClass. Students belong to a section.
 * `school_id` is denormalised here so tenant-isolation queries can scope by
 * school without joining up through school_classes every time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_class_id')->constrained('school_classes')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained('schools')->cascadeOnDelete();
            $table->string('name');                          // "A"
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
            $table->index(['school_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sections');
    }
};
