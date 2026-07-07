<?php

namespace Database\Seeders;

use App\Models\ModelRate;
use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * Plans + model rates — priced to never lose money on Gemini.
 *
 * Credit economics (see config/billing.php):
 *   - 1 credit ≈ ₹0.15 worst-case Gemini cost (chat, the most expensive action,
 *     with headroom). Weights are set so NO action is cheaper-per-credit than
 *     chat, so a credit can never cost more than that anchor.
 *   - Every paid plan's monthly cap is derived as price × 0.30 ÷ ₹0.15, i.e.
 *     COGS ≤ 30 % of revenue at 100 % utilisation → ≥ 70 % worst-case margin.
 *   - Free is routed to zero-cost inference (tier=free) and hard-capped, so it
 *     is a bounded acquisition cost, never a runaway loss.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        // Re-weighted to real cost: chat is the anchor (1); nothing is cheaper
        // per credit. notes=2 for vision headroom.
        $weights = [
            'chat'       => 1,
            'assess_gen' => 1,
            'grade'      => 1,
            'gap'        => 1,
            'plan'       => 1,
            'notes'      => 2,
            'snap'       => 1,
        ];

        $base = ['per_action_weights' => $weights, 'is_active' => true];

        // key => [name, price, period, tier, daily, monthly, public, family_seats, sort]
        $plans = [
            ['free',          'Free',            0,    'month', 'free', 30,  300,  true,  null, 0],
            ['plus',          'Plus',            499,  'month', 'paid', 150, 1000, true,  null, 1],
            ['plus_annual',   'Plus (annual)',   3999, 'year',  'paid', 150, 1000, true,  null, 2],
            ['family',        'Family',          899,  'month', 'paid', 200, 1800, true,  5,    3],
            ['family_annual', 'Family (annual)', 8999, 'year',  'paid', 200, 1800, true,  5,    4],
            // School = per-seat/year, sold (not self-serve). Cap is per student.
            ['school',        'School',          999,  'year',  'paid', 40,  165,  false, null, 5],
        ];

        foreach ($plans as [$key, $name, $price, $period, $tier, $daily, $monthly, $public, $seats, $sort]) {
            Plan::updateOrCreate(['key' => $key], $base + [
                'name' => $name,
                'price_inr' => $price,
                'billing_period' => $period,
                'tier' => $tier,
                'daily_credit_limit' => $daily,
                'monthly_credit_limit' => $monthly,
                'is_public' => $public,
                'family_seats' => $seats,
                'sort_order' => $sort,
            ]);
        }

        // Indicative ₹/1K-token rates for cost accounting (admin-editable).
        $rates = [
            'gemini-2.5-flash'      => ['in' => 0.026, 'out' => 0.105],
            'gemini-2.5-flash-lite' => ['in' => 0.010, 'out' => 0.040],
            'gpt-4o-mini'           => ['in' => 0.013, 'out' => 0.052],
            'claude-sonnet-4-5'     => ['in' => 0.260, 'out' => 1.300],
        ];
        foreach ($rates as $model => $r) {
            ModelRate::updateOrCreate(
                ['model' => $model, 'effective_from' => '2026-01-01'],
                ['input_rate_per_1k' => $r['in'], 'output_rate_per_1k' => $r['out'], 'currency' => 'INR'],
            );
        }
    }
}
