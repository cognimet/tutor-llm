<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $fillable = [
        'key', 'name', 'price_inr', 'billing_period', 'tier', 'provider_price_id',
        'daily_credit_limit', 'monthly_credit_limit', 'per_action_weights',
        'is_active', 'is_public', 'family_seats', 'sort_order',
    ];

    protected $casts = [
        'per_action_weights' => 'array',
        'is_active' => 'boolean',
        'is_public' => 'boolean',
    ];

    public function subscriptions() { return $this->hasMany(Subscription::class); }

    /** Credit weight for an action type (default 1). */
    public function weightFor(string $action): float
    {
        return (float) ($this->per_action_weights[$action] ?? 1);
    }

    /** A free plan is ₹0 and routed to zero-cost inference. */
    public function isFree(): bool
    {
        return (int) $this->price_inr === 0 || $this->tier === 'free';
    }

    /** Does this plan also cover the owner's linked children? */
    public function isFamily(): bool
    {
        return (int) ($this->family_seats ?? 0) > 0;
    }
}
