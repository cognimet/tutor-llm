<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A subscription is the billing state that grants a plan to a user (individual
 * / family owner) or a school. Entitlement (TokenMeter::planFor) resolves the
 * ACTIVE subscription first, so plan changes take effect the moment status
 * flips — driven only by our own records, never the client.
 *
 * status: trialing | active | past_due | grace | canceled
 *   active/trialing/past_due/grace  => entitled (don't cut access mid-dunning)
 *   canceled                        => falls back to free
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('school_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->string('status')->default('active')->index();
            $table->string('provider')->default('manual');          // manual | razorpay | stripe
            $table->string('provider_subscription_id')->nullable()->index();
            $table->string('provider_customer_id')->nullable();
            $table->unsignedInteger('seats')->nullable();           // schools / family
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->timestamp('cancel_at')->nullable();             // set when canceling at period end
            $table->timestamp('canceled_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['school_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
