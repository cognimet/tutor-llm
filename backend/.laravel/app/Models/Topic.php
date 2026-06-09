<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Topic extends Model
{
    protected $fillable = ['chapter_id', 'name', 'slug', 'position'];

    public function chapter() { return $this->belongsTo(Chapter::class); }
}
