<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssessmentAnswer extends Model
{
    protected $fillable = [
        'assessment_question_id', 'user_id', 'selected_index', 'is_correct',
        'time_spent_ms', 'answer_changes', 'confidence',
    ];

    protected $casts = [
        'is_correct'     => 'boolean',
        'time_spent_ms'  => 'integer',
        'answer_changes' => 'integer',
        'confidence'     => 'integer',
    ];

    public function question() { return $this->belongsTo(AssessmentQuestion::class, 'assessment_question_id'); }
}
