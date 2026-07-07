<?php

namespace App\Services\Billing;

use App\Models\Payment;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Models\WebhookEvent;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Owns subscription state transitions. Providers only build checkout payloads
 * and parse webhooks; activation/cancellation live here so entitlement is
 * always driven by our own records.
 */
class SubscriptionService
{
    /** Resolve a provider by key (defaults to the configured provider). */
    public function provider(?string $key = null): BillingProvider
    {
        return match ($key ?? config('billing.provider')) {
            'razorpay' => new RazorpayProvider(),
            'paypal'   => new PayPalProvider(),
            default    => new ManualProvider(),
        };
    }

    /** Public, purchasable plans for the checkout screen. */
    public function purchasablePlans()
    {
        return Plan::where('is_active', true)->where('is_public', true)
            ->orderBy('sort_order')->orderBy('price_inr')->get();
    }

    /**
     * Begin a checkout. For auto-confirm providers (manual/free) the
     * subscription is activated immediately and returned; otherwise the client
     * payload is returned and activation arrives via webhook.
     */
    public function checkout(User $user, string $planKey, ?string $providerKey = null): array
    {
        $plan = Plan::where('key', $planKey)->where('is_active', true)->where('is_public', true)->firstOrFail();
        $provider = $this->provider($providerKey);
        $checkout = $provider->createCheckout($user, $plan);

        if (! empty($checkout['auto_confirm'])) {
            $sub = $this->activate($user, $plan, $provider->key(), [
                'provider_subscription_id' => $checkout['provider_subscription_id'] ?? null,
                'provider_payment_id' => $checkout['provider_payment_id'] ?? null,
                'amount_inr' => $checkout['amount_inr'] ?? (int) $plan->price_inr,
            ]);

            return ['status' => 'active', 'subscription' => $this->present($sub)];
        }

        return ['status' => 'pending', 'checkout' => $checkout['client'] ?? [], 'plan' => $plan->only('key', 'name', 'price_inr')];
    }

    /** Verify a Razorpay Checkout success (client-return) and activate the plan. */
    public function captureRazorpay(User $user, string $planKey, string $orderId, string $paymentId, string $signature): array
    {
        abort_unless((new RazorpayProvider())->verifyPayment($orderId, $paymentId, $signature),
            422, 'Payment verification failed.');
        $plan = Plan::where('key', $planKey)->firstOrFail();
        $sub = $this->activate($user, $plan, 'razorpay', [
            'provider_subscription_id' => $orderId,
            'provider_payment_id' => $paymentId,
            'amount_inr' => (int) $plan->price_inr,
        ]);

        return ['status' => 'active', 'subscription' => $this->present($sub)];
    }

    /** Capture an approved PayPal order and activate the plan it paid for. */
    public function capturePaypal(User $user, string $orderId): array
    {
        try {
            $ctx = (new PayPalProvider())->captureOrder($orderId);
        } catch (\Throwable $e) {
            abort(422, 'Payment could not be confirmed.');
        }
        abort_if($ctx === null || empty($ctx['plan_key']), 422, 'Payment could not be confirmed.');
        abort_unless((int) ($ctx['user_id'] ?? 0) === $user->id, 403, 'This payment is not yours.');

        $plan = Plan::where('key', $ctx['plan_key'])->firstOrFail();
        $sub = $this->activate($user, $plan, 'paypal', [
            'provider_payment_id' => $ctx['provider_payment_id'] ?? null,
            'amount_inr' => (int) $plan->price_inr,
        ]);

        return ['status' => 'active', 'subscription' => $this->present($sub)];
    }

