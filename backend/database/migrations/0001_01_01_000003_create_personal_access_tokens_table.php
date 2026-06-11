<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sanctum's personal_access_tokens table, pinned to a FIXED filename.
 *
 * Why: `php artisan install:api` publishes this migration with a build-time
 * timestamp, so every Docker rebuild produced a "new" migration name. Against
 * a persistent database that already ran the old-named one, `migrate` then
 * failed with "Duplicate table: personal_access_tokens" on every boot.
 * The Dockerfile/setup.sh now delete the auto-published copy and use this
 * fixed, guarded version instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('personal_access_tokens')) {
            return; // already created by a previously-named copy of this migration
        }

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->text('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
    }
};
