<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A grade-group inside a school ("Grade 10"). Named SchoolClass because `Class`
 * is reserved in PHP; the DB table is `school_classes`. Maps to a curriculum
 * `Level` so its sections inherit the correct syllabus.
 */
class SchoolClass extends Model
{
    protected $table = 'school_classes';

    protected $fillable = ['school_id', 'level_id', 'name', 'position'];

    public function school()   { return $this->belongsTo(School::class); }
    public function level()    { return $this->belongsTo(Level::class); }
    public function sections() { return $this->hasMany(Section::class)->orderBy('position'); }

    public function teachers()
    {
        return $this->belongsToMany(User::class, 'teacher_class', 'school_class_id', 'teacher_id')->withTimestamps();
    }
}