    /**
     * Activate (or switch to) a plan for a user. Supersedes any current active
     * subscription (upgrade/downgrade) and records the payment.
     */
    public function activate(User $user, Plan $plan, string $provider, array $ref = []): Subscription
    {
        return DB::transaction(function () use ($user, $plan, $provider, $ref) {
            // Supersede existing entitling subscriptions (single active sub per user).
            Subscription::where('user_id', $user->id)
                ->whereIn('status', Subscription::ENTITLED)
                ->update(['status' => 'canceled', 'canceled_at' => now()]);

            $now = Carbon::now();
            $end = $plan->billing_period === 'year' ? $now->copy()->addYear() : $now->copy()->addMonth();
            $trialDays = (int) config('billing.trial_days', 0);

            $sub = Subscription::create([
                'user_id' => $user->id,
                'plan_id' => $plan->id,
                'status' => $trialDays > 0 && ! $plan->isFree() ? 'trialing' : 'active',
                'provider' => $provider,
                'provider_subscription_id' => $ref['provider_subscription_id'] ?? null,
                'provider_customer_id' => $ref['provider_customer_id'] ?? null,
                'seats' => $plan->family_seats,
                'trial_ends_at' => $trialDays > 0 && ! $plan->isFree() ? $now->copy()->addDays($trialDays) : null,
                'current_period_start' => $now,
                'current_period_end' => $end,
            ]);

            // Keep the denormalised users.plan_id in sync as a fast fallback.
            $user->forceFill(['plan_id' => $plan->id])->save();

            if (! $plan->isFree() && (int) ($ref['amount_inr'] ?? $plan->price_inr) > 0) {
                Payment::create([
                    'subscription_id' => $sub->id,
                    'user_id' => $user->id,
                    'provider' => $provider,
                    'provider_payment_id' => $ref['provider_payment_id'] ?? null,
                    'amount_inr' => (int) ($ref['amount_inr'] ?? $plan->price_inr),
                    'currency' => 'INR',
                    'status' => 'captured',
                    'method' => $provider === 'manual' ? 'manual' : ($ref['method'] ?? null),
                ]);
            }

            return $sub;
        });
    }

    /** Cancel at period end — stays entitled until then, then falls back to Free. */
    public function cancel(User $user, bool $immediately = false): ?Subscription
    {
        $sub = $user->activeSubscription();
        if (! $sub) {
            return null;
        }
        if ($immediately) {
            $sub->update(['status' => 'canceled', 'canceled_at' => now(), 'cancel_at' => now()]);
            $user->forceFill(['plan_id' => Plan::where('key', 'free')->value('id')])->save();
        } else {
            $sub->update(['cancel_at' => $sub->current_period_end ?? now()]);
        }
        return $sub->fresh();
    }

    /**
     * Idempotent webhook handling. Dedupes on event_id, then maps provider
     * events to activation/cancellation.
     */
    public function handleWebhook(Request $request, ?string $providerKey = null): array
    {
        $provider = $this->provider($providerKey);
        $event = $provider->parseWebhook($request);
        if ($event === null) {
            return ['ok' => false, 'reason' => 'invalid_signature'];
        }

        // Idempotency: a repeat delivery is a no-op.
        $record = WebhookEvent::firstOrCreate(
            ['event_id' => $event['event_id']],
            ['provider' => $provider->key(), 'type' => $event['type'] ?? null, 'payload' => $event],
        );
        if ($record->processed_at !== null) {
            return ['ok' => true, 'deduped' => true];
        }

        $this->applyEvent($provider->key(), $event);
        $record->update(['processed_at' => now()]);

        return ['ok' => true];
    }

    protected function applyEvent(string $provider, array $event): void
    {
        $type = $event['type'] ?? '';

        // Payment success → activate the plan carried in the order notes/custom_id.
        if (in_array($type, ['payment.captured', 'subscription.charged', 'subscription.activated', 'PAYMENT.CAPTURE.COMPLETED'], true)) {
            $user = ! empty($event['user_id']) ? User::find($event['user_id']) : null;
            $plan = ! empty($event['plan_key']) ? Plan::where('key', $event['plan_key'])->first() : null;
            if ($user && $plan) {
                $this->activate($user, $plan, $provider, [
                    'provider_subscription_id' => $event['provider_subscription_id'] ?? null,
                    'provider_payment_id' => $event['provider_payment_id'] ?? null,
                    'amount_inr' => $event['amount_inr'] ?? null,
                ]);
            }
            return;
        }

        // Cancellation / failure → drop the matching subscription.
        if (in_array($type, ['subscription.cancelled', 'subscription.halted', 'BILLING.SUBSCRIPTION.CANCELLED'], true) && ! empty($event['provider_subscription_id'])) {
            $sub = Subscription::where('provider_subscription_id', $event['provider_subscription_id'])->first();
            if ($sub && $sub->user) {
                $this->cancel($sub->user, immediately: true);
            }
        }
    }

    /** Client-safe view of a subscription. */
    public function present(?Subscription $sub): ?array
    {
        if (! $sub) {
            return null;
        }
        $sub->loadMissing('plan');
        return [
            'id' => $sub->id,
            'status' => $sub->status,
            'plan' => $sub->plan?->only('key', 'name', 'price_inr', 'billing_period'),
            'provider' => $sub->provider,
            'current_period_end' => $sub->current_period_end?->toIso8601String(),
            'cancel_at' => $sub->cancel_at?->toIso8601String(),
            'is_entitled' => $sub->isEntitled(),
        ];
    }
}
