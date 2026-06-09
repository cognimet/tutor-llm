<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProgressService;
use Illuminate\Http\Request;

class ProgressController extends Controller
{
    public function __construct(protected ProgressService $progress) {}

    public function summary(Request $request)
    {
        return response()->json([
            'progress' => $this->progress->summary($request->user()),
            'gaps'     => $request->user()->knowledgeGaps()
                ->where('resolved', false)->latest()->get(),
        ]);
    }
}
