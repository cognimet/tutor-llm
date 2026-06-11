<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Token management (AI_Tutor_Token_Management.md).
 *
 * Two layers, deliberately separate:
 *  - internal tokens (real LLM tokens, admin/engineering only) -> token_ledger
 *  - student-facing credits (abstracted unit) -> plans + usage_counters
 */
return new class extends Migration
{
    public function up(): void
    {
        // Plan definitions, editable by admin without redeploy.
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();              // Free | Plus | Family
            $table->unsignedInteger('price_inr')->default(0);
            $table->unsignedInteger('daily_credit_limit')->default(30);
            $table->unsignedInteger('monthly_credit_limit')->default(600);
            $table->json('per_action_weights')->nullable(); // {chat:1, assess_gen:3, grade:1, plan:1, report:2}
            $table->json('features')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained();
            $table->enum('status', ['active', 'cancelled', 'expired'])->default('active');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('renews_at')->nullable();
            $table->string('provider_ref')->nullable();
            $table->timestamps();
        });

        // Every billable AI call — the source of truth for cost.
        Schema::create('token_ledger', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('chat_session_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action_type');                  // chat|assess_gen|grade|gap|plan|report
            $table->string('model')->nullable();
            $table->unsignedInteger('prompt_tokens')->default(0);
            $table->unsignedInteger('completion_tokens')->default(0);
            $table->decimal('credits_charged', 8, 2)->default(0);
            $table->decimal('cost_inr', 10, 4)->default(0);
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
            $table->index('action_type');
        });

        // Fast live counters (DB-backed here; mirror in Redis at scale).
        Schema::create('usage_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('metric');                       // daily_credits | monthly_credits
            $table->string('period_key');                   // '2026-06-11' or '2026-06'
            $table->decimal('value', 10, 2)->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'metric', 'period_key']);
        });

        // Admin-set top-ups / promos / apologies — clean audit trail.
        Schema::create('credit_grants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 8, 2);
            $table->string('reason')->nullable();
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        // Model pricing, editable so providers can be swapped without code.
        Schema::create('model_rates', function (Blueprint $table) {
            $table->id();
            $table->string('model');
            $table->decimal('input_rate_per_1k', 10, 6)->default(0);   // INR per 1k prompt tokens
            $table->decimal('output_rate_per_1k', 10, 6)->default(0);  // INR per 1k completion tokens
            $table->string('currency', 8)->default('INR');
            $table->timestamp('effective_from')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('model_rates');
        Schema::dropIfExists('credit_grants');
        Schema::dropIfExists('usage_counters');
        Schema::dropIfExists('token_ledger');
        Schema::dropIfExists('subscriptions');
        Schema::dropIfExists('plans');
    }
};
