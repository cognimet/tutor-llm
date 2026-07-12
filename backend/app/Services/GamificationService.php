<?php

namespace App\Services;

use App\Models\CompanionPet;
use App\Models\GamificationProfile;
use App\Models\LevelUpLog;
use App\Models\StudentBadge;
use App\Models\StudentSticker;
use App\Models\StudentTrophy;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * The Universal (Dual-Engine) Gamification engine — spec §3, §4, §5, §7, §8.
 *
 * Two age engines share one service and one profile row:
 *   - Junior (Classes 1–4): earns 🌟 Magic Stars on a LINEAR curve, raises a
 *     companion pet, and unlocks virtual stickers.
 *   - Senior (Classes 5–10): earns ⚡ Adventure XP on a POLYNOMIAL curve, and
 *     unlocks badges & glassmorphic trophies.
 *
 * Every reward funnels through award()/claim() so the returned delta (points
 * gained, level-ups, new badges/trophies/stickers, streak & multiplier) can
 * drive the front-end celebration overlay.
 */
class GamificationService
{
    /**
     * Earn rates (spec §3.2). action => [junior_stars, senior_xp].
     * The streak multiplier is applied on top of these for every earn.
     */
    public const EARN = [
        // Canonical spec events.
        'chat_explainer'    => [5, 25],    // Complete a chat explainer
        'correct_note'      => [10, 50],   // Double-check & correct a note error
        'perfect_quiz'      => [15, 75],   // 100% on a mini-quiz (+ "Perfect" bonus)
        'daily_streak'      => [2, 10],    // Daily login streak (× multiplier)
        'chapter_quest'     => [30, 150],  // Complete a chapter quest (+ pack / trophy)
        'help_peer'         => [2, 10],    // Send a High-Five
        // Notes / quest-flow actions (back-compat with the Study-from-notes flow).
        'upload_first_note' => [25, 50],
        'upload_note'       => [10, 20],
        'start_quest'       => [5, 10],
        'answer_correct'    => [10, 20],
        'master_concept'    => [50, 100],
        'complete_quest'    => [30, 150],
        'complete_plan'     => [50, 150],
    ];

    /** "Perfect" bonus added (pre-multiplier) on a 100% quiz in Senior mode. */
    public const PERFECT_BONUS = 25;

    /** Cost of a Streak Shield in the Senior "Reward Guild" (spec §3.3). */
    public const SHIELD_COST = 300;

    /** Rank titles by engine (index = level-1, clamps at the last). */
    public const RANKS_SENIOR = ['Novice Scholar', 'Apprentice', 'Adept', 'Scholar', 'Sage', 'Master Mind', 'Grandmaster'];
    public const RANKS_JUNIOR = ['Tiny Sprout', 'Star Friend', 'Magic Explorer', 'Dream Adventurer', 'Star Champion'];

    /** Senior badge catalogue: key => [label, emoji, description]. */
    public const BADGES = [
        'note_ninja'     => ['Note Ninja', '🥷', 'Uploaded 3 separate notes'],
        'perfect_score'  => ['Perfect Score', '🎯', 'Scored 100% on a notes-driven assessment'],
        'night_owl'      => ['Night Owl', '🦉', 'Completed a learning task after 8 PM'],
        'streak_saver'   => ['Streak Saver', '🔥', 'Held a 5-day study streak'],
        'formula_master' => ['Formula Master', '🧮', 'Mastered a formula-heavy topic'],
        'circuit_wizard' => ['Circuit Wizard', '🧲', 'Completed an Electricity quest'],
    ];

    /** Senior trophy catalogue: key => [label, emoji, rarity, description] (spec §5.2). */
    public const TROPHIES = [
        'circuit_wizard' => ['Circuit Wizard', '🧲', 'rare', 'Mastered an electricity quest'],
        'geometry_ninja' => ['Geometry Ninja', '📐', 'rare', 'Completed a geometry chapter quest'],
        'atomic_bomber'  => ['Atomic Bomber', '🧪', 'common', 'Completed a chemistry quest'],
        'quest_conqueror'=> ['Quest Conqueror', '🏆', 'common', 'Completed your first chapter quest'],
        'plan_champion'  => ['Plan Champion', '🏅', 'ultra_rare', 'Finished a full study plan'],
    ];

