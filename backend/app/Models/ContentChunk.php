<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ContentChunk extends Model
{
    protected $fillable = ['topic_id', 'type', 'body', 'source_ref', 'indexed_at'];

    protected $casts = ['indexed_at' => 'datetime'];

    public function topic()
    {
        return $this->belongsTo(Topic::class);
    }
}
