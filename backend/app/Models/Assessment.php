<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Assessment extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'chat_session_id', 'topic_name',
        'status', 'score', 'total', 'completed_at',
    ];

    protected $casts = ['completed_at' => 'datetime'];

    public function user()      { return $this->belongsTo(User::class); }
    public function questions() { return $this->hasMany(AssessmentQuestion::class)->orderBy('position'); }
    public function gaps()      { return $this->hasMany(KnowledgeGap::class); }
}
