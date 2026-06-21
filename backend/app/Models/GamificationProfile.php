<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A student's gamification profile (spec §7.1) — the single source of truth for
 * XP, Magic Stars, level, and streak across both the Junior and Senior engines.
 */
class GamificationProfile extends Model
{
    protected $table = 'student_gamification_profiles';

    protected $fillable = [
        'user_id', 'engine_mode', 'xp_points', 'magic_stars', 'current_level',
        'highest_streak', 'current_streak', 'streak_shield_count', 'last_study_activity_at',
    ];

    protected $casts = [
        'xp_points'              => 'integer',
        'magic_stars'            => 'integer',
        'current_level'          => 'integer',
        'highest_streak'         => 'integer',
        'current_streak'         => 'integer',
        'streak_shield_count'    => 'integer',
        'last_study_activity_at' => 'date',
    ];

    public function user() { return $this->belongsTo(User::class); }

    public function isJunior(): bool { return $this->engine_mode === 'junior'; }
}
