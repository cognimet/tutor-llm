<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StudyPlanTask extends Model
{
    protected $fillable = [
        'study_plan_id', 'scheduled_for', 'day_index', 'title', 'detail',
        'concept', 'kind', 'estimated_minutes', 'status', 'position',
    ];

    protected $casts = ['scheduled_for' => 'date'];

    public function plan() { return $this->belongsTo(StudyPlan::class, 'study_plan_id'); }
}
