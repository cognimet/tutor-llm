<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One audit row per tracked student action. Written by EventTracker, which also
 * mirrors it to the GraphRAG "AI mind" (Neo4j :Event + Qdrant `events`).
 */
class LearningEvent extends Model
{
    protected $fillable = [
        'user_id', 'type', 'topic_id', 'topic_name', 'concept', 'text', 'duration_ms', 'meta', 'graph_id',
    ];

    protected $casts = ['meta' => 'array', 'duration_ms' => 'integer'];

    public function user() { return $this->belongsTo(User::class); }
}
