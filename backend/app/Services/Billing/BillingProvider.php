<?php

namespace App\Services\Billing;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Payment-provider abstraction. The app depends on OUR subscription state, not
 * a vendor's — an adapter only (a) builds a checkout payload for the client and
 * (b) parses/validates incoming webhooks into a provider-neutral event.
 */
interface BillingProvider
{
    /** Provider key stored on subscriptions/payments (e.g. 'manual', 'razorpay'). */
    public function key(): string;

    /**
     * Start a checkout for a plan. Returns the payload the client needs.
     * Must include 'auto_confirm' (bool): true => activate immediately server-side
     * (dev/manual); false => client completes payment and activation arrives by webhook.
     *
     * @return array{auto_confirm: bool, amount_inr: int, provider_subscription_id: ?string, provider_payment_id: ?string, client: array}
     */
    public function createCheckout(User $user, Plan $plan): array;

    /**
     * Validate + normalise a webhook. Return null if signature/shape is invalid.
     *
     * @return array{event_id: string, type: string, provider_subscription_id: ?string, provider_payment_id: ?string, amount_inr: ?int, status: ?string}|null
     */
    public function parseWebhook(Request $request): ?array;
}
