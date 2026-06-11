<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ModelRate extends Model
{
    protected $fillable = [
        'model', 'input_rate_per_1k', 'output_rate_per_1k', 'currency', 'effective_from',
    ];

    protected $casts = ['effective_from' => 'date'];

    /** Latest effective rate row for a model, or null. */
    public static function current(string $model): ?self
    {
        return static::where('model', $model)
            ->where('effective_from', '<=', now()->toDateString())
            ->orderByDesc('effective_from')
            ->first();
    }
}
