<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the two B2B2C roles and hooks users into the school org.
 *
 * `role` was declared with Laravel's enum() which, on Postgres, is a varchar
 * plus a CHECK constraint named `users_role_check`. You CANNOT widen it by
 * re-declaring enum() in a migration — you must drop and recreate the check
 * constraint with raw SQL (below).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','student','parent','teacher','school_admin'))");

        Schema::table('users', function (Blueprint $table) {
            // Org membership — nullable so existing/self-serve users are untouched.
            $table->foreignId('school_id')->nullable()->after('role')->constrained('schools')->nullOnDelete();
            $table->foreignId('section_id')->nullable()->after('school_id')->constrained('sections')->nullOnDelete();
            // School-issued login code: students can sign in with this OR their email.
            $table->string('login_code')->nullable()->unique()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('section_id');
            $table->dropConstrainedForeignId('school_id');
            $table->dropUnique(['login_code']);
            $table->dropColumn('login_code');
        });

        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','student','parent'))");
    }
};
