<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $fillable = [
        'name', 'price_inr', 'daily_credit_limit', 'monthly_credit_limit',
        'per_action_weights', 'features', 'is_active',
    ];

    protected $casts = [
        'per_action_weights' => 'array',
        'features' => 'array',
        'is_active' => 'boolean',
    ];

    /** Credit weight for an action type (token spec §5). */
    public function weightFor(string $action): float
    {
        $defaults = ['chat' => 1, 'assess_gen' => 3, 'grade' => 1, 'gap' => 1, 'plan' => 1, 'report' => 2];
        return (float) (($this->per_action_weights[$action] ?? null) ?? ($defaults[$action] ?? 1));
    }
}
