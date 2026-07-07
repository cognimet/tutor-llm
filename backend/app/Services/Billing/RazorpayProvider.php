<?php

namespace App\Services\Billing;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Razorpay adapter (India: UPI / cards / netbanking). Creates a one-time Order
 * per purchase and carries user_id + plan_key in the order notes, so the
 * signed `payment.captured` webhook can activate the right subscription.
 *
 * Requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.
 * The webhook is the source of truth — the client is never trusted to activate.
 */
class RazorpayProvider implements BillingProvider
{
    public function key(): string
    {
        return 'razorpay';
    }

    protected function creds(): array
    {
        $c = config('billing.razorpay');
        if (empty($c['key_id']) || empty($c['key_secret'])) {
            throw new RuntimeException('Razorpay keys are not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
        }
        return $c;
    }

    public function createCheckout(User $user, Plan $plan): array
    {
        $c = $this->creds();
        // Free plans need no payment — activate directly.
        if ($plan->isFree()) {
            return ['auto_confirm' => true, 'amount_inr' => 0,
                'provider_subscription_id' => null, 'provider_payment_id' => null, 'client' => ['mode' => 'free']];
        }

        $res = Http::withBasicAuth($c['key_id'], $c['key_secret'])
            ->acceptJson()
            ->post($c['api_base'].'/orders', [
                'amount' => (int) $plan->price_inr * 100,   // paise
                'currency' => 'INR',
                'notes' => ['user_id' => (string) $user->id, 'plan_key' => $plan->key],
            ]);

        if (! $res->successful()) {
            throw new RuntimeException('Razorpay order creation failed: '.$res->body());
        }
        $order = $res->json();

        return [
            'auto_confirm' => false,
            'amount_inr' => (int) $plan->price_inr,
            'provider_subscription_id' => null,
            'provider_payment_id' => null,
            'client' => [
                'mode' => 'razorpay',
                'key_id' => $c['key_id'],
                'order_id' => $order['id'] ?? null,
                'amount' => $order['amount'] ?? null,
                'currency' => 'INR',
                'name' => config('app.name', 'AI Tutor'),
            ],
        ];
    }

    /** Verify a Checkout success payload (order_id|payment_id signed with the key secret). */
    public function verifyPayment(string $orderId, string $paymentId, string $signature): bool
    {
        $c = $this->creds();
        $expected = hash_hmac('sha256', $orderId.'|'.$paymentId, $c['key_secret']);
        return hash_equals($expected, $signature);
    }

    public function parseWebhook(Request $request): ?array
    {
        $c = config('billing.razorpay');
        $secret = $c['webhook_secret'] ?? null;
        $signature = $request->header('X-Razorpay-Signature');
        $body = $request->getContent();

        if (! $secret || ! $signature
            || ! hash_equals(hash_hmac('sha256', $body, $secret), $signature)) {
            return null;   // bad/missing signature
        }

        $event = $request->json()->all();
        $type = $event['event'] ?? '';
        $eventId = $request->header('X-Razorpay-Event-Id') ?: ($event['id'] ?? md5($body));

        $payment = data_get($event, 'payload.payment.entity');
        $subscription = data_get($event, 'payload.subscription.entity');

        return [
            'event_id' => $eventId,
            'type' => $type,
            'provider_subscription_id' => $subscription['id'] ?? null,
            'provider_payment_id' => $payment['id'] ?? null,
            'amount_inr' => isset($payment['amount']) ? (int) round($payment['amount'] / 100) : null,
            'status' => $payment['status'] ?? ($subscription['status'] ?? null),
            'user_id' => (int) (data_get($payment, 'notes.user_id') ?: 0) ?: null,
            'plan_key' => data_get($payment, 'notes.plan_key'),
        ];
    }
}
