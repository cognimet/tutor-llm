<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LearningPlan extends Model
{
    protected $fillable = ['user_id', 'assignment_id', 'title', 'topic_name', 'status'];

    public function user()        { return $this->belongsTo(User::class); }
    public function assignment()  { return $this->belongsTo(Assignment::class); }
    public function items() { return $this->hasMany(LearningPlanItem::class)->orderBy('position'); }
}
