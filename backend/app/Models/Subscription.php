<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Subscription extends Model
{
    protected $fillable = ['user_id', 'plan_id', 'status', 'started_at', 'renews_at', 'provider_ref'];

    protected $casts = ['started_at' => 'datetime', 'renews_at' => 'datetime'];

    public function plan() { return $this->belongsTo(Plan::class); }
    public function user() { return $this->belongsTo(User::class); }
}