    /** Junior sticker packs: theme => [ [key, emoji, shiny], ... ] (spec §5.1). */
    public const STICKER_PACKS = [
        'space'  => [['moon', '🌕', false], ['rocket', '🚀', false], ['alien', '👽', true], ['planet', '🪐', false], ['astronaut', '🧑‍🚀', true]],
        'safari' => [['lion', '🦁', false], ['elephant', '🐘', false], ['giraffe', '🦒', false], ['zebra', '🦓', false], ['tiger', '🐯', true]],
        'dino'   => [['trex', '🦖', true], ['stego', '🦕', false], ['volcano', '🌋', false], ['fossil', '🦴', false], ['egg', '🥚', false]],
        'cells'  => [['microbe', '🦠', false], ['dna', '🧬', true], ['microscope', '🔬', false], ['petri', '🧫', false], ['atom', '⚛️', false]],
    ];

    /* ===================================================================== */
    /*  Profile + progression maths                                          */
    /* ===================================================================== */

    /** Get-or-create the student's profile, keeping engine_mode in sync with their class. */
    public function profileFor(User $student): GamificationProfile
    {
        $profile = $student->gamificationProfile()->firstOrCreate(
            ['user_id' => $student->id],
            ['engine_mode' => $student->engineMode(), 'current_level' => 1],
        );

        $mode = $student->engineMode();
        if ($profile->engine_mode !== $mode) {
            $profile->engine_mode = $mode;
            $profile->save();
        }

        return $profile;
    }

    /** Points cost to advance INTO `$level` (the L-1 → L transition). Level 1 = 0. */
    public function levelCost(string $engine, int $level): int
    {
        if ($level <= 1) return 0;
        return $engine === 'junior'
            ? (int) round(50 * $level)                                  // Stars(L) = 50·L
            : (int) round(100 * pow($level, 1.5) + 150 * $level);       // XP(L) = 100·L^1.5 + 150·L
    }

    /** Cumulative points needed to BE at `$level`. */
    public function cumulativeForLevel(string $engine, int $level): int
    {
        $sum = 0;
        for ($k = 2; $k <= $level; $k++) {
            $sum += $this->levelCost($engine, $k);
        }
        return $sum;
    }

    /** Resolve the level for a points total. */
    public function levelForPoints(string $engine, int $points): int
    {
        $level = 1;
        while ($level < 200 && $this->cumulativeForLevel($engine, $level + 1) <= $points) {
            $level++;
        }
        return $level;
    }

    /** The current earning multiplier from the streak (spec §3.3): 1 + min(0.5, streak/10). */
    public function multiplier(int $streak): float
    {
        return 1 + min(0.5, $streak / 10);
    }

    public function rankTitle(string $engine, int $level): string
    {
        $ranks = $engine === 'junior' ? self::RANKS_JUNIOR : self::RANKS_SENIOR;
        return $ranks[min($level, count($ranks)) - 1] ?? end($ranks);
    }

    /* ===================================================================== */
    /*  Awarding                                                             */
    /* ===================================================================== */

