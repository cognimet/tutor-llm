<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TopicNote extends Model
{
    protected $fillable = [
        'user_id', 'topic_id', 'topic_name',
        'scope', 'subject_id', 'subject_name', 'chapter_id', 'chapter_name', 'is_primary',
        'title', 'original_filename',
        'mime', 'kind', 'size_bytes', 'disk', 'path',
        'extracted_text', 'summary', 'status', 'meta',
    ];

    protected $casts = ['meta' => 'array', 'size_bytes' => 'integer', 'is_primary' => 'boolean'];

    public function user()    { return $this->belongsTo(User::class); }
    public function topic()   { return $this->belongsTo(Topic::class); }
    public function subject() { return $this->belongsTo(Subject::class); }
    public function chapter() { return $this->belongsTo(Chapter::class); }
}
