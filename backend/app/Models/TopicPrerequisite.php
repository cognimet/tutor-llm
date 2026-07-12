<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One "must-know-before" edge of the skill graph: prerequisite → topic. */
class TopicPrerequisite extends Model
{
    protected $fillable = ['topic_id', 'prerequisite_topic_id'];

    public function topic()        { return $this->belongsTo(Topic::class); }
    public function prerequisite() { return $this->belongsTo(Topic::class, 'prerequisite_topic_id'); }
}
