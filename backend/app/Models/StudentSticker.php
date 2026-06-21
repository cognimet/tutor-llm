<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A virtual sticker in a Junior-mode student's book / canvas (spec §7.3). */
class StudentSticker extends Model
{
    protected $table = 'student_stickers';

    public $timestamps = false;

    protected $fillable = [
        'user_id', 'sticker_key', 'theme_group', 'is_shiny',
        'placed_x', 'placed_y', 'canvas_scale', 'unlocked_at',
    ];

    protected $casts = [
        'is_shiny'     => 'boolean',
        'placed_x'     => 'float',
        'placed_y'     => 'float',
        'canvas_scale' => 'float',
        'unlocked_at'  => 'datetime',
    ];

    public function user() { return $this->belongsTo(User::class); }

    public function getIsPlacedAttribute(): bool
    {
        return $this->placed_x !== null && $this->placed_y !== null;
    }
}
