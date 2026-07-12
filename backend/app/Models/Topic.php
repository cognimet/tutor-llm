<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A topic is also the canonical *skill* node of the quest engine: the thing the
 * prerequisite graph connects, BKT traces mastery of, and games are generated for.
 */
class Topic extends Model
{
    protected $fillable = ['chapter_id', 'name', 'slug', 'position', 'mechanic', 'standard_code', 'bloom_level'];

    public function chapter() { return $this->belongsTo(Chapter::class); }

    /* --- Skill graph --- */

    /** Topics that must be mastered before this one. */
    public function prerequisites()
    {
        return $this->belongsToMany(self::class, 'topic_prerequisites', 'topic_id', 'prerequisite_topic_id')
            ->withTimestamps();
    }

    /** Topics that require this one (reverse edges). */
    public function dependents()
    {
        return $this->belongsToMany(self::class, 'topic_prerequisites', 'prerequisite_topic_id', 'topic_id')
            ->withTimestamps();
    }

    public function games()     { return $this->hasMany(GameInstance::class); }
    public function masteries() { return $this->hasMany(SkillMastery::class); }
}
