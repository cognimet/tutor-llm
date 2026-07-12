<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** IRT ability (theta) for one (student, subject), on the logit scale. */
class AbilityEstimate extends Model
{
    protected $fillable = ['user_id', 'subject_id', 'theta', 'observations'];

    protected $casts = [
        'theta'        => 'float',
        'observations' => 'integer',
    ];

    public function user()    { return $this->belongsTo(User::class); }
    public function subject() { return $this->belongsTo(Subject::class); }
}
