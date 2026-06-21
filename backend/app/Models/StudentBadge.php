<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A gamification badge a student has unlocked (see GamificationService::BADGES). */
class StudentBadge extends Model
{
    protected $fillable = ['student_id', 'badge_key', 'unlocked_at'];

    protected $casts = ['unlocked_at' => 'datetime'];

    public function student()
    {
        return $this->belongsTo(User::class, 'student_id');
    }
}
