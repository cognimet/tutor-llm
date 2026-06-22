<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Syllabus Direct Study" (Syllabus Quest) launch config.
 *
 * When a student starts a session from the Notebook Hub — either grounded in
 * their own notes OR directly from the official curriculum (zero notes) — they
 * pick a teaching style and a tutor companion archetype. Those choices must
 * outlive the single launch request: the prompt is built fresh on every later
 * turn (send / stream / regenerate / 1-tap quick actions), and those requests
 * don't carry the launcher's body. So we persist the config on the session.
 *
 *   - quest_style: how the tutor teaches (teach|socratic|quiz|exam). Mirrors the
 *     per-message chat "mode" so the chosen style survives a page reload.
 *   - tutor_vibe:  the companion archetype persona (coach|adventure|comic).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->string('quest_style', 16)->nullable()->after('selected_note_ids');
            $table->string('tutor_vibe', 16)->nullable()->after('quest_style');
        });
    }

    public function down(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->dropColumn(['quest_style', 'tutor_vibe']);
        });
    }
};
