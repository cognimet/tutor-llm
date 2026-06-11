<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** EWMA mastery per (student, topic, concept) — master prompt C1. */
class ConceptMastery extends Model
{
    protected $table = 'concept_masteries';

    protected $fillable = [
        'user_id', 'topic_name', 'concept', 'score', 'confidence', 'last_seen_at',
    ];

    protected $casts = ['score' => 'float', 'last_seen_at' => 'datetime'];

    /** A concept passes at score >= 0.8 with confidence >= 2 (never average). */
    public function passes(): bool
    {
        return $this->score >= 0.8 && $this->confidence >= 2;
    }
}
