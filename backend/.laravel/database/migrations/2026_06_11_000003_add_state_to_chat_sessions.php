<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Session state machine + tutor mode (Chat Page Spec §8):
 * learning -> ready_for_assessment -> assessing -> analysed -> mastered|relearning
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->string('state')->default('learning')->after('topic_name');
            $table->string('mode')->default('teach')->after('state');      // teach|socratic|quiz|exam|eli10
            $table->unsignedInteger('attempt_no')->default(1)->after('mode');
            $table->string('last_gap')->nullable()->after('attempt_no');   // re-teach differently on attempt 2+
            $table->text('next_step')->nullable()->after('last_gap');      // tutor's latest plan for the panel
        });
    }

    public function down(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->dropColumn(['state', 'mode', 'attempt_no', 'last_gap', 'next_step']);
        });
    }
};
