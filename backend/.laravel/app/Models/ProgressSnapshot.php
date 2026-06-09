<?php

namespace App\Models;

use App\Casts\DateOnly;
use Illuminate\Database\Eloquent\Model;

class ProgressSnapshot extends Model
{
    protected $fillable = [
        'user_id', 'day', 'mastery', 'topics_studied',
        'questions_answered', 'gaps_closed',
    ];

    // Persist as a pure "Y-m-d" string so firstOrCreate() lookups match stored
    // rows; still exposed as a Carbon on read. See App\Casts\DateOnly.
    protected $casts = ['day' => DateOnly::class];

    public function user() { return $this->belongsTo(User::class); }
}
