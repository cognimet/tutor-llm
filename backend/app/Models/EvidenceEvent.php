<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One interaction's evidence of mastery — append-only.
 *
 * Never update or delete a row here: BKT mastery and IRT ability are derived
 * views of this stream, so keeping it immutable lets us recompute both when the
 * models improve (curriculum-to-games blueprint §7).
 */
class EvidenceEvent extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'subject_id', 'game_instance_id',
        'item_index', 'correct', 'submitted', 'time_ms', 'hints_used', 'difficulty',
    ];

    protected $casts = [
        'correct'    => 'boolean',
        'submitted'  => 'json', // what they answered — wrong picks encode misconceptions
        'created_at' => 'datetime',
    ];

    public function user()         { return $this->belongsTo(User::class); }
    public function topic()        { return $this->belongsTo(Topic::class); }
    public function subject()      { return $this->belongsTo(Subject::class); }
    public function gameInstance() { return $this->belongsTo(GameInstance::class); }
}
