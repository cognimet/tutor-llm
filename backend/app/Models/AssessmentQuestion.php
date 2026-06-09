<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssessmentQuestion extends Model
{
    protected $fillable = [
        'assessment_id', 'question', 'options', 'correct_index',
        'concept', 'explanation', 'position',
    ];

    protected $casts = ['options' => 'array', 'correct_index' => 'integer'];

    public function assessment() { return $this->belongsTo(Assessment::class); }
    public function answers()    { return $this->hasMany(AssessmentAnswer::class); }
}
