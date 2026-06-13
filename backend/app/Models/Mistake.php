<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Mistake extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'concept', 'question',
        'student_answer', 'correct_answer', 'explanation',
        'source', 'source_id', 'resolved',
    ];

    protected $casts = ['resolved' => 'boolean'];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
}
