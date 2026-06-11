<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Curriculum content chunks — the RAG knowledge base.
 *
 * Each chunk is a teachable unit of text for a topic (explainer / example /
 * misconception). The chat and assessment generation retrieve these from the
 * vector store so answers stay grounded in vetted curriculum, not the model's
 * memory. `indexed_at` tracks whether the chunk is live in Qdrant.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('content_chunks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('topic_id')->constrained()->cascadeOnDelete();
            $table->string('type')->default('explainer'); // explainer | example | misconception
            $table->text('body');
            $table->string('source_ref')->nullable();      // page/url/citation
            $table->timestamp('indexed_at')->nullable();   // when last pushed to the vector store
            $table->timestamps();
            $table->index(['topic_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('content_chunks');
    }
};
