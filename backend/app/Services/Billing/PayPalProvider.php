<?php

namespace App\Services\Billing;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * PayPal adapter (international, USD). Uses Orders v2 with PayPal Smart Buttons:
 * the client creates an order via us, approves in the PayPal popup, then we
 * capture server-side and activate. custom_id carries "user_id:plan_key" so
 * both the capture and the webhook can activate the right subscription.
 *
 * Plans are priced in INR; PayPal charges USD (config billing.inr_per_usd).
 * Requires PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID.
 */
class PayPalProvider implements BillingProvider
{
    public function key(): string
    {
        return 'paypal';
    }

    protected function cfg(): array
    {
        $c = config('billing.paypal');
        if (empty($c['client_id']) || empty($c['client_secret'])) {
            throw new RuntimeException('PayPal is not configured (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).');
        }
        return $c;
    }

    /** OAuth2 access token (client-credentials). */
    protected function token(): string
    {
        $c = $this->cfg();
        $res = Http::asForm()->withBasicAuth($c['client_id'], $c['client_secret'])
            ->post($c['api_base'].'/v1/oauth2/token', ['grant_type' => 'client_credentials']);
        if (! $res->successful()) {
            throw new RuntimeException('PayPal auth failed: '.$res->body());
        }
        return $res->json('access_token');
    }

    /** INR price → market-friendly USD amount string (2 dp). */
    public function usdAmount(Plan $plan): string
    {
        return number_format(Pricing::usd((int) $plan->price_inr), 2, '.', '');
    }

    /** Create a PayPal order; returns the client payload for Smart Buttons. */
    public function createCheckout(User $user, Plan $plan): array
    {
        $c = $this->cfg();
        if ($plan->isFree()) {
            return ['auto_confirm' => true, 'amount_inr' => 0,
                'provider_subscription_id' => null, 'provider_payment_id' => null, 'client' => ['mode' => 'free']];
        }

        $amount = $this->usdAmount($plan);
        $res = Http::withToken($this->token())->acceptJson()
            ->post($c['api_base'].'/v2/checkout/orders', [
                'intent' => 'CAPTURE',
                'purchase_units' => [[
                    'custom_id' => $user->id.':'.$plan->key,
                    'description' => 'AI Tutor — '.$plan->name,
                    'amount' => ['currency_code' => $c['currency'], 'value' => $amount],
                ]],
            ]);
        if (! $res->successful()) {
            throw new RuntimeException('PayPal order creation failed: '.$res->body());
        }

        return [
            'auto_confirm' => false,
            'amount_inr' => (int) $plan->price_inr,
            'provider_subscription_id' => null,
            'provider_payment_id' => $res->json('id'),
            'client' => [
                'mode' => 'paypal',
                'order_id' => $res->json('id'),
                'client_id' => $c['client_id'],
                'currency' => $c['currency'],
                'amount_usd' => $amount,
            ],
        ];
    }

    /**
     * Capture an approved order. Returns a normalized activation context
     * (user_id, plan_key, payment id, amount) or null if not completed.
     */
    public function captureOrder(string $orderId): ?array
    {
        $c = $this->cfg();
        $res = Http::withToken($this->token())->acceptJson()
            ->post($c['api_base']."/v2/checkout/orders/{$orderId}/capture", (object) []);
        if (! $res->successful()) {
            throw new RuntimeException('PayPal capture failed: '.$res->body());
        }
        $data = $res->json();
        if (($data['status'] ?? '') !== 'COMPLETED') {
            return null;
        }

        $pu = $data['purchase_units'][0] ?? [];
        $capture = data_get($pu, 'payments.captures.0', []);
        [$userId, $planKey] = array_pad(explode(':', (string) ($pu['custom_id'] ?? '')), 2, null);

        return [
            'user_id' => (int) $userId ?: null,
            'plan_key' => $planKey,
            'provider_payment_id' => $capture['id'] ?? $orderId,
            'amount' => data_get($capture, 'amount.value'),
        ];
    }

    /** Verify + normalise a PayPal webhook via the verify-signature API. */
    public function parseWebhook(Request $request): ?array
    {
        $c = config('billing.paypal');
        if (empty($c['client_id']) || empty($c['webhook_id'])) {
            return null;
        }
        $event = $request->json()->all();

        $verify = Http::withToken($this->token())->acceptJson()
            ->post($c['api_base'].'/v1/notifications/verify-webhook-signature', [
                'auth_algo' => $request->header('paypal-auth-algo'),
                'cert_url' => $request->header('paypal-cert-url'),
                'transmission_id' => $request->header('paypal-transmission-id'),
                'transmission_sig' => $request->header('paypal-transmission-sig'),
                'transmission_time' => $request->header('paypal-transmission-time'),
                'webhook_id' => $c['webhook_id'],
                'webhook_event' => $event,
            ]);

        if (! $verify->successful() || $verify->json('verification_status') !== 'SUCCESS') {
            return null;
        }

        $type = $event['event_type'] ?? '';
        $resource = $event['resource'] ?? [];
        [$userId, $planKey] = array_pad(explode(':', (string) ($resource['custom_id'] ?? '')), 2, null);

        return [
            'event_id' => $event['id'] ?? md5($request->getContent()),
            'type' => $type,
            'provider_subscription_id' => null,
            'provider_payment_id' => $resource['id'] ?? null,
            'amount_inr' => null,
            'status' => $resource['status'] ?? null,
            'user_id' => (int) $userId ?: null,
            'plan_key' => $planKey,
        ];
    }
}
