<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KnowledgeGap extends Model
{
    protected $fillable = [
        'user_id', 'assessment_id', 'topic_name', 'concept',
        'severity', 'recommendation', 'resolved',
    ];

    protected $casts = ['resolved' => 'boolean'];

    public function user() { return $this->belongsTo(User::class); }
}