    /**
     * Award points for an action, refresh the daily streak (with multiplier),
     * level the student up, and unlock any earned badges / trophies / stickers.
     *
     * @return array the celebration delta (see keys below)
     */
    public function award(User $student, string $action, array $context = []): array
    {
        $profile = $this->profileFor($student);
        $junior = $profile->isJunior();
        $idx = $junior ? 0 : 1;

        $base = self::EARN[$action][$idx] ?? 0;

        // First-upload bonus replaces the normal upload award.
        if ($action === 'upload_note' && (int) $student->notes()->count() <= 1) {
            $base = self::EARN['upload_first_note'][$idx];
        }
        // Senior "Perfect" quiz bonus.
        if (! $junior && $action === 'perfect_quiz') {
            $base += self::PERFECT_BONUS;
        }

        $beforeLevel = (int) $profile->current_level;

        // Streak first, so its multiplier applies to this award.
        $streak = $this->touchStreak($profile);
        $multiplier = $this->multiplier($streak);
        $gained = (int) round($base * $multiplier);

        if ($junior) {
            $profile->magic_stars = (int) $profile->magic_stars + $gained;
            $points = (int) $profile->magic_stars;
        } else {
            $profile->xp_points = (int) $profile->xp_points + $gained;
            $points = (int) $profile->xp_points;
        }

        $newLevel = $this->levelForPoints($profile->engine_mode, $points);
        $profile->current_level = $newLevel;
        $profile->save();

        // Mirror onto the legacy users columns (kept for other readers).
        $student->forceFill([
            'xp_points'        => (int) $profile->xp_points,
            'level'            => $newLevel,
            'current_streak'   => $streak,
            'last_active_date' => $profile->last_study_activity_at,
        ])->save();

        $leveledUp = $newLevel > $beforeLevel;
        $newStickers = [];
        $newTrophies = [];

        if ($leveledUp) {
            $unlocked = [];
            if ($junior) {
                // Level-up gifts a sticker pack.
                $sticker = $this->grantRandomSticker($student);
                if ($sticker) { $newStickers[] = $sticker; $unlocked[] = 'sticker_' . $sticker['theme_group']; }
                $this->bumpPet($student);
            }
            LevelUpLog::create([
                'user_id' => $student->id, 'old_level' => $beforeLevel,
                'new_level' => $newLevel, 'unlocked_features' => $unlocked,
            ]);
        }

        $newBadges = $junior ? [] : $this->evaluateBadges($student, $profile, $action, $context);
        if (! $junior) {
            $newTrophies = $this->evaluateTrophies($student, $action, $context);
        }
        // Chapter quests also gift a sticker pack to Junior students (spec §3.2).
        if ($junior && in_array($action, ['chapter_quest', 'complete_quest'], true)) {
            $sticker = $this->grantRandomSticker($student);
            if ($sticker) $newStickers[] = $sticker;
        }

        return [
            'engine_mode'   => $profile->engine_mode,
            'currency'      => $junior ? 'stars' : 'xp',
            'points_gained' => $gained,
            'xp_gained'     => $gained,           // back-compat for the overlay
            'multiplier'    => round($multiplier, 2),
            'xp_points'     => (int) $profile->xp_points,
            'magic_stars'   => (int) $profile->magic_stars,
            'level'         => $newLevel,
            'leveled_up'    => $leveledUp,
            'streak'        => $streak,
            'new_badges'    => $newBadges,
            'new_trophies'  => $newTrophies,
            'new_stickers'  => $newStickers,
        ];
    }

    /** Alias used by the spec's POST /claim-reward endpoint. */
    public function claim(User $student, string $action, array $context = []): array
    {
        return $this->award($student, $action, $context);
    }

    /** +1 on a new consecutive day; reset on a missed day (Junior weekend shield protects Sat/Sun). */
    protected function touchStreak(GamificationProfile $profile): int
    {
        $today = Carbon::today();
        $last = $profile->last_study_activity_at ? Carbon::parse($profile->last_study_activity_at) : null;

        if (! $last) {
            $profile->current_streak = 1;
        } elseif ($last->isSameDay($today)) {
            // already counted today
        } elseif ($last->copy()->addDay()->isSameDay($today)) {
            $profile->current_streak = (int) $profile->current_streak + 1;
        } elseif ($profile->isJunior() && $this->onlyWeekendBetween($last, $today)) {
            // Junior Weekend Shield: a gap of only Sat/Sun does not break the streak.
            $profile->current_streak = (int) $profile->current_streak + 1;
        } elseif ((int) $profile->streak_shield_count > 0 && $last->copy()->addDays(2)->isSameDay($today)) {
            // Senior Streak Shield: spend one to cover a single missed day.
            $profile->streak_shield_count = (int) $profile->streak_shield_count - 1;
            $profile->current_streak = (int) $profile->current_streak + 1;
        } else {
            $profile->current_streak = 1;
        }

        $profile->highest_streak = max((int) $profile->highest_streak, (int) $profile->current_streak);
        $profile->last_study_activity_at = $today;

        return (int) $profile->current_streak;
    }

    /** True when every day strictly between $last and $today is a weekend day. */
    protected function onlyWeekendBetween(Carbon $last, Carbon $today): bool
    {
        $cursor = $last->copy()->addDay();
        if ($cursor->greaterThanOrEqualTo($today)) return false;
        while ($cursor->lessThan($today)) {
            if (! $cursor->isWeekend()) return false;
            $cursor->addDay();
        }
        return true;
    }

    /* ===================================================================== */
    /*  Badges, trophies, stickers, pet                                      */
    /* ===================================================================== */

