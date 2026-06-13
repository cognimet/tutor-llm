<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\LearnerProfileService;
use Illuminate\Http\Request;

/**
 * The learner's "current stage" dashboard: stage + score, accuracy, time,
 * critical-thinking, why-you're-wrong, and suggestions. Read-only.
 */
class LearnerProfileController extends Controller
{
    public function __construct(protected LearnerProfileService $profile) {}

    /** GET /tutor/profile */
    public function show(Request $request)
    {
        return response()->json(['profile' => $this->profile->compute($request->user())]);
    }
}
