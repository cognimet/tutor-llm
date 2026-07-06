<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Multimodal knowledge_nodes — the structured home for diagrams parsed out of a
 * student's uploaded notes (Multimodal RAG plan §3).
 *
 * A node is one ingested unit: text, a table, or a DIAGRAM. For diagrams we keep
 * the Universal Vector Sketch Schema (UVSS) JSON + an extraction confidence, and
 * the THREE-ASSET storage strategy (original crop, cleaned crop, normalized
 * sketch). The Qdrant point id links this row to its vector so retrieval (which
 * runs in the AI service against Qdrant) can resolve back to the full record.
 *
 * Fallback by design: if UVSS extraction fails or scores low, `diagram_schema`
 * is null but the node is STILL indexed (via `content`/`labels`), so the tutor
 * can always surface the real uploaded image even without interactive
 * reconstruction.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('knowledge_nodes', function (Blueprint $table) {
            $table->id();

            // Polymorphic source: usually a TopicNote (uploaded document), but
            // could be a curriculum Topic for vetted/seeded diagrams.
            $table->nullableMorphs('nodeable');

            $table->string('type')->default('text');   // text | table | diagram
            $table->string('title')->nullable();
            $table->text('content');                    // raw text or VLM summary of the diagram

            // UVSS JSON payload (null on fallback) + extraction confidence 0..1.
            $table->json('diagram_schema')->nullable();
            $table->float('uvss_confidence_score')->default(0.0);

            // Three-asset storage (paths relative to the shared storage volume,
            // served as auth'd image URLs — same pattern as textbook figures).
            $table->string('original_crop_url')->nullable();
            $table->string('cleaned_crop_url')->nullable();
            $table->string('normalized_image_url')->nullable();

            // OCR text (PaddleOCR/tesseract) + extracted labels, kept even when
            // UVSS is absent so the node stays retrievable on the fallback path.
            $table->text('ocr_text')->nullable();
            $table->json('labels')->nullable();

            // The Qdrant point id linking this DB record to the vector store.
            // Nullable so a row can be persisted before indexing completes;
            // unique so re-indexing a node overwrites cleanly.
            $table->uuid('qdrant_id')->nullable()->unique();

            // Retrieval scoping — mirrors how figures/notes are scoped so a
            // diagram surfaces for its subject/chapter/topic (and ★ primary
            // notes rank first). Denormalised for cheap filtering.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('subject_id')->nullable();
            $table->unsignedBigInteger('chapter_id')->nullable();
            $table->unsignedBigInteger('topic_id')->nullable();
            $table->string('topic_name')->nullable();
            $table->boolean('is_primary')->default(false);

            // Provenance within the source document.
            $table->unsignedBigInteger('note_id')->nullable();   // source TopicNote id
            $table->unsignedInteger('page')->nullable();         // source page (PDFs)
            $table->unsignedInteger('region_index')->nullable(); // nth diagram on the page

            $table->string('status')->default('ready');          // ready | failed

            $table->timestamps();

            $table->index(['type', 'subject_id']);
            $table->index(['user_id', 'topic_id']);
            $table->index(['note_id', 'page']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('knowledge_nodes');
    }
};