    protected function evaluateBadges(User $student, GamificationProfile $profile, string $action, array $context): array
    {
        $earned = [];
        $maybe = function (string $key, bool $cond) use ($student, &$earned) {
            if (! $cond) return;
            $row = StudentBadge::firstOrCreate(
                ['student_id' => $student->id, 'badge_key' => $key],
                ['unlocked_at' => now()],
            );
            if ($row->wasRecentlyCreated && isset(self::BADGES[$key])) {
                [$label, $emoji] = self::BADGES[$key];
                $earned[] = ['key' => $key, 'label' => $label, 'emoji' => $emoji];
            }
        };

        $maybe('note_ninja', $action === 'upload_note' && (int) $student->notes()->count() >= 3);
        $maybe('streak_saver', (int) $profile->current_streak >= 5);
        $maybe('night_owl', in_array($action, ['complete_quest', 'chapter_quest', 'complete_plan', 'master_concept'], true)
            && (int) now()->hour >= 20);
        $maybe('perfect_score', in_array($action, ['perfect_quiz', 'answer_correct'], true) && ! empty($context['perfect']));
        $maybe('formula_master', $action === 'master_concept' && ! empty($context['formula_heavy']));
        if (in_array($action, ['complete_quest', 'chapter_quest'], true)
            && stripos((string) ($context['topic'] ?? ''), 'electric') !== false) {
            $maybe('circuit_wizard', true);
        }

        return $earned;
    }

    protected function evaluateTrophies(User $student, string $action, array $context): array
    {
        $earned = [];
        $grant = function (string $key) use ($student, &$earned) {
            $meta = self::TROPHIES[$key] ?? null;
            if (! $meta) return;
            $row = StudentTrophy::firstOrCreate(
                ['user_id' => $student->id, 'trophy_key' => $key],
                ['rarity' => $meta[2], 'unlocked_at' => now()],
            );
            if ($row->wasRecentlyCreated) {
                $earned[] = ['key' => $key, 'label' => $meta[0], 'emoji' => $meta[1], 'rarity' => $meta[2]];
            }
        };

        $topic = strtolower((string) ($context['topic'] ?? ''));
        if (in_array($action, ['complete_quest', 'chapter_quest'], true)) {
            $grant('quest_conqueror');
            if (str_contains($topic, 'electric') || str_contains($topic, 'circuit') || str_contains($topic, 'current')) $grant('circuit_wizard');
            if (str_contains($topic, 'geometr') || str_contains($topic, 'triangle') || str_contains($topic, 'angle')) $grant('geometry_ninja');
            if (str_contains($topic, 'chem') || str_contains($topic, 'acid') || str_contains($topic, 'reaction')) $grant('atomic_bomber');
        }
        if ($action === 'complete_plan') $grant('plan_champion');

        return $earned;
    }

    /** Unlock the next locked sticker (Junior). Returns its payload, or null when the book is full. */
    protected function grantRandomSticker(User $student): ?array
    {
        $owned = $student->stickers()->pluck('sticker_key')->all();
        foreach (self::STICKER_PACKS as $theme => $items) {
            foreach ($items as [$key, $emoji, $shiny]) {
                $full = "{$theme}_{$key}";
                if (in_array($full, $owned, true)) continue;
                StudentSticker::create([
                    'user_id' => $student->id, 'sticker_key' => $full,
                    'theme_group' => $theme, 'is_shiny' => $shiny, 'unlocked_at' => now(),
                ]);
                return ['key' => $full, 'theme_group' => $theme, 'emoji' => $emoji, 'is_shiny' => $shiny];
            }
        }
        return null;
    }

    /** Companion pet gains friendship on a level-up (Junior). */
    protected function bumpPet(User $student): void
    {
        $pet = $this->petFor($student);
        $pet->friendship_points = (int) $pet->friendship_points + 10;
        $pet->pet_level = max(1, intdiv((int) $pet->friendship_points, 100) + 1);
        $pet->save();
    }

    public function petFor(User $student): CompanionPet
    {
        return $student->companionPet()->firstOrCreate(['user_id' => $student->id]);
    }

    /* ===================================================================== */
    /*  Read payloads (controller / dashboards)                              */
    /* ===================================================================== */

    /** Compact stats for the UI header (superset of the legacy keys). */
    public function stats(User $student): array
    {
        $profile = $this->profileFor($student);
        $junior = $profile->isJunior();
        $points = $junior ? (int) $profile->magic_stars : (int) $profile->xp_points;
        $level = (int) $profile->current_level;

        return [
            'engine_mode'   => $profile->engine_mode,
            'currency'      => $junior ? 'stars' : 'xp',
            'xp_points'     => (int) $profile->xp_points,
            'magic_stars'   => (int) $profile->magic_stars,
            'level'         => $level,
            'rank'          => $this->rankTitle($profile->engine_mode, $level),
            'streak'        => (int) $profile->current_streak,
            'multiplier'    => round($this->multiplier((int) $profile->current_streak), 2),
            'xp_into_level' => $points - $this->cumulativeForLevel($profile->engine_mode, $level),
            'xp_for_level'  => $this->levelCost($profile->engine_mode, $level + 1),
            'badges'        => StudentBadge::where('student_id', $student->id)
                ->pluck('badge_key')->map(function ($k) {
                    [$label, $emoji, $desc] = self::BADGES[$k] ?? [$k, '🏅', ''];
                    return ['key' => $k, 'label' => $label, 'emoji' => $emoji, 'description' => $desc];
                })->all(),
            'daily'         => $this->dailyProgress($student),
        ];
    }

