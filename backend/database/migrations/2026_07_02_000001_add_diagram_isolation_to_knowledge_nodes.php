<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Diagram Isolation upgrade (§2 + §3) — strict visual isolation & the
 * "Anchor" relationship.
 *
 * Diagram nodes gain:
 *   - isolated_image_url : the fourth asset — the polygon-masked drawing +
 *     its direct labels floating on a transparent ground, every surrounding
 *     paragraph removed. This is what the Visual Context Viewer renders.
 *   - mask_polygon       : the traced polygon (page coordinates, [[x,y],…])
 *     for provenance/debugging and future re-rendering.
 *
 * Text nodes gain:
 *   - parent_diagram_id  : the anchor. When the parser detects that a page's
 *     prose physically surrounds a diagram, the OCR'd text is stored as
 *     `type=text` knowledge_nodes pointing at that diagram node. Retrieval
 *     hits the text; the anchor surfaces the exact diagram it explains — so
 *     the tutor teaches FROM the text while SHOWING the isolated diagram.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('knowledge_nodes', function (Blueprint $table) {
            $table->string('isolated_image_url')->nullable()->after('normalized_image_url');
            $table->json('mask_polygon')->nullable()->after('isolated_image_url');
            $table->foreignId('parent_diagram_id')->nullable()->after('region_index')
                ->constrained('knowledge_nodes')->nullOnDelete();

            $table->index('parent_diagram_id');
        });
    }

    public function down(): void
    {
        Schema::table('knowledge_nodes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_diagram_id');
            $table->dropColumn(['isolated_image_url', 'mask_polygon']);
        });
    }
};
