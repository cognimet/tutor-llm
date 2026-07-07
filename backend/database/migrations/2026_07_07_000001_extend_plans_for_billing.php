<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Turn the metering `plans` table into billable products: a billing period,
 * a model-routing tier (free = ₹0 inference, paid = Gemini), a provider price
 * handle, a public/hidden flag (schools are sold, not self-serve), and
 * family_seats to mark a plan that also covers the owner's linked children.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->string('billing_period')->default('month')->after('price_inr');   // month | year
            $table->string('tier')->default('paid')->after('billing_period');          // free | paid (model routing)
            $table->string('provider_price_id')->nullable()->after('tier');            // Razorpay/Stripe price/plan id
            $table->boolean('is_public')->default(true)->after('is_active');           // shown in self-serve checkout
            $table->unsignedInteger('family_seats')->nullable()->after('is_public');   // >0 => covers linked children
            $table->integer('sort_order')->default(0)->after('family_seats');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table) {
            $table->dropColumn(['billing_period', 'tier', 'provider_price_id', 'is_public', 'family_seats', 'sort_order']);
        });
    }
};
