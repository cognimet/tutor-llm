<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Work a teacher pushes to a section. `mode` (fixed|personalized) is chosen per
 * assignment. Materialised per-student rows live in `assessments`/`learning_plans`
 * and point back here via their `assignment_id`.
 */
class Assignment extends Model
{
    protected $fillable = [
        'school_id', 'section_id', 'teacher_id', 'subject_id', 'topic_id',
        'type', 'mode', 'title', 'payload', 'due_at',
    ];

    protected $casts = [
        'payload' => 'array',
        'due_at'  => 'datetime',
    ];

    public function school()  { return $this->belongsTo(School::class); }
    public function section() { return $this->belongsTo(Section::class); }
    public function teacher() { return $this->belongsTo(User::class, 'teacher_id'); }
    public function subject() { return $this->belongsTo(Subject::class); }
    public function topic()   { return $this->belongsTo(Topic::class); }

    public function assessments() { return $this->hasMany(Assessment::class); }
    public function learningPlans() { return $this->hasMany(LearningPlan::class); }
}
