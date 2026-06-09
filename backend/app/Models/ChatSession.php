<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ChatSession extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'title',
        'subject_name', 'chapter_name', 'topic_name', 'last_message_at',
    ];

    protected $casts = ['last_message_at' => 'datetime'];

    public function user()     { return $this->belongsTo(User::class); }
    public function topic()    { return $this->belongsTo(Topic::class); }
    public function messages() { return $this->hasMany(ChatMessage::class)->orderBy('id'); }
}
