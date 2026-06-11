<?php

namespace Database\Seeders;

use App\Models\ModelRate;
use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * Default plans + model rates. Weights are a product lever: chat stays cheap
 * so the free tier feels generous; expensive actions (assessment generation,
 * notes ingestion) gate toward paid plans.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        $weights = [
            'chat'       => 1,
            'assess_gen' => 3,
            'grade'      => 1,
            'gap'        => 1,
            'plan'       => 1,
            'notes'      => 5,
        ];

        Plan::updateOrCreate(['key' => 'free'], [
            'name' => 'Free',
            'price_inr' => 0,
            'daily_credit_limit' => 30,
            'monthly_credit_limit' => 400,
            'per_action_weights' => $weights,
            'is_active' => true,
        ]);

        Plan::updateOrCreate(['key' => 'plus'], [
            'name' => 'Plus',
            'price_inr' => 499,
            'daily_credit_limit' => 200,
            'monthly_credit_limit' => 4000,
            'per_action_weights' => $weights,
            'is_active' => true,
        ]);

        Plan::updateOrCreate(['key' => 'family'], [
            'name' => 'Family',
            'price_inr' => 899,
            'daily_credit_limit' => 200,
            'monthly_credit_limit' => 4000,
            'per_action_weights' => $weights,
            'is_active' => true,
        ]);

        // Indicative pricing in INR per 1K tokens for the default model of each
        // supported provider (Gemini / OpenAI / Anthropic) — admin-editable, so
        // cost accounting works whichever provider the AI service is running.
        $rates = [
            'gemini-2.5-flash'  => ['in' => 0.026, 'out' => 0.105],
            'gpt-4o-mini'       => ['in' => 0.013, 'out' => 0.052],
            'claude-sonnet-4-5' => ['in' => 0.260, 'out' => 1.300],
        ];
        foreach ($rates as $model => $r) {
            ModelRate::updateOrCreate(
                ['model' => $model, 'effective_from' => '2026-01-01'],
                ['input_rate_per_1k' => $r['in'], 'output_rate_per_1k' => $r['out'], 'currency' => 'INR'],
            );
        }
    }
}
