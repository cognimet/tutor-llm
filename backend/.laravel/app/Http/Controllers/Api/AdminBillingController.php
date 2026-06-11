<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CreditGrant;
use App\Models\ModelRate;
use App\Models\Plan;
use App\Models\TokenLedger;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Admin "AI usage & billing" portal (token spec §6): usage with real ₹ cost,
 * plan editing without redeploy, model rates, credit grants.
 */
class AdminBillingController extends Controller
{
    // Usage dashboard: trend, by action, top consumers, totals.
    public function usage(Request $request)
    {
        $days = min(90, max(7, (int) $request->query('days', 30)));
        $since = now()->subDays($days)->startOfDay();

        $dayExpr = DB::connection()->getDriverName() === 'sqlite'
            ? "strftime('%Y-%m-%d', created_at)"
            : "to_char(created_at, 'YYYY-MM-DD')";

        $trend = TokenLedger::where('created_at', '>=', $since)
            ->selectRaw("{$dayExpr} as day,
                SUM(prompt_tokens + completion_tokens) as tokens,
                SUM(credits_charged) as credits,
                SUM(cost_inr) as cost_inr,
                COUNT(*) as calls")
            ->groupBy('day')->orderBy('day')->get();

        $byAction = TokenLedger::where('created_at', '>=', $since)
            ->selectRaw('action_type,
                SUM(prompt_tokens + completion_tokens) as tokens,
                SUM(credits_charged) as credits,
                SUM(cost_inr) as cost_inr,
                COUNT(*) as calls')
            ->groupBy('action_type')->orderByDesc('cost_inr')->get();

        $byModel = TokenLedger::where('created_at', '>=', $since)
            ->selectRaw('model,
                SUM(prompt_tokens) as prompt_tokens,
                SUM(completion_tokens) as completion_tokens,
                SUM(cost_inr) as cost_inr,
                COUNT(*) as calls')
            ->groupBy('model')->get();

        $topConsumers = TokenLedger::where('token_ledger.created_at', '>=', $since)
            ->join('users', 'users.id', '=', 'token_ledger.user_id')
            ->selectRaw('users.id, users.name, users.email,
                SUM(credits_charged) as credits,
                SUM(cost_inr) as cost_inr,
                COUNT(*) as calls')
            ->groupBy('users.id', 'users.name', 'users.email')
            ->orderByDesc('cost_inr')->take(10)->get();

        return response()->json([
            'days' => $days,
            'totals' => [
                'tokens' => (int) TokenLedger::where('created_at', '>=', $since)
                    ->sum(DB::raw('prompt_tokens + completion_tokens')),
                'credits' => (float) TokenLedger::where('created_at', '>=', $since)->sum('credits_charged'),
                'cost_inr' => round((float) TokenLedger::where('created_at', '>=', $since)->sum('cost_inr'), 2),
                'calls' => TokenLedger::where('created_at', '>=', $since)->count(),
            ],
            'trend' => $trend,
            'by_action' => $byAction,
            'by_model' => $byModel,
            'top_consumers' => $topConsumers,
        ]);
    }

    /* ----------------------------- plans ----------------------------- */

    public function plans()
    {
        return response()->json(['plans' => Plan::orderBy('price_inr')->get()]);
    }

    public function storePlan(Request $request)
    {
        $data = $this->validatePlan($request);
        return response()->json(['plan' => Plan::create($data)], 201);
    }

    public function updatePlan(Request $request, Plan $plan)
    {
        $data = $this->validatePlan($request, $plan->id);
        $plan->update($data);
        return response()->json(['plan' => $plan]);
    }

    protected function validatePlan(Request $request, ?int $ignoreId = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:60', 'unique:plans,name' . ($ignoreId ? ",{$ignoreId}" : '')],
            'price_inr' => ['nullable', 'integer', 'min:0'],
            'daily_credit_limit' => ['required', 'integer', 'min:0'],
            'monthly_credit_limit' => ['required', 'integer', 'min:0'],
            'per_action_weights' => ['nullable', 'array'],
            'features' => ['nullable', 'array'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    /* -------------------------- model rates -------------------------- */

    public function modelRates()
    {
        return response()->json(['rates' => ModelRate::orderByDesc('effective_from')->get()]);
    }

    public function storeModelRate(Request $request)
    {
        $data = $request->validate([
            'model' => ['required', 'string', 'max:80'],
            'input_rate_per_1k' => ['required', 'numeric', 'min:0'],
            'output_rate_per_1k' => ['required', 'numeric', 'min:0'],
            'currency' => ['nullable', 'string', 'max:8'],
        ]);
        $data['effective_from'] = now();

        return response()->json(['rate' => ModelRate::create($data)], 201);
    }

    /* ------------------------- credit grants ------------------------- */

    // Give a student bonus credits (support, promo, apology) — audit-trailed.
    public function grantCredits(Request $request, User $user)
    {
        abort_unless($user->isStudent(), 422, 'Credits can only be granted to students.');

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.5', 'max:10000'],
            'reason' => ['nullable', 'string', 'max:200'],
            'expires_in_days' => ['nullable', 'integer', 'min:1', 'max:365'],
        ]);

        $grant = CreditGrant::create([
            'user_id' => $user->id,
            'amount' => $data['amount'],
            'reason' => $data['reason'] ?? null,
            'granted_by' => $request->user()->id,
            'expires_at' => isset($data['expires_in_days']) ? now()->addDays($data['expires_in_days']) : null,
        ]);

        return response()->json(['grant' => $grant], 201);
    }
}
