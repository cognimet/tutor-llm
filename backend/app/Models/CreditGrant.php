<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CreditGrant extends Model
{
    protected $fillable = ['user_id', 'amount', 'reason', 'granted_by', 'expires_at'];

    protected $casts = ['expires_at' => 'datetime'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
