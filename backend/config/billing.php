<?php

return [
    /*
     | Default provider for server-driven flows (webhooks fall back to this,
     | offline school deals use 'manual'). End users PICK a provider at
     | checkout — Razorpay (UPI/cards, INR) or PayPal (international, USD).
     */
    'provider' => env('BILLING_PROVIDER', 'manual'),

    'currency' => 'INR',

    // INR→USD conversion for PayPal (PayPal charges USD; plans are priced in INR).
    'inr_per_usd' => (float) env('BILLING_INR_PER_USD', 83),

    'trial_days' => (int) env('BILLING_TRIAL_DAYS', 0),

    'razorpay' => [
        'key_id'         => env('RAZORPAY_KEY_ID'),
        'key_secret'     => env('RAZORPAY_KEY_SECRET'),
        'webhook_secret' => env('RAZORPAY_WEBHOOK_SECRET'),
        'api_base'       => 'https://api.razorpay.com/v1',
    ],

    'paypal' => [
        'client_id'     => env('PAYPAL_CLIENT_ID'),
        'client_secret' => env('PAYPAL_CLIENT_SECRET'),
        'mode'          => env('PAYPAL_MODE', 'sandbox'),   // sandbox | live
        'webhook_id'    => env('PAYPAL_WEBHOOK_ID'),
        'currency'      => env('PAYPAL_CURRENCY', 'USD'),
        'api_base'      => env('PAYPAL_MODE', 'sandbox') === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com',
    ],

    /*
     | Unit economics for the admin margin-guard. A plan is safe when
     | monthly_credit_limit * cost_per_credit_inr <= price * cogs_ceiling.
     */
    'margin' => [
        'cost_per_credit_inr' => (float) env('BILLING_COST_PER_CREDIT', 0.15),
        'cogs_ceiling'        => (float) env('BILLING_COGS_CEILING', 0.30),
    ],
];
