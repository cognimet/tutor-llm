<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Misconceptions caught live in chat — tracked open -> resolved in-session. */
class Misconception extends Model
{
    protected $fillable = [
        'user_id', 'chat_session_id', 'topic_name', 'description',
        'status', 'detected_at', 'resolved_at',
    ];

    protected $casts = ['detected_at' => 'datetime', 'resolved_at' => 'datetime'];
}
