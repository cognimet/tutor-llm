<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B2B2C org root. A School owns its teachers, classes/sections, and students.
 * seat_limit/plan_id let the platform meter a school like it meters a user
 * (reuses the existing `plans` table from token metering).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schools', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('board')->nullable();   // cbse | icse | state — school's default board
            $table->string('city')->nullable();
            $table->unsignedInteger('seat_limit')->nullable();   // max student seats; null = unlimited
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('schools');
    }
};
