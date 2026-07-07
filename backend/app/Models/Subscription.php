<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class Subscription extends Model
{
    protected $fillable = [
        'user_id', 'school_id', 'plan_id', 'status', 'provider',
        'provider_subscription_id', 'provider_customer_id', 'seats',
        'trial_ends_at', 'current_period_start', 'current_period_end',
        'cancel_at', 'canceled_at', 'meta',
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime',
        'current_period_start' => 'datetime',
        'current_period_end' => 'datetime',
        'cancel_at' => 'datetime',
        'canceled_at' => 'datetime',
        'meta' => 'array',
    ];

    /** Statuses that still grant the plan (access stays through dunning/grace). */
    public const ENTITLED = ['trialing', 'active', 'past_due', 'grace'];

    public function plan()    { return $this->belongsTo(Plan::class); }
    public function user()    { return $this->belongsTo(User::class); }
    public function school()  { return $this->belongsTo(School::class); }
    public function payments() { return $this->hasMany(Payment::class); }

    /** Is this subscription currently entitling its plan? */
    public function isEntitled(): bool
    {
        if (! in_array($this->status, self::ENTITLED, true)) {
            return false;
        }
        // A period that has fully lapsed no longer entitles (guards stale rows).
        return $this->current_period_end === null || $this->current_period_end->gt(Carbon::now());
    }
}
