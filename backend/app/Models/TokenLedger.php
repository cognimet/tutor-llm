<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Every billable AI call — the source of truth for cost (token spec §4). */
class TokenLedger extends Model
{
    protected $table = 'token_ledger';

    protected $fillable = [
        'user_id', 'chat_session_id', 'action_type', 'model',
        'prompt_tokens', 'completion_tokens', 'credits_charged', 'cost_inr',
    ];

    public function user() { return $this->belongsTo(User::class); }
}
