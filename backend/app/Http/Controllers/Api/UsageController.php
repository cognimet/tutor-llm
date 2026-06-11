<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TokenMeter;
use Illuminate\Http\Request;

/**
 * Student-facing credit meter (token spec §7): credits, never raw tokens.
 * "You've used 12 of 30 daily AI credits" + reset countdown.
 */
class UsageController extends Controller
{
    public function __construct(protected TokenMeter $meter) {}

    public function summary(Request $request)
    {
        return response()->json(['usage' => $this->meter->summary($request->user())]);
    }
}
