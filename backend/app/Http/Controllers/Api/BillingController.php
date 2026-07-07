<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Billing\SubscriptionService;
use App\Services\TokenMeter;
use Illuminate\Http\Request;

/**
 * Self-serve billing for individuals & families. Students/parents see plans as
 * simple tiers with credit allowances; raw ₹ cost/tokens stay in the admin
 * console. The webhook is public (signature-verified); everything else is
 * behind auth.
 */
class BillingController extends Controller
{
    public function __construct(
        protected SubscriptionService $subs,
        protected TokenMeter $meter,
    ) {}

    /** Benefit copy per tier root — truthful to real app capabilities. */
    private const PERKS = [
        'free' => [
            'tagline' => 'Start learning, free forever',
            'best_for' => 'Casual practice',
            'highlights' => [
                'AI tutor for everyday doubts',
                'Auto-graded quizzes with instant feedback',
                'Mastery & streak tracking',
            ],
        ],
        'plus' => [
            'tagline' => 'For serious daily learners',
            'best_for' => 'Exam prep',
            'highlights' => [
                'Priority AI — Gemini 2.5, faster & sharper',
                '~33 questions every single day',
                'Solve from photos & handwritten notes',
                'Personalised study plans that adapt to you',
                'Deep analytics & weak-spot alerts',
                'Cancel anytime — no lock-in',
            ],
        ],
        'family' => [
            'tagline' => 'One plan for the whole family',
            'best_for' => 'Parents with 2+ kids',
            'highlights' => [
                'Everything in Plus, for each child',
                'Covers up to 5 children on one plan',
                'One simple bill for the household',
                'Per-child progress reports for parents',
            ],
        ],
    ];

    /** GET /api/billing/plans — purchasable tiers + the caller's current plan. */
    public function plans(Request $request)
    {
        $current = $this->meter->planFor($request->user());
        $all = $this->subs->purchasablePlans();

        $freeMonthly = max(1, (int) optional($all->firstWhere('key', 'free'))->monthly_credit_limit);
        $monthlyPrice = $all->where('billing_period', 'month')->mapWithKeys(fn ($p) => [$p->key => (int) $p->price_inr]);

        $plans = $all->map(function ($p) use ($current, $freeMonthly, $monthlyPrice) {
            $root = str_replace('_annual', '', $p->key);
            $perks = self::PERKS[$root] ?? ['tagline' => '', 'best_for' => '', 'highlights' => []];

            // Annual saving vs paying monthly for a year.
            $savings = null;
            if ($p->billing_period === 'year' && ($mp = $monthlyPrice[$root] ?? null) && $mp > 0) {
                $savings = (int) round((1 - $p->price_inr / ($mp * 12)) * 100);
            }
            // How much more usage than Free (a catchy, true multiplier).
            $vsFree = $p->price_inr > 0 ? (int) round($p->monthly_credit_limit / $freeMonthly) : null;

            return [
                'key' => $p->key,
                'name' => $p->name,
                'price_inr' => (int) $p->price_inr,
                'price_usd' => \App\Services\Billing\Pricing::usd((int) $p->price_inr),
                'billing_period' => $p->billing_period,
                'monthly_credits' => (int) $p->monthly_credit_limit,
                'daily_credits' => (int) $p->daily_credit_limit,
                'family_seats' => $p->family_seats,
                'is_current' => $p->id === $current->id,
                'tagline' => $perks['tagline'],
                'best_for' => $perks['best_for'],
                'highlights' => $perks['highlights'],
                'badge' => $savings ? "Save {$savings}%" : ($root === 'plus' ? 'Most popular' : null),
                'savings_pct' => $savings,
                'vs_free' => $vsFree,
            ];
        });

        // Which payment methods are configured (drives the checkout chooser).
        $providers = [];
        if (config('billing.razorpay.key_id')) {
            $providers[] = ['key' => 'razorpay', 'label' => 'UPI / Cards / NetBanking', 'currency' => 'INR'];
        }
        if (config('billing.paypal.client_id')) {
            $providers[] = ['key' => 'paypal', 'label' => 'PayPal', 'currency' => config('billing.paypal.currency', 'USD')];
        }
        if (empty($providers)) {
            $providers[] = ['key' => 'manual', 'label' => 'Activate (dev)', 'currency' => 'INR'];
        }

        return response()->json([
            'plans' => $plans,
            'current_plan' => $current->only('key', 'name'),
            'subscription' => $this->subs->present($request->user()->activeSubscription()),
            'credit_costs' => $this->creditCosts($current),
            'providers' => $providers,
            'paypal_client_id' => config('billing.paypal.client_id'),
        ]);
    }

    /** What each action costs in credits (from the plan's per-action weights). */
    protected function creditCosts(\App\Models\Plan $plan): array
    {
        $labels = [
            'chat' => 'Ask the tutor a question',
            'assess_gen' => 'Generate a quiz',
            'grade' => 'Grade an answer',
            'snap' => 'Snap-a-doubt (photo)',
            'plan' => 'Build a study plan',
            'gap' => 'Analyse a knowledge gap',
            'notes' => 'Add a notes page (with images)',
        ];
        $out = [];
        foreach ($labels as $action => $label) {
            $out[] = ['action' => $action, 'label' => $label, 'credits' => (int) $plan->weightFor($action)];
        }
        return $out;
    }

    /** GET /api/billing/subscription — the caller's current subscription state. */
    public function subscription(Request $request)
    {
        return response()->json([
            'subscription' => $this->subs->present($request->user()->activeSubscription()),
            'current_plan' => $this->meter->planFor($request->user())->only('key', 'name'),
        ]);
    }

    /** POST /api/billing/checkout {plan_key, provider} — start (and, for manual/free, finish) a purchase. */
    public function checkout(Request $request)
    {
        $data = $request->validate([
            'plan_key' => 'required|string|exists:plans,key',
            'provider' => 'nullable|in:razorpay,paypal,manual',
        ]);
        $result = $this->subs->checkout($request->user(), $data['plan_key'], $data['provider'] ?? null);

        return response()->json($result, $result['status'] === 'active' ? 201 : 200);
    }

    /** POST /api/billing/razorpay/verify — confirm a Razorpay Checkout success. */
    public function razorpayVerify(Request $request)
    {
        $data = $request->validate([
            'plan_key' => 'required|string|exists:plans,key',
            'order_id' => 'required|string',
            'payment_id' => 'required|string',
            'signature' => 'required|string',
        ]);

        return response()->json($this->subs->captureRazorpay(
            $request->user(), $data['plan_key'], $data['order_id'], $data['payment_id'], $data['signature']
        ), 201);
    }

    /** POST /api/billing/paypal/capture {order_id} — capture an approved PayPal order. */
    public function paypalCapture(Request $request)
    {
        $data = $request->validate(['order_id' => 'required|string']);

        return response()->json($this->subs->capturePaypal($request->user(), $data['order_id']), 201);
    }

    /** POST /api/billing/cancel — cancel at period end (keeps access until then). */
    public function cancel(Request $request)
    {
        $sub = $this->subs->cancel($request->user());
        abort_if($sub === null, 422, 'No active subscription to cancel.');

        return response()->json(['subscription' => $this->subs->present($sub->fresh())]);
    }

    /** POST /api/billing/webhook/{provider} — provider callback (public, signature-verified). */
    public function webhook(Request $request, string $provider)
    {
        $result = $this->subs->handleWebhook($request, $provider);

        // Always 200 for a verified+deduped event; 400 only on bad signature so
        // the provider retries a genuinely failed delivery.
        return response()->json($result, ($result['ok'] ?? false) ? 200 : 400);
    }
}
