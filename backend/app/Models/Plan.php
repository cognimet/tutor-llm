<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $fillable = [
        'key', 'name', 'price_inr', 'daily_credit_limit',
        'monthly_credit_limit', 'per_action_weights', 'is_active',
    ];

    protected $casts = [
        'per_action_weights' => 'array',
        'is_active' => 'boolean',
    ];

    /** Credit weight for an action type (default 1). */
    public function weightFor(string $action): float
    {
        return (float) ($this->per_action_weights[$action] ?? 1);
    }
}
