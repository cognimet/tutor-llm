<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Stage extends Model
{
    protected $fillable = ['name', 'slug', 'emoji', 'blurb', 'position', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function tracks()
    {
        return $this->hasMany(Track::class)->orderBy('position');
    }
}
