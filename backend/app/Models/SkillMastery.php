<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Bayesian Knowledge Tracing state: P(mastered) for one (student, topic). */
class SkillMastery extends Model
{
    protected $table = 'skill_masteries';

    protected $fillable = ['user_id', 'topic_id', 'p_mastered', 'observations'];

    protected $casts = [
        'p_mastered'   => 'float',
        'observations' => 'integer',
    ];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
}
