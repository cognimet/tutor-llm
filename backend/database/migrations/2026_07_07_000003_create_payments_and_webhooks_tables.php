<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payment records (one per charge) + a webhook inbox. The webhook inbox gives
 * us idempotency (unique event_id) and an audit trail — the handler dedupes on
 * event_id so a provider re-delivery is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subscription_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('provider')->default('manual');
            $table->string('provider_payment_id')->nullable()->index();
            $table->integer('amount_inr');                 // whole rupees
            $table->string('currency', 3)->default('INR');
            $table->string('status')->default('created');  // created | captured | failed | refunded
            $table->string('method')->nullable();          // upi | card | netbanking | manual
            $table->json('meta')->nullable();
            $table->timestamps();
        });

        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('provider')->index();
            $table->string('event_id')->unique();          // idempotency key
            $table->string('type')->nullable();
            $table->json('payload')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
        Schema::dropIfExists('webhook_events');
    }
};