    /** Wins needed per day for the daily goal (the habit anchor). */
    public const DAILY_GOAL = 3;

    /**
     * Today's "wins" toward the daily goal. A win is a learning outcome, never
     * time-on-app: a quest game passed at >= 70% on first attempts, or a quiz
     * submitted at >= 70%. Computed from durable stores so it's cheat-proof and
     * survives reloads.
     */
    public function dailyProgress(User $student): array
    {
        $today = Carbon::today();
        $wins  = 0;

        // Quest games: group today's evidence per game, score FIRST attempts.
        $events = \App\Models\EvidenceEvent::where('user_id', $student->id)
            ->where('created_at', '>=', $today)
            ->whereNotNull('game_instance_id')
            ->orderBy('id')
            ->get(['game_instance_id', 'item_index', 'correct']);

        foreach ($events->groupBy('game_instance_id') as $gameEvents) {
            $first = $gameEvents->groupBy('item_index')->map(fn ($e) => $e->first());
            if ($first->count() >= 2 && $first->where('correct', true)->count() / $first->count() >= 0.7) {
                $wins++;
            }
        }

        // Quizzes submitted today at >= 70%.
        $wins += \App\Models\Assessment::where('user_id', $student->id)
            ->whereNotNull('score')
            ->where('total', '>', 0)
            ->where('updated_at', '>=', $today)
            ->get(['score', 'total'])
            ->filter(fn ($a) => $a->score / max(1, $a->total) >= 0.7)
            ->count();

        return [
            'done' => $wins,
            'goal' => self::DAILY_GOAL,
            'met'  => $wins >= self::DAILY_GOAL,
        ];
    }

    /** Full profile payload (spec §8.1) — shape differs by engine. */
    public function profilePayload(User $student): array
    {
        $profile = $this->profileFor($student);
        $junior = $profile->isJunior();
        $level = (int) $profile->current_level;
        $points = $junior ? (int) $profile->magic_stars : (int) $profile->xp_points;
        $into = $points - $this->cumulativeForLevel($profile->engine_mode, $level);
        $forLevel = $this->levelCost($profile->engine_mode, $level + 1);
        $pct = $forLevel > 0 ? round(100 * $into / $forLevel, 1) : 100.0;

        if ($junior) {
            $pet = $this->petFor($student);
            return [
                'engine_mode'     => 'junior',
                'magic_stars'     => (int) $profile->magic_stars,
                'current_level'   => $level,
                'rank'            => $this->rankTitle('junior', $level),
                'next_level_stars'=> $forLevel,
                'progress_percent'=> $pct,
                'streak'          => [
                    'days'                   => (int) $profile->current_streak,
                    'shield_active'          => Carbon::today()->isWeekend(),
                    'weekend_shield_applied' => Carbon::today()->isWeekend(),
                ],
                'companion'       => [
                    'pet_name'    => $pet->pet_name,
                    'avatar_skin' => $pet->avatar_skin,
                    'pet_level'   => (int) $pet->pet_level,
                    'friendship'  => (int) $pet->friendship_points,
                    'hunger'      => (int) $pet->hunger_level,
                ],
            ];
        }

        return [
            'engine_mode'     => 'senior',
            'xp_points'       => (int) $profile->xp_points,
            'current_level'   => $level,
            'rank'            => $this->rankTitle('senior', $level),
            'next_level_xp'   => $forLevel,
            'xp_into_level'   => $into,
            'progress_percent'=> $pct,
            'streak'          => [
                'days'                    => (int) $profile->current_streak,
                'shield_active'           => false,
                'streak_shields_available'=> (int) $profile->streak_shield_count,
            ],
            'trophies_count'  => $student->trophies()->count(),
            'badges_count'    => StudentBadge::where('student_id', $student->id)->count(),
            'trophies'        => $student->trophies()->orderByDesc('unlocked_at')->get()
                ->map(function ($t) {
                    $meta = self::TROPHIES[$t->trophy_key] ?? [$t->trophy_key, '🏆', $t->rarity, ''];
                    return ['key' => $t->trophy_key, 'label' => $meta[0], 'emoji' => $meta[1],
                            'rarity' => $t->rarity, 'description' => $meta[3] ?? ''];
                })->all(),
            'badges'          => StudentBadge::where('student_id', $student->id)
                ->pluck('badge_key')->map(function ($k) {
                    [$label, $emoji, $desc] = self::BADGES[$k] ?? [$k, '🏅', ''];
                    return ['key' => $k, 'label' => $label, 'emoji' => $emoji, 'description' => $desc];
                })->all(),
        ];
    }

