<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:120'],
            'email'    => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:6'],
            'role'     => ['required', Rule::in(['student', 'parent'])], // admins are seeded
            'level_id' => ['nullable', 'exists:levels,id'],
            'board'    => ['nullable', 'string'],
            'grade'    => ['nullable', 'integer', 'min:1', 'max:12'],
            'stream'   => ['nullable', 'string', 'max:40'],
            'language' => ['nullable', 'string'],
            // optional: link a parent to a child by the child's email
            'child_email' => ['nullable', 'email', 'exists:users,email'],
        ]);

        $user = User::create([
            'name'     => $data['name'],
            'email'    => $data['email'],
            'password' => $data['password'],
            'role'     => $data['role'],
            'level_id' => $data['level_id'] ?? null,
            'board'    => $data['board'] ?? null,
            'grade'    => $data['grade'] ?? null,
            'stream'   => $data['stream'] ?? null,
            'language' => $data['language'] ?? 'en',
        ]);

        if ($user->isParent() && ! empty($data['child_email'])) {
            $child = User::where('email', $data['child_email'])->where('role', 'student')->first();
            if ($child) {
                $user->children()->syncWithoutDetaching([$child->id => ['relationship' => 'guardian']]);
            }
        }

        return $this->respondWithToken($user, 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email'    => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => ['Invalid credentials.']]);
        }
        if (! $user->is_active) {
            throw ValidationException::withMessages(['email' => ['Account is deactivated.']]);
        }

        return $this->respondWithToken($user);
    }

    public function me(Request $request)
    {
        return response()->json(['user' => $request->user()]);
    }

    public function updateProfile(Request $request)
    {
        $user = $request->user();
        $data = $request->validate([
            'name'     => ['sometimes', 'string', 'max:120'],
            // Email is editable from the profile page; stay unique but ignore self.
            'email'    => ['sometimes', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            // Mobile is free-form and NOT unique (families share a number).
            'mobile'   => ['sometimes', 'nullable', 'string', 'max:20'],
            'level_id' => ['sometimes', 'nullable', 'exists:levels,id'],
            'board'    => ['sometimes', 'nullable', 'string'],
            'grade'    => ['sometimes', 'nullable', 'integer', 'min:1', 'max:12'],
            'stream'   => ['sometimes', 'nullable', 'string', 'max:40'],
            'language' => ['sometimes', 'nullable', 'string'],
            // Either a preset key ("preset:fox") or an uploaded image URL.
            'avatar'   => ['sometimes', 'nullable', 'string'],
        ]);
        $user->update($data);

        return response()->json(['user' => $user->fresh()->load('level.track.stage')]);
    }

    // Upload a profile picture. Stores to the public disk and saves the URL on
    // the user. Presets need no upload — the client sets `avatar` to a "preset:*"
    // key through updateProfile() above.
    public function uploadAvatar(Request $request)
    {
        $request->validate([
            'image' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:4096'],
        ]);

        $user = $request->user();
        $path = $request->file('image')->store('avatars', 'public');
        $user->update(['avatar' => \Illuminate\Support\Facades\Storage::disk('public')->url($path)]);

        return response()->json(['user' => $user->fresh()->load('level.track.stage')]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();
        return response()->json(['message' => 'Logged out.']);
    }

    protected function respondWithToken(User $user, int $status = 200)
    {
        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'user'  => $user,
            'token' => $token,
        ], $status);
    }
}
