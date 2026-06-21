<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Historical audit log of a student's level-ups (spec §7.5). */
class LevelUpLog extends Model
{
    protected $table = 'student_level_up_logs';

    public $timestamps = false;

    protected $fillable = ['user_id', 'old_level', 'new_level', 'unlocked_features', 'logged_at'];

    protected $casts = [
        'old_level'         => 'integer',
        'new_level'         => 'integer',
        'unlocked_features' => 'array',
        'logged_at'         => 'datetime',
    ];

    public function user() { return $this->belongsTo(User::class); }
}
