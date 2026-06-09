<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssessmentAnswer extends Model
{
    protected $fillable = ['assessment_question_id', 'user_id', 'selected_index', 'is_correct'];

    protected $casts = ['is_correct' => 'boolean'];

    public function question() { return $this->belongsTo(AssessmentQuestion::class, 'assessment_question_id'); }
}
