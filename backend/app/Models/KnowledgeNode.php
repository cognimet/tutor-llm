<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A multimodal knowledge node parsed from a student's uploaded material.
 *
 * For `type = diagram` this carries the Universal Vector Sketch Schema (UVSS)
 * JSON used to reconstruct an interactive, stroke-by-stroke sketch on the
 * frontend, plus the three rendered assets (original / cleaned / normalized)
 * and an extraction confidence that drives the tutor's "which representation to
 * show" decision (Multimodal RAG plan §5).
 */
class KnowledgeNode extends Model
{
    protected $fillable = [
        'nodeable_type', 'nodeable_id',
        'type', 'title', 'content',
        'diagram_schema', 'uvss_confidence_score',
        'original_crop_url', 'cleaned_crop_url', 'normalized_image_url',
        'isolated_image_url', 'illustrated_image_url', 'mask_polygon',
        'ocr_text', 'labels',
        'qdrant_id',
        'user_id', 'subject_id', 'chapter_id', 'topic_id', 'topic_name', 'is_primary',
        'note_id', 'page', 'region_index', 'parent_diagram_id', 'status',
    ];

    protected $casts = [
        'diagram_schema'        => 'array',
        'labels'                => 'array',
        'mask_polygon'          => 'array',
        'uvss_confidence_score' => 'float',
        'is_primary'            => 'boolean',
        'page'                  => 'integer',
        'region_index'          => 'integer',
        'parent_diagram_id'     => 'integer',
    ];

    public function nodeable() { return $this->morphTo(); }
    public function user()     { return $this->belongsTo(User::class); }
    public function note()     { return $this->belongsTo(TopicNote::class, 'note_id'); }

    /** The diagram this TEXT node physically surrounds on the page (anchor). */
    public function parentDiagram() { return $this->belongsTo(self::class, 'parent_diagram_id'); }

    /** The OCR'd prose nodes anchored to this DIAGRAM node (§3 anchor relationship). */
    public function anchoredTexts() { return $this->hasMany(self::class, 'parent_diagram_id'); }

    /** Does this diagram have a perfectly isolated (polygon-masked) asset? */
    public function hasIsolatedAsset(): bool
    {
        return $this->type === 'diagram' && ! empty($this->isolated_image_url);
    }

    /** Is this a fully reconstructable diagram (UVSS present + high confidence)? */
    public function hasReconstruction(): bool
    {
        return $this->type === 'diagram'
            && is_array($this->diagram_schema)
            && ! empty($this->diagram_schema['elements'])
            && (float) $this->uvss_confidence_score >= 0.85;
    }
}
