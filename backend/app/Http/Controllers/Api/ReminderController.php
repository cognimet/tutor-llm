<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RemindersService;
use Illuminate\Http\Request;

/**
 * In-app Plan Reminders: today / tomorrow / overdue tasks, exam countdowns,
 * cards due, the fix queue, and the single next action. Read-only (no token gate).
 */
class ReminderController extends Controller
{
    public function __construct(protected RemindersService $reminders) {}

    /** GET /tutor/reminders */
    public function index(Request $request)
    {
        return response()->json($this->reminders->feed($request->user()));
    }
}
