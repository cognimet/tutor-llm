<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TokenLedger extends Model
{
    public $timestamps = false;          // created_at set by the DB
    protected $table = 'token_ledger';

    protected $fillable = [
        'user_id', 'action_type', 'model', 'prompt_tokens', 'completion_tokens',
        'total_tokens', 'credits_charged', 'cost_inr', 'mock', 'meta', 'created_at',
    ];

    protected $casts = [
        'meta' => 'array',
        'mock' => 'boolean',
        'created_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
