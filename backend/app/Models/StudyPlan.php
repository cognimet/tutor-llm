<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StudyPlan extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'horizon',
        'exam_date', 'title', 'status', 'meta',
    ];

    protected $casts = ['meta' => 'array', 'exam_date' => 'date'];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
    public function tasks() { return $this->hasMany(StudyPlanTask::class)->orderBy('day_index')->orderBy('position'); }
}
