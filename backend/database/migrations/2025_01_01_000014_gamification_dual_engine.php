<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Universal (Dual-Engine) Gamification Module — spec §7.
 *
 * Adds the richer persistence layer that supports BOTH age engines:
 *   - Junior (Classes 1–4): Magic Stars, companion pet, virtual sticker book.
 *   - Senior (Classes 5–10): Adventure XP, levels, trophies & badges.
 *
 * The earlier "Study from my notes" migration (…000013) already added
 * xp_points/level/streak columns on `users` and a `student_badges` table; this
 * migration introduces the canonical `student_gamification_profiles` row and
 * backfills it from those columns, so the new service can treat the profile as
 * the single source of truth while the legacy columns stay mirrored.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 7.1 — Per-student gamification profile (single source of truth).
        Schema::create('student_gamification_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->enum('engine_mode', ['junior', 'senior'])->default('senior');
            $table->unsignedInteger('xp_points')->default(0);
            $table->unsignedInteger('magic_stars')->default(0);
            $table->unsignedInteger('current_level')->default(1);
            $table->unsignedInteger('highest_streak')->default(0);
            $table->unsignedInteger('current_streak')->default(0);
            $table->unsignedInteger('streak_shield_count')->default(0);
            $table->date('last_study_activity_at')->nullable();
            $table->timestamps();
            $table->unique('user_id', 'uq_user_gamification');
            $table->index(['engine_mode', 'current_level', 'xp_points'], 'idx_leaderboard');
        });

        // 7.2 — Unlocked trophies / 3-D badges (Senior).
        Schema::create('student_unlocked_trophies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('trophy_key', 100);                 // 'circuit_wizard', 'geometry_ninja'
            $table->enum('rarity', ['common', 'rare', 'ultra_rare'])->default('common');
            $table->timestamp('unlocked_at')->useCurrent();
            $table->unique(['user_id', 'trophy_key'], 'uq_user_trophy');
        });

        // 7.3 — Virtual sticker inventory & canvas placements (Junior).
        Schema::create('student_stickers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('sticker_key', 100);                // 'space_rocket', 'safari_lion'
            $table->string('theme_group', 50);                 // 'space', 'safari'
            $table->boolean('is_shiny')->default(false);
            $table->float('placed_x')->nullable();             // null = in binder; 0–100 = placed
            $table->float('placed_y')->nullable();
            $table->float('canvas_scale')->default(1.0);
            $table->timestamp('unlocked_at')->useCurrent();
            $table->index('user_id', 'idx_user_stickers');
        });

        // 7.4 — Companion pet state (Junior).
        Schema::create('student_companion_pets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('pet_name', 100)->default('Tuto');
            $table->string('avatar_skin', 100)->default('default_owl');
            $table->unsignedInteger('pet_level')->default(1);
            $table->unsignedInteger('friendship_points')->default(0);
            $table->unsignedTinyInteger('hunger_level')->default(100); // 0 starving … 100 full
            $table->timestamp('last_fed_at')->nullable();
            $table->timestamps();
            $table->unique('user_id', 'uq_user_pet');
        });

        // 7.5 — Level-up audit log (dashboards).
        Schema::create('student_level_up_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('old_level');
            $table->unsignedInteger('new_level');
            $table->json('unlocked_features')->nullable();     // ["sticker_book_space","leaderboard_access"]
            $table->timestamp('logged_at')->useCurrent();
            $table->index('user_id', 'idx_user_levels');
        });

        // Backfill profiles from the legacy users columns so existing students
        // keep their XP / level / streak.
        if (Schema::hasColumn('users', 'xp_points')) {
            $now = now();
            DB::table('users')->select('id', 'xp_points', 'level', 'current_streak', 'last_active_date', 'grade')
                ->orderBy('id')->chunk(200, function ($users) use ($now) {
                    $rows = [];
                    foreach ($users as $u) {
                        $grade = (int) ($u->grade ?? 0);
                        $rows[] = [
                            'user_id'                => $u->id,
                            'engine_mode'            => ($grade >= 1 && $grade <= 4) ? 'junior' : 'senior',
                            'xp_points'              => (int) ($u->xp_points ?? 0),
                            'magic_stars'            => 0,
                            'current_level'          => max(1, (int) ($u->level ?? 1)),
                            'current_streak'         => (int) ($u->current_streak ?? 0),
                            'highest_streak'         => (int) ($u->current_streak ?? 0),
                            'streak_shield_count'    => 0,
                            'last_study_activity_at' => $u->last_active_date,
                            'created_at'             => $now,
                            'updated_at'             => $now,
                        ];
                    }
                    if ($rows) {
                        DB::table('student_gamification_profiles')->insertOrIgnore($rows);
                    }
                });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('student_level_up_logs');
        Schema::dropIfExists('student_companion_pets');
        Schema::dropIfExists('student_stickers');
        Schema::dropIfExists('student_unlocked_trophies');
        Schema::dropIfExists('student_gamification_profiles');
    }
};
