<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name', 'email', 'password', 'role',
        'level_id', 'board', 'grade', 'stream', 'language', 'avatar', 'is_active',
    ];

    protected $appends = ['curriculum_path'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'grade' => 'integer',
        ];
    }

    /* Role helpers */
    public function isAdmin(): bool   { return $this->role === 'admin'; }
    public function isStudent(): bool { return $this->role === 'student'; }
    public function isParent(): bool  { return $this->role === 'parent'; }

    /* Relationships */
    public function children()
    {
        return $this->belongsToMany(User::class, 'parent_student', 'parent_id', 'student_id')
            ->withPivot('relationship')->withTimestamps();
    }

    public function parents()
    {
        return $this->belongsToMany(User::class, 'parent_student', 'student_id', 'parent_id')
            ->withPivot('relationship')->withTimestamps();
    }

    public function level() { return $this->belongsTo(Level::class); }

    /** "School · CBSE · Class 10 · Science" — denormalised for the UI + API payloads. */
    public function getCurriculumPathAttribute(): ?string
    {
        $level = $this->relationLoaded('level') ? $this->level : ($this->level_id ? $this->level()->with('track.stage')->first() : null);
        if (! $level) return null;

        $path = $level->pathLabel();
        if ($this->stream) {
            $path .= ' · ' . ucfirst($this->stream);
        }

        return $path;
    }

    public function chatSessions()      { return $this->hasMany(ChatSession::class); }
    public function assessments()       { return $this->hasMany(Assessment::class); }
    public function knowledgeGaps()     { return $this->hasMany(KnowledgeGap::class); }
    public function learningPlans()     { return $this->hasMany(LearningPlan::class); }
    public function progressSnapshots() { return $this->hasMany(ProgressSnapshot::class); }
}
