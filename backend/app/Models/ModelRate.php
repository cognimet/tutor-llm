<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ModelRate extends Model
{
    protected $fillable = ['model', 'input_rate_per_1k', 'output_rate_per_1k', 'currency', 'effective_from'];

    protected $casts = ['effective_from' => 'datetime'];

    /** Latest effective rate row for a model. */
    public static function latestFor(?string $model): ?self
    {
        if (! $model) return null;
        return static::where('model', $model)->orderByDesc('effective_from')->orderByDesc('id')->first();
    }
}