    /** Sticker catalog + placements (spec §8.3). */
    public function stickerCatalog(User $student): array
    {
        $stickers = $student->stickers()->orderBy('id')->get();
        $emojiFor = function (string $theme, string $key): string {
            foreach (self::STICKER_PACKS[$theme] ?? [] as [$k, $emoji]) {
                if ("{$theme}_{$k}" === $key || $k === $key) return $emoji;
            }
            return '⭐';
        };

        return [
            'available_canvas_themes' => $stickers->pluck('theme_group')->unique()->values()->all(),
            'unlocked_stickers' => $stickers->map(fn ($s) => [
                'id'          => $s->id,
                'sticker_key' => $s->sticker_key,
                'theme_group' => $s->theme_group,
                'emoji'       => $emojiFor($s->theme_group, $s->sticker_key),
                'is_shiny'    => (bool) $s->is_shiny,
                'is_placed'   => $s->is_placed,
                'placement'   => $s->is_placed
                    ? ['x' => $s->placed_x, 'y' => $s->placed_y, 'scale' => $s->canvas_scale]
                    : null,
            ])->all(),
        ];
    }

    /** Persist a sticker placement (spec §8.4). */
    public function placeSticker(User $student, int $stickerId, array $placement): bool
    {
        $sticker = $student->stickers()->whereKey($stickerId)->first();
        if (! $sticker) return false;

        if (($placement['is_placed'] ?? false)) {
            $sticker->placed_x = max(0, min(100, (float) ($placement['placed_x'] ?? 0)));
            $sticker->placed_y = max(0, min(100, (float) ($placement['placed_y'] ?? 0)));
            $sticker->canvas_scale = max(0.3, min(3.0, (float) ($placement['canvas_scale'] ?? 1.0)));
        } else {
            $sticker->placed_x = null;
            $sticker->placed_y = null;
        }
        $sticker->save();

        return true;
    }

    /** Feed / pat the companion pet (spec §8.5). */
    public function interactCompanion(User $student, string $type, ?string $item = null): array
    {
        $pet = $this->petFor($student);

        if ($type === 'feed') {
            $pet->hunger_level = min(100, (int) $pet->hunger_level + 25);
            $pet->friendship_points = (int) $pet->friendship_points + 5;
            $pet->last_fed_at = now();
            $voice = $item ? "Yum! That {$item} was delicious! 🍪" : 'Yum, thank you! 🍪';
        } else { // pat
            $pet->friendship_points = (int) $pet->friendship_points + 3;
            $voice = 'Hehe, that tickles! I love you! 💛';
        }
        $pet->pet_level = max(1, intdiv((int) $pet->friendship_points, 100) + 1);
        $pet->save();

        return [
            'pet_level'         => (int) $pet->pet_level,
            'friendship_points' => (int) $pet->friendship_points,
            'hunger_level'      => (int) $pet->hunger_level,
            'tuto_vocal_response' => $voice,
        ];
    }

    /** Buy a Streak Shield from the Senior Reward Guild (spec §3.3). */
    public function buyShield(User $student): array
    {
        $profile = $this->profileFor($student);
        if ($profile->isJunior()) {
            return ['ok' => false, 'message' => 'Junior mode has an automatic weekend shield.'];
        }
        if ((int) $profile->xp_points < self::SHIELD_COST) {
            return ['ok' => false, 'message' => 'Not enough XP for a Streak Shield.'];
        }
        $profile->xp_points = (int) $profile->xp_points - self::SHIELD_COST;
        $profile->streak_shield_count = (int) $profile->streak_shield_count + 1;
        $profile->current_level = $this->levelForPoints('senior', (int) $profile->xp_points);
        $profile->save();
        $student->forceFill(['xp_points' => (int) $profile->xp_points, 'level' => $profile->current_level])->save();

        return ['ok' => true, 'streak_shields_available' => (int) $profile->streak_shield_count, 'xp_points' => (int) $profile->xp_points];
    }
}
