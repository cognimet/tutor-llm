<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Subject extends Model
{
    protected $fillable = ['level_id', 'name', 'slug', 'emoji', 'tint', 'blurb', 'position', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function level() { return $this->belongsTo(Level::class); }

    public function chapters()
    {
        return $this->hasMany(Chapter::class)->orderBy('position');
    }
}
