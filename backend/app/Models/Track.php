<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Track extends Model
{
    protected $fillable = ['stage_id', 'name', 'slug', 'emoji', 'tint', 'blurb', 'position', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function stage()  { return $this->belongsTo(Stage::class); }
    public function levels() { return $this->hasMany(Level::class)->orderBy('position'); }
}
