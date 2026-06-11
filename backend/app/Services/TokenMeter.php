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
 * Token metering & quota enforcement.
 *
 * Two layers, kept separate by design:
 *   - real LLM tokens (from the AI service's `usage`) -> token_ledger + cost_inr
 *   - student-facing credits (abstract units)         -> plans + usage_counters
 *
 * Flow: TokenGate middleware calls check() BEFORE the AI call (block + upsell
 * if over quota); TutorService calls record() AFTER with real usage. Counters
 * live in the DB for the MVP (atomic upsert+increment); mirror to Redis later
 * for the hot path without changing callers.
 */
class TokenMeter
{
    /** Resolve the user's plan (null plan_id => the 'free' plan). */
    public function planFor(User $user): Plan
    {
        if ($user->plan_id && ($plan = Plan::find($user->plan_id))) {
            return $plan;
        }

        return Plan::where('key', 'free')->firstOrFail();
    }

    /**
     * Can this user afford this action right now?
     *
     * @return array{allowed: bool, reason: ?string, summary: array}
     */
    public function check(User $user, string $action): array
    {
        $plan = $this->planFor($user);
        $weight = $plan->weightFor($action);
        $summary = $this->summary($user, $plan);

        if ($summary['daily']['used'] + $weight > $summary['daily']['limit']) {
            return ['allowed' => false, 'reason' => 'daily_limit', 'summary' => $summary];
        }
        if ($summary['monthly']['used'] + $weight > $summary['monthly']['limit']) {
            return ['allowed' => false, 'reason' => 'monthly_limit', 'summary' => $summary];
        }

        return ['allowed' => true, 'reason' => null, 'summary' => $summary];
    }

    /**
     * Record a completed AI call: write the ledger row, bump counters.
     *
     * @param array $usage  ['model','prompt_tokens','completion_tokens','total_tokens','mock'] from AiClient
     */
    public function record(User $user, string $action, array $usage, array $meta = []): void
    {
        $plan = $this->planFor($user);
        $credits = $plan->weightFor($action);

        $prompt = (int) ($usage['prompt_tokens'] ?? 0);
        $completion = (int) ($usage['completion_tokens'] ?? 0);
        $model = $usage['model'] ?? null;

        $cost = 0.0;
        if ($model && ($rate = ModelRate::current($model))) {
            $cost = ($prompt / 1000) * (float) $rate->input_rate_per_1k
                  + ($completion / 1000) * (float) $rate->output_rate_per_1k;
        }

        TokenLedger::create([
            'user_id' => $user->id,
            'action_type' => $action,
            'model' => $model,
            'prompt_tokens' => $prompt,
            'completion_tokens' => $completion,
            'total_tokens' => (int) ($usage['total_tokens'] ?? $prompt + $completion),
            'credits_charged' => $credits,
            'cost_inr' => round($cost, 4),
            'mock' => (bool) ($usage['mock'] ?? false),
            'meta' => $meta ?: null,
            'created_at' => now(),
        ]);

        $this->increment($user, 'daily_credits', now()->toDateString(), $credits);
        $this->increment($user, 'monthly_credits', now()->format('Y-m'), $credits);
    }

    /** Usage summary for meters and dashboards. */
    public function summary(User $user, ?Plan $plan = null): array
    {
        $plan ??= $this->planFor($user);

        $dailyUsed = $this->counter($user, 'daily_credits', now()->toDateString());
        $monthlyUsed = $this->counter($user, 'monthly_credits', now()->format('Y-m'));

        // Non-expired grants made this month raise the monthly ceiling.
        $grants = (float) CreditGrant::where('user_id', $user->id)
            ->where('created_at', '>=', now()->startOfMonth())
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->sum('amount');

        return [
            'plan' => ['key' => $plan->key, 'name' => $plan->name],
            'daily' => [
                'used' => $dailyUsed,
                'limit' => (float) $plan->daily_credit_limit,
                'remaining' => max(0, $plan->daily_credit_limit - $dailyUsed),
                'resets' => now()->endOfDay()->toIso8601String(),
            ],
            'monthly' => [
                'used' => $monthlyUsed,
                'limit' => (float) $plan->monthly_credit_limit + $grants,
                'remaining' => max(0, $plan->monthly_credit_limit + $grants - $monthlyUsed),
                'granted' => $grants,
            ],
        ];
    }

    /* ------------------------------ internals ------------------------------ */

    protected function counter(User $user, string $metric, string $period): float
    {
        return (float) UsageCounter::where('user_id', $user->id)
            ->where('metric', $metric)
            ->where('period_key', $period)
            ->value('value') ?? 0.0;
    }

    protected function increment(User $user, string $metric, string $period, float $by): void
    {
        // Atomic upsert + increment (works on Postgres and SQLite).
        DB::transaction(function () use ($user, $metric, $period, $by) {
            $row = UsageCounter::lockForUpdate()->firstOrCreate(
                ['user_id' => $user->id, 'metric' => $metric, 'period_key' => $period],
                ['value' => 0],
            );
            $row->increment('value', $by);
        });
    }
}
