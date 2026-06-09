<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Level extends Model
{
    protected $fillable = ['track_id', 'name', 'slug', 'stream', 'class_number', 'position', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function track()    { return $this->belongsTo(Track::class); }
    public function subjects() { return $this->hasMany(Subject::class)->orderBy('position'); }

    /** Human-readable "Stage · Track · Level (· Stream)" path for AI context + UI chips. */
    public function pathLabel(): string
    {
        $track = $this->track;
        $stage = $track?->stage;
        $parts = array_filter([$stage?->name, $track?->name, $this->name]);

        return implode(' · ', $parts);
    }
}
