<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TopicNote extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'topic_name', 'title', 'original_filename',
        'mime', 'kind', 'size_bytes', 'disk', 'path',
        'extracted_text', 'summary', 'status', 'meta',
    ];

    protected $casts = ['meta' => 'array', 'size_bytes' => 'integer'];

    public function user()  { return $this->belongsTo(User::class); }
    public function topic() { return $this->belongsTo(Topic::class); }
}
