<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Syllabus coverage counters for chat-mode topic completion.
 *
 * A topic is only "learned" once the student has actually covered its syllabus
 * concepts — the concepts the tutor extracts from syllabus-grounded turns into
 * `concept_masteries` — not merely sent a few chat messages. These cache the
 * distinct concepts covered and the distinct concepts mastered so the completion
 * gate reads cheaply. Additive; a missing value is 0 (no coverage yet).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('topic_progress', function (Blueprint $table) {
            $table->unsignedInteger('concepts_covered')->default(0)->after('chat_turns');
            $table->unsignedInteger('concepts_passed')->default(0)->after('concepts_covered');
        });
    }

    public function down(): void
    {
        Schema::table('topic_progress', function (Blueprint $table) {
            $table->dropColumn(['concepts_covered', 'concepts_passed']);
        });
    }
};
