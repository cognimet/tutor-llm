<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Learning events — a durable audit log of every meaningful student action
 * (chat turn, assessment, mistake, flashcard review, note upload, plan task…).
 *
 * This is the system-of-record copy; each row is mirrored to the GraphRAG
 * "AI mind" (a :Event node in Neo4j + an embedding in Qdrant `events`) via the
 * AI service, so the tutor can reason over — and semantically recall — what the
 * student has actually done. The graph is rebuildable from this table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('learning_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type');                 // chat_turn|assessment|mistake|flashcard_review|note_upload|plan_generated|plan_task_done|gap_detected|misconception
            $table->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $table->string('topic_name')->nullable();
            $table->string('concept')->nullable();
            $table->text('text')->nullable();        // the embedded summary of the action
            $table->json('meta')->nullable();
            $table->string('graph_id')->nullable();  // the Neo4j/Qdrant point id, if mirrored
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
            $table->index(['user_id', 'type']);
            $table->index(['user_id', 'topic_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('learning_events');
    }
};
