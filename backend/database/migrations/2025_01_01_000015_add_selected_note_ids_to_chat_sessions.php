<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Study from my notes" grounding: remember which uploaded notes a chat session
 * is scoped to. When a student launches a session from the Notebook Hub with one
 * or more notes selected, those ids are stored here so every turn in the session
 * (including 1-tap quick actions and grounded quizzes) stays anchored to exactly
 * those notes — even when an individual message carries no explicit note_ids.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->json('selected_note_ids')->nullable()->after('topic_name');
        });
    }

    public function down(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->dropColumn('selected_note_ids');
        });
    }
};
