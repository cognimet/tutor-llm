<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One behavioural/integrity ping. No updated_at (append-only telemetry).
 */
class EngagementEvent extends Model
{
    public const UPDATED_AT = null;

    // Canonical event types (mirror the frontend tracker).
    public const TAB_BLUR          = 'tab_blur';
    public const TAB_FOCUS         = 'tab_focus';
    public const QUESTION_VIEW     = 'question_view';
    public const ANSWER_CHANGE     = 'answer_change';
    public const SECTION_TIME      = 'section_time';
    public const ASSESSMENT_START  = 'assessment_start';
    public const ASSESSMENT_SUBMIT = 'assessment_submit';
    public const DROP_OFF          = 'drop_off';
    public const CONFIDENCE        = 'confidence';

    protected $fillable = [
        'user_id', 'assessment_id', 'chat_session_id', 'question_id',
        'event_type', 'duration_ms', 'meta', 'created_at',
    ];

    protected $casts = [
        'meta'        => 'array',
        'duration_ms' => 'integer',
        'created_at'  => 'datetime',
    ];

    public function user() { return $this->belongsTo(User::class); }
}
