<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CreditGrant;
use App\Models\ModelRate;
use App\Models\Plan;
use App\Models\TokenLedger;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Admin: AI usage & billing. The only place raw tokens and ₹ cost are visible.
 */
class AdminUsageController extends Controller
{
    /**
     * GET /api/admin/usage?days=30
     * Platform usage: totals, by action, by model, top consumers, daily trend.
     */
    public function overview(Request $request)
    {
        $days = min(90, max(1, (int) $request->query('days', 30)));
        $since = now()->subDays($days);

        $base = TokenLedger::where('created_at', '>=', $since);

        $totals = (clone $base)->selectRaw(
            'COUNT(*) as calls, SUM(total_tokens) as tokens,
             SUM(credits_charged) as credits, SUM(cost_inr) as cost_inr'
        )->first();

        $byAction = (clone $base)->selectRaw(
            'action_type, COUNT(*) as calls, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr'
        )->groupBy('action_type')->orderByDesc('cost_inr')->get();

        $byModel = (clone $base)->selectRaw(
            'model, COUNT(*) as calls, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr'
        )->groupBy('model')->get();

        $topStudents = (clone $base)->selectRaw(
            'user_id, COUNT(*) as calls, SUM(credits_charged) as credits, SUM(cost_inr) as cost_inr'
        )->groupBy('user_id')->orderByDesc('cost_inr')->limit(10)->get()
            ->each(fn ($r) => $r->setAttribute('user', User::select('id', 'name', 'email')->find($r->user_id)));

        $daily = (clone $base)->selectRaw(
            "DATE(created_at) as day, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr"
        )->groupBy('day')->orderBy('day')->get();

        return response()->json([
            'period_days' => $days,
            'totals' => $totals,
            'by_action' => $byAction,
            'by_model' => $byModel,
            'top_students' => $topStudents,
            'daily' => $daily,
        ]);
    }

    /** GET /api/admin/users/{user}/usage — one student's ledger (paginated). */
    public function userLedger(User $user)
    {
        return response()->json([
            'user' => $user->only('id', 'name', 'email', 'role'),
            'ledger' => TokenLedger::where('user_id', $user->id)
                ->orderByDesc('created_at')->paginate(25),
        ]);
    }

    /* ---------------------------- Plans ---------------------------- */

    public function plans()
    {
        return response()->json(Plan::orderBy('price_inr')->get());
    }

    public function updatePlan(Request $request, Plan $plan)
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:100',
            'price_inr' => 'sometimes|integer|min:0',
            'daily_credit_limit' => 'sometimes|integer|min:0',
            'monthly_credit_limit' => 'sometimes|integer|min:0',
            'per_action_weights' => 'sometimes|array',
            'is_active' => 'sometimes|boolean',
        ]);
        $plan->update($data);

        return response()->json($plan->fresh());
    }

    /** PATCH /api/admin/users/{user}/plan — move a user to a plan. */
    public function setUserPlan(Request $request, User $user)
    {
        $data = $request->validate(['plan_key' => 'required|string|exists:plans,key']);
        $user->update(['plan_id' => Plan::where('key', $data['plan_key'])->value('id')]);

        return response()->json($user->only('id', 'name', 'plan_id'));
    }

    /* ------------------------- Credit grants ------------------------ */

    /** POST /api/admin/users/{user}/grant-credits */
    public function grantCredits(Request $request, User $user)
    {
        $data = $request->validate([
            'amount' => 'required|numeric|min:1|max:10000',
            'reason' => 'nullable|string|max:200',
            'expires_at' => 'nullable|date|after:now',
        ]);

        $grant = CreditGrant::create([
            'user_id' => $user->id,
            'amount' => $data['amount'],
            'reason' => $data['reason'] ?? null,
            'granted_by' => $request->user()->id,
            'expires_at' => $data['expires_at'] ?? null,
        ]);

        return response()->json($grant, 201);
    }

    /* -------------------------- Model rates ------------------------- */

    public function modelRates()
    {
        return response()->json(ModelRate::orderByDesc('effective_from')->get());
    }

    public function storeModelRate(Request $request)
    {
        $data = $request->validate([
            'model' => 'required|string|max:100',
            'input_rate_per_1k' => 'required|numeric|min:0',
            'output_rate_per_1k' => 'required|numeric|min:0',
            'currency' => 'sometimes|string|size:3',
            'effective_from' => 'required|date',
        ]);

        return response()->json(ModelRate::create($data), 201);
    }
}
