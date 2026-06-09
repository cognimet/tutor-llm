<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Chapter extends Model
{
    protected $fillable = ['subject_id', 'name', 'slug', 'position'];

    public function subject() { return $this->belongsTo(Subject::class); }
    public function topics()  { return $this->hasMany(Topic::class)->orderBy('position'); }
}
