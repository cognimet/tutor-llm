<?php

namespace App\Services\Billing;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Instant-activation provider — for local dev and offline/PO school deals where
 * money is collected out of band. Checkout activates the subscription
 * immediately; there are no external webhooks.
 */
class ManualProvider implements BillingProvider
{
    public function key(): string
    {
        return 'manual';
    }

    public function createCheckout(User $user, Plan $plan): array
    {
        return [
            'auto_confirm' => true,
            'amount_inr' => (int) $plan->price_inr,
            'provider_subscription_id' => 'man_sub_'.Str::lower(Str::random(12)),
            'provider_payment_id' => $plan->isFree() ? null : 'man_pay_'.Str::lower(Str::random(12)),
            'client' => ['mode' => 'manual'],
        ];
    }

    public function parseWebhook(Request $request): ?array
    {
        // Manual provider has no external webhooks.
        return null;
    }
}
