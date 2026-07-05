<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A section ("A") inside a SchoolClass. Students belong to a section via
 * users.section_id. `school_id` is denormalised for cheap tenant scoping.
 */
class Section extends Model
{
    protected $fillable = ['school_class_id', 'school_id', 'name', 'position'];

    public function schoolClass() { return $this->belongsTo(SchoolClass::class, 'school_class_id'); }
    public function school()      { return $this->belongsTo(School::class); }

    public function students()    { return $this->hasMany(User::class)->where('role', 'student'); }

    public function teachers()
    {
        return $this->belongsToMany(User::class, 'teacher_section', 'section_id', 'teacher_id')->withTimestamps();
    }

    public function assignments() { return $this->hasMany(Assignment::class)->latest(); }
}
