<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Token metering & cost control.
 *
 * Two layers, deliberately separate:
 *  - internal tokens (real LLM prompt/completion tokens) -> token_ledger + cost
 *  - student-facing credits (abstracted units) -> plans + usage_counters
 *
 * Users never see raw tokens; credits are decoupled from cost so the model
 * can be swapped without changing anyone's plan.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Plan definitions — admin-editable, no redeploy.
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();             // free | plus | family
            $table->string('name');
            $table->integer('price_inr')->default(0);    // monthly, paise-free for MVP
            $table->integer('daily_credit_limit');
            $table->integer('monthly_credit_limit');
            $table->json('per_action_weights');          // {chat:1, assess_gen:3, gap:1, plan:1, grade:1, notes:5}
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Which plan a user is on (null => free).
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
        });

        // Source of truth: every billable AI call.
        Schema::create('token_ledger', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('action_type')->index();      // chat | assess_gen | grade | gap | plan | notes
            $table->string('model')->nullable();
            $table->integer('prompt_tokens')->default(0);
            $table->integer('completion_tokens')->default(0);
            $table->integer('total_tokens')->default(0);
            $table->decimal('credits_charged', 8, 2)->default(0);
            $table->decimal('cost_inr', 10, 4)->default(0);
            $table->boolean('mock')->default(false);
            $table->json('meta')->nullable();            // session_id, topic, etc.
            $table->timestamp('created_at')->useCurrent()->index();
        });

        // Fast rolling counters (period_key: '2026-06-11' daily, '2026-06' monthly).
        Schema::create('usage_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('metric');                    // daily_credits | monthly_credits
            $table->string('period_key');
            $table->decimal('value', 10, 2)->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'metric', 'period_key']);
        });

        // Admin top-ups / promos / support credits. Non-expired grants raise
        // the monthly ceiling for the month they were granted in.
        Schema::create('credit_grants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 8, 2);
            $table->string('reason')->nullable();
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        // Provider pricing — editable when rates change; history kept.
        Schema::create('model_rates', function (Blueprint $table) {
            $table->id();
            $table->string('model');
            $table->decimal('input_rate_per_1k', 10, 6);   // INR per 1K prompt tokens
            $table->decimal('output_rate_per_1k', 10, 6);  // INR per 1K completion tokens
            $table->string('currency', 3)->default('INR');
            $table->date('effective_from');
            $table->timestamps();
            $table->index(['model', 'effective_from']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_id');
        });
        Schema::dropIfExists('model_rates');
        Schema::dropIfExists('credit_grants');
        Schema::dropIfExists('usage_counters');
        Schema::dropIfExists('token_ledger');
        Schema::dropIfExists('plans');
    }
};
