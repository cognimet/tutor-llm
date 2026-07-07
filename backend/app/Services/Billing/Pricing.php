<?php

namespace App\Services\Billing;

/**
 * International (USD) list pricing. We don't charge a raw INR→USD conversion
 * (₹499 → $6.01 looks odd); instead we round UP to the next market-friendly
 * charm price (…$9.99, $14.99, $49.99…). The same value is shown to the user
 * AND charged via PayPal, so display and charge never diverge.
 */
class Pricing
{
    /** Attractive USD price points, ascending. */
    private const LADDER = [
        9.99, 14.99, 19.99, 24.99, 29.99, 39.99, 49.99, 59.99, 79.99,
        99.99, 129.99, 149.99, 199.99, 249.99, 299.99, 399.99, 499.99,
    ];

    /** INR price → market-friendly USD price (rounded up to the next .99). */
    public static function usd(int $inr): float
    {
        if ($inr <= 0) {
            return 0.0;
        }
        $raw = $inr / max(1.0, (float) config('billing.inr_per_usd', 83));

        foreach (self::LADDER as $point) {
            if ($point >= $raw) {
                return $point;
            }
        }
        // Above the ladder — round up to the next $50 boundary, minus a cent.
        return ceil($raw / 50) * 50 - 0.01;
    }
}
