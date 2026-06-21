<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * AI note-inspector result for one uploaded note: the extracted text, key terms,
 * auto-scope confidence, and any flagged corrections (the "Smart Inspector").
 */
class NoteInsight extends Model
{
    protected $fillable = [
        'note_id', 'extracted_text', 'key_terms', 'corrections',
        'confidence_score', 'diagrams_found', 'formula_count',
    ];

    protected $casts = [
        'key_terms' => 'array',
        'corrections' => 'array',
        'confidence_score' => 'float',
        'diagrams_found' => 'boolean',
        'formula_count' => 'integer',
    ];

    public function note()
    {
        return $this->belongsTo(TopicNote::class, 'note_id');
    }
}
