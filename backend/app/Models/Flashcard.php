<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Flashcard extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'source_type', 'source_id',
        'front', 'back', 'ease', 'interval_days', 'repetitions',
        'due_at', 'last_reviewed_at',
    ];

    protected $casts = [
        'ease' => 'float',
        'interval_days' => 'integer',
        'repetitions' => 'integer',
        'due_at' => 'datetime',
        'last_reviewed_at' => 'datetime',
    ];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
}
