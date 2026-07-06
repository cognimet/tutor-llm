<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The "idealised render" asset — a clean, labelled textbook illustration the
 * Gemini image model generates from the student's isolated hand-drawing (the
 * Multimodal RAG plan's "Normalized Sketch via ControlNet", implemented as a
 * real generative image step). The Visual Context Viewer shows this by default
 * so the student sees a tidy textbook figure instead of a rough vector trace.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('knowledge_nodes', function (Blueprint $table) {
            $table->string('illustrated_image_url')->nullable()->after('isolated_image_url');
        });
    }

    public function down(): void
    {
        Schema::table('knowledge_nodes', function (Blueprint $table) {
            $table->dropColumn('illustrated_image_url');
        });
    }
};
