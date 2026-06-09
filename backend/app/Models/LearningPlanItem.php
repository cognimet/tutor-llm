<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LearningPlanItem extends Model
{
    protected $fillable = [
        'learning_plan_id', 'title', 'detail', 'concept',
        'estimated_minutes', 'status', 'position',
    ];

    public function plan() { return $this->belongsTo(LearningPlan::class, 'learning_plan_id'); }
}
