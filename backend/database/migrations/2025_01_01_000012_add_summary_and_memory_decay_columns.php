<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Context-window management + memory decay support:
 *  - chat_sessions.summary / summary_upto_id: rolling conversation summary so a
 *    long chat sends a token-budgeted recent window + a summary of the rest.
 *  - student_memory.last_used_at: recency for relevance ranking + LRU pruning.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->text('summary')->nullable();
            $table->unsignedBigInteger('summary_upto_id')->nullable();
        });

        Schema::table('student_memory', function (Blueprint $table) {
            $table->timestamp('last_used_at')->nullable();
            $table->index(['user_id', 'last_used_at']);
        });
    }

    public function down(): void
    {
        Schema::table('chat_sessions', function (Blueprint $table) {
            $table->dropColumn(['summary', 'summary_upto_id']);
        });

        Schema::table('student_memory', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'last_used_at']);
            $table->dropColumn('last_used_at');
        });
    }
};
