<?php

namespace App\Services;

use App\Models\CreditGrant;
use App\Models\ModelRate;
use App\Models\Plan;
use App\Models\TokenLedger;
use App\Models\UsageCounter;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Token management (AI_Tutor_Token_Management.md).
 *
 * Two control points, both mandatory:
 *   gate()  — pre-call: check plan quota, block with an upsell payload (402).
 *   meter() — post-call: write the token_ledger row with REAL token counts
 *             from the AI service and bump live usage counters.
 *
 * Students see credits, never raw tokens. Credits are decoupled from real
 * cost (cost_inr) so models can be swapped without changing user plans.
 */
class TokenMeter
{
    /** The student's active plan (active subscription, else the Free plan). */
    public function planFor(User $user): Plan
    {
        $plan = $user->subscriptions()
            ->where('status', 'active')
            ->latest('id')
            ->with('plan')
            ->first()?->plan;

        return $plan
            ?? Plan::where('name', 'Free')->first()
            ?? new Plan([
                'name' => 'Free', 'daily_credit_limit' => 30, 'monthly_credit_limit' => 600,
            ]);
    }

    /**
     * Pre-call gate. Returns null when allowed, or a quota_exceeded payload
     * the controller should send back with HTTP 402.
     */
    public function gate(User $user, string $action): ?array
    {
        if (! $user->isStudent()) {
            return null; // only student actions are credit-metered
        }

        $plan = $this->planFor($user);
        $weight = $plan->weightFor($action);

        $daily = $this->counter($user, 'daily_credits', now()->toDateString());
        $monthly = $this->counter($user, 'monthly_credits', now()->format('Y-m'));
        $bonus = $this->activeGrantBalance($user);

        if ($daily + $weight > $plan->daily_credit_limit + $bonus) {
            return $this->blockedPayload($plan, 'daily', $daily);
        }
        if ($monthly + $weight > $plan->monthly_credit_limit + $bonus) {
            return $this->blockedPayload($plan, 'monthly', $monthly);
        }

        return null;
    }

    /**
     * Post-call meter: compute credits + real cost, write the ledger,
     * bump the live counters. $usage = {prompt_tokens, completion_tokens, model}.
     */
    public function meter(User $user, string $action, array $usage, ?int $chatSessionId = null): void
    {
        $plan = $this->planFor($user);
        $credits = $plan->weightFor($action);

        $prompt = (int) ($usage['prompt_tokens'] ?? 0);
        $completion = (int) ($usage['completion_tokens'] ?? 0);
        $model = (string) ($usage['model'] ?? '');

        $cost = 0.0;
        if ($rate = ModelRate::latestFor($model)) {
            $cost = ($prompt / 1000) * (float) $rate->input_rate_per_1k
                  + ($completion / 1000) * (float) $rate->output_rate_per_1k;
        }

        TokenLedger::create([
            'user_id' => $user->id,
            'chat_session_id' => $chatSessionId,
            'action_type' => $action,
            'model' => $model ?: null,
            'prompt_tokens' => $prompt,
            'completion_tokens' => $completion,
            'credits_charged' => $credits,
            'cost_inr' => round($cost, 4),
        ]);

        $this->bump($user, 'daily_credits', now()->toDateString(), $credits);
        $this->bump($user, 'monthly_credits', now()->format('Y-m'), $credits);
    }

    /** Student-facing meter widget payload: credits, never raw tokens (§7). */
    public function summary(User $user): array
    {
        $plan = $this->planFor($user);
        $daily = $this->counter($user, 'daily_credits', now()->toDateString());
        $monthly = $this->counter($user, 'monthly_credits', now()->format('Y-m'));
        $bonus = $this->activeGrantBalance($user);

        return [
            'plan' => $plan->name,
            'daily' => [
                'used' => round($daily, 1),
                'limit' => $plan->daily_credit_limit + $bonus,
                'resets_at' => now()->endOfDay()->toIso8601String(),
            ],
            'monthly' => [
                'used' => round($monthly, 1),
                'limit' => $plan->monthly_credit_limit + $bonus,
            ],
            'bonus_credits' => $bonus,
        ];
    }

    /* ------------------------------------------------------------------ */

    protected function counter(User $user, string $metric, string $period): float
    {
        return (float) UsageCounter::where('user_id', $user->id)
            ->where('metric', $metric)
            ->where('period_key', $period)
            ->value('value');
    }

    protected function bump(User $user, string $metric, string $period, float $by): void
    {
        // Atomic upsert-and-increment (works on SQLite + Postgres).
        DB::transaction(function () use ($user, $metric, $period, $by) {
            $row = UsageCounter::lockForUpdate()->firstOrCreate(
                ['user_id' => $user->id, 'metric' => $metric, 'period_key' => $period],
                ['value' => 0],
            );
            $row->update(['value' => (float) $row->value + $by]);
        });
    }

    protected function activeGrantBalance(User $user): float
    {
        return (float) CreditGrant::where('user_id', $user->id)
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->sum('amount');
    }

    protected function blockedPayload(Plan $plan, string $period, float $used): array
    {
        $msg = $period === 'daily'
            ? "You've used today's AI learning credits. Come back tomorrow — or upgrade for more."
            : "You've reached this month's AI credit limit. Upgrade to keep the streak going.";

        return [
            'error' => 'quota_exceeded',
            'period' => $period,
            'message' => $msg,
            'plan' => $plan->name,
            'used' => round($used, 1),
            'upsell' => [
                'title' => 'Keep learning without limits',
                'options' => Plan::where('is_active', true)
                    ->where('name', '!=', $plan->name)
                    ->get(['name', 'price_inr', 'daily_credit_limit', 'monthly_credit_limit']),
            ],
        ];
    }
}
