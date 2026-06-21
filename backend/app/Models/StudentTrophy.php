<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** An unlocked trophy / 3-D badge for a Senior-mode student (spec §7.2). */
class StudentTrophy extends Model
{
    protected $table = 'student_unlocked_trophies';

    public $timestamps = false;

    protected $fillable = ['user_id', 'trophy_key', 'rarity', 'unlocked_at'];

    protected $casts = ['unlocked_at' => 'datetime'];

    public function user() { return $this->belongsTo(User::class); }
}
