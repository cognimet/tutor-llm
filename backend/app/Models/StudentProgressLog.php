<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One row per interactive event in a storybook lesson — a Progress Gate attempt
 * or a progressive "continue" reveal — used to re-hydrate the chat on load and
 * to power adaptive tutoring + parent telemetry.
 */
class StudentProgressLog extends Model
{
    protected $fillable = [
        'user_id',
        'chat_session_id',
        'type',
        'target_id',
        'is_correct',
        'attempt_number',
        'metadata',
    ];

    protected $casts = [
        'is_correct'     => 'boolean',
        'attempt_number' => 'integer',
        'metadata'       => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function chatSession()
    {
        return $this->belongsTo(ChatSession::class);
    }
}
