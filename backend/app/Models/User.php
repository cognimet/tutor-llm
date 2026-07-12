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
        'name', 'email', 'mobile', 'password', 'role',
        'level_id', 'board', 'grade', 'stream', 'language', 'avatar', 'is_active',
        'xp_points', 'level', 'current_streak', 'last_active_date',
        // B2B2C org membership + school-issued login code.
        'school_id', 'section_id', 'login_code',
    ];

    protected $appends = ['curriculum_path', 'learning_mode'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'grade' => 'integer',
            'xp_points' => 'integer',
            'level' => 'integer',
            'current_streak' => 'integer',
            'last_active_date' => 'date',
        ];
    }

    /* Role helpers */
    public function isAdmin(): bool       { return $this->role === 'admin'; }
    public function isStudent(): bool     { return $this->role === 'student'; }
    public function isParent(): bool      { return $this->role === 'parent'; }
    public function isTeacher(): bool     { return $this->role === 'teacher'; }
    public function isSchoolAdmin(): bool { return $this->role === 'school_admin'; }

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

    /* --- Billing --- */
    public function subscriptions() { return $this->hasMany(Subscription::class); }

    /** The user's currently entitling subscription, if any (latest wins). */
    public function activeSubscription(): ?Subscription
    {
        return $this->subscriptions()
            ->whereIn('status', Subscription::ENTITLED)
            ->latest('id')->get()
            ->first(fn (Subscription $s) => $s->isEntitled());
    }

    /* --- B2B2C org relationships --- */
    public function school()  { return $this->belongsTo(School::class); }
    public function section() { return $this->belongsTo(Section::class); }

    // Teacher → the classes / sections / subjects they are assigned to teach.
    public function taughtClasses()
    {
        return $this->belongsToMany(SchoolClass::class, 'teacher_class', 'teacher_id', 'school_class_id')->withTimestamps();
    }

    public function taughtSections()
    {
        return $this->belongsToMany(Section::class, 'teacher_section', 'teacher_id', 'section_id')->withTimestamps();
    }

    public function taughtSubjects()
    {
        return $this->belongsToMany(Subject::class, 'teacher_subject', 'teacher_id', 'subject_id')->withTimestamps();
    }

    /**
     * Tenant-isolation gate. Can THIS user view the given student's data?
     *  - school_admin: any student in their school.
     *  - teacher:      only students in a section they teach.
     * Parents use the separate parent_student link (see ParentController), so
     * this deliberately returns false for parents.
     */
    public function canAccessStudent(User $student): bool
    {
        if (! $student->isStudent()) {
            return false;
        }
        if ($this->isSchoolAdmin()) {
            return $this->school_id !== null && $student->school_id === $this->school_id;
        }
        if ($this->isTeacher()) {
            return $student->section_id !== null
                && $this->taughtSections()->whereKey($student->section_id)->exists();
        }
        return false;
    }

    public function level() { return $this->belongsTo(Level::class); }

    /** "School · CBSE · Class 10 · Science" — denormalised for the UI + API payloads. */
    public function getCurriculumPathAttribute(): ?string
    {
        // NOTE: read the loaded relation via getRelation(), NOT $this->level —
        // the `level` relationship name collides with the `level` integer column
        // (gamification level), and Eloquent's getAttribute() returns the column,
        // so $this->level would be an int once the relation is eager-loaded.
        $level = $this->relationLoaded('level')
            ? $this->getRelation('level')
            : ($this->level_id ? $this->level()->with('track.stage')->first() : null);
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
    public function topicProgress()     { return $this->hasMany(TopicProgress::class); }

    /* Quest engine (skill graph + BKT + IRT + evidence stream) */
    public function evidenceEvents()    { return $this->hasMany(EvidenceEvent::class); }
    public function skillMasteries()    { return $this->hasMany(SkillMastery::class); }
    public function abilityEstimates()  { return $this->hasMany(AbilityEstimate::class); }

    public function notes()             { return $this->hasMany(TopicNote::class); }
    public function studyPlans()        { return $this->hasMany(StudyPlan::class); }
    public function flashcards()        { return $this->hasMany(Flashcard::class); }
    public function mistakes()          { return $this->hasMany(Mistake::class); }
    public function learningEvents()    { return $this->hasMany(LearningEvent::class); }

    /* Gamification (dual-engine) */
    public function gamificationProfile() { return $this->hasOne(GamificationProfile::class); }
    public function trophies()            { return $this->hasMany(StudentTrophy::class); }
    public function stickers()            { return $this->hasMany(StudentSticker::class); }
    public function companionPet()        { return $this->hasOne(CompanionPet::class); }
    public function levelUpLogs()         { return $this->hasMany(LevelUpLog::class); }

    /**
     * The student's class number (1–12), resolved from `grade` or the linked
     * Level's class_number. Null when unknown.
     */
    public function classNumber(): ?int
    {
        if ($this->grade) {
            return (int) $this->grade;
        }
        $level = $this->relationLoaded('level') ? $this->level : ($this->level_id ? $this->level()->first() : null);
        return $level && $level->class_number ? (int) $level->class_number : null;
    }

    /** Which gamification engine applies: Classes 1–4 → junior, else senior. */
    public function engineMode(): string
    {
        $class = $this->classNumber();
        return ($class !== null && $class >= 1 && $class <= 4) ? 'junior' : 'senior';
    }

    /**
     * Which PRIMARY learning experience a student gets.
     *
     *   'game' — Kindergarten to Class 5 (K–5): a gamified quest of interactive
     *            games, missions, levels, badges and streaks (curriculum-covering).
     *   'chat' — Classes 6–12 and above, and advanced/unknown levels (college,
     *            etc.): the conversational AI tutor. No games; learning is chat.
     *
     * This is a DIFFERENT axis from {@see engineMode()} (junior 1–4 / senior 5+),
     * which only tunes how rewards feel — a Class 5 student is game-mode here but
     * senior there.
     */
    public function learningMode(): string
    {
        // Resolve the class number cheaply, without a per-row query: prefer the
        // `grade` column, then an already-loaded `level` relation. (Read the
        // relation via getRelation() — `$this->level` is the gamification-level
        // integer column, not the Level model.) Kindergarten is class 0, so treat
        // 0 as a real value, not a falsy "unknown".
        $level = $this->relationLoaded('level') ? $this->getRelation('level') : null;
        $grade = $this->grade;
        $class = ($grade !== null && $grade !== '')
            ? (int) $grade
            : ($level && $level->class_number !== null ? (int) $level->class_number : null);

        return ($class !== null && $class >= 0 && $class <= 5) ? 'game' : 'chat';
    }

    /** Exposed on every user payload so the client can pick the right home. */
    public function getLearningModeAttribute(): string
    {
        return $this->isStudent() ? $this->learningMode() : 'chat';
    }
}
