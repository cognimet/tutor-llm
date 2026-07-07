<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    protected $fillable = [
        'subscription_id', 'user_id', 'provider', 'provider_payment_id',
        'amount_inr', 'currency', 'status', 'method', 'meta',
    ];

    protected $casts = ['meta' => 'array'];

    public function subscription() { return $this->belongsTo(Subscription::class); }
    public function user()         { return $this->belongsTo(User::class); }
}
