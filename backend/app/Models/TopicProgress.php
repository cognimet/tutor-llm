<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A student's rolled-up progress + completion for one topic. Written by
 * TopicProgressService (the single source of truth); read by the student
 * dashboard and the tutor chat header.
 */
class TopicProgress extends Model
{
    protected $table = 'topic_progress';

    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'subject_name', 'chapter_name',
        'status', 'percent',
        'chat_turns', 'concepts_covered', 'concepts_passed',
        'assessments_taken', 'games_played', 'best_score_pct', 'best_game_pct', 'mastery_pct',
        'completed_at', 'last_activity_at',
    ];

    protected $casts = [
        'completed_at'    => 'datetime',
        'last_activity_at'=> 'datetime',
    ];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
}
