<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Misconception telemetry: keep WHAT the student answered, not just whether it
 * was right. Which wrong option a child picks encodes the misconception
 * (e.g. always choosing "respiration" for photosynthesis) — the tutor can then
 * open with that exact confusion instead of a generic recap.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('evidence_events', function (Blueprint $table) {
            $table->json('submitted')->nullable()->after('correct');
        });
    }

    public function down(): void
    {
        Schema::table('evidence_events', function (Blueprint $table) {
            $table->dropColumn('submitted');
        });
    }
};
