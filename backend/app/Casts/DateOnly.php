<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Stores a date column as a pure "Y-m-d" string while exposing it as a Carbon
 * instance on read.
 *
 * Laravel's built-in `date` cast persists values using the model's date format
 * ("Y-m-d H:i:s"), so a row written for today ends up as "2026-06-07 00:00:00".
 * Lookups built with `Carbon::today()->toDateString()` ("2026-06-07") then never
 * match that stored value, which made ProgressSnapshot::firstOrCreate() insert a
 * duplicate and trip the (user_id, day) unique constraint. Persisting date-only
 * keeps writes and lookups byte-for-byte identical.
 */
class DateOnly implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?Carbon
    {
        return $value === null ? null : Carbon::parse($value)->startOfDay();
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return $value === null ? null : Carbon::parse($value)->toDateString();
    }
}
