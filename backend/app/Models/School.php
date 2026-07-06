<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class School extends Model
{
    protected $fillable = ['name', 'slug', 'board', 'city', 'seat_limit', 'plan_id', 'is_active'];

    protected $casts = [
        'is_active'  => 'boolean',
        'seat_limit' => 'integer',
    ];

    public function plan()    { return $this->belongsTo(Plan::class); }
    public function classes() { return $this->hasMany(SchoolClass::class)->orderBy('position'); }
    public function sections() { return $this->hasMany(Section::class); }

    /** Every user attached to this school (any role: school_admin, teacher, student). */
    public function members() { return $this->hasMany(User::class); }

    /** Just the students of this school. */
    public function students() { return $this->hasMany(User::class)->where('role', 'student'); }

    /** Just the teachers of this school. */
    public function teachers() { return $this->hasMany(User::class)->where('role', 'teacher'); }

    /** Seats used = current student count. Null seat_limit ⇒ unlimited. */
    public function seatsUsed(): int
    {
        return $this->students()->count();
    }

    public function hasFreeSeat(): bool
    {
        return $this->seat_limit === null || $this->seatsUsed() < $this->seat_limit;
    }
}
