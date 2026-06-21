<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Junior-mode companion pet (Tuto) state & stats (spec §7.4). */
class CompanionPet extends Model
{
    protected $table = 'student_companion_pets';

    protected $fillable = [
        'user_id', 'pet_name', 'avatar_skin', 'pet_level',
        'friendship_points', 'hunger_level', 'last_fed_at',
    ];

    protected $casts = [
        'pet_level'         => 'integer',
        'friendship_points' => 'integer',
        'hunger_level'      => 'integer',
        'last_fed_at'       => 'datetime',
    ];

    public function user() { return $this->belongsTo(User::class); }
}
