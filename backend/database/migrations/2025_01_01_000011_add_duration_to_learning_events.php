<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add timing to the event log so the AI mind can reason over HOW LONG the
 * student spends — per topic, per screen, per assessment. Powers time-on-topic,
 * engagement and the computed "learner stage".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('learning_events', function (Blueprint $table) {
            $table->unsignedInteger('duration_ms')->nullable()->after('text');
        });
    }

    public function down(): void
    {
        Schema::table('learning_events', function (Blueprint $table) {
            $table->dropColumn('duration_ms');
        });
    }
};
