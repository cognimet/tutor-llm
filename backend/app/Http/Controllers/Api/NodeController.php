<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\KnowledgeNode;
use Illuminate\Http\Request;

/**
 * Multimodal knowledge nodes (diagrams) parsed from a student's uploaded notes.
 *
 * The chat stream embeds `<diagram_sketch|original|cleaned id="X" />` tags; the
 * frontend resolves them here:
 *   - /schema            → the UVSS JSON, for the interactive ReconstructedDiagram
 *   - /image/{variant}   → the rendered original / cleaned / normalized PNG
 *
 * Both are owner-gated. Images stream from the shared storage volume the AI
 * service wrote them to (storage_path('app') == the AI service's UPLOAD_ROOT),
 * the same pattern as textbook figures.
 */
class NodeController extends Controller
{
    /** Map a public variant name to the column holding its stored relative path. */
    private const VARIANTS = [
        'original'    => 'original_crop_url',
        'cleaned'     => 'cleaned_crop_url',
        'normalized'  => 'normalized_image_url',
        'isolated'    => 'isolated_image_url',
        'illustrated' => 'illustrated_image_url',
    ];

    /** GET /tutor/nodes/{node}/schema — the UVSS payload + metadata for rendering. */
    public function schema(Request $request, KnowledgeNode $node)
    {
        abort_unless($node->user_id === $request->user()->id, 404);

        return response()->json([
            'id'           => $node->id,
            'type'         => $node->type,
            'title'        => $node->title,
            'confidence'   => (float) $node->uvss_confidence_score,
            'has_schema'   => is_array($node->diagram_schema) && ! empty($node->diagram_schema['elements']),
            'schema'       => $node->diagram_schema,
            'labels'       => $node->labels ?? [],
            'summary'      => $node->content,
            // Strict visual isolation (Diagram Isolation upgrade): whether the
            // polygon-masked asset exists, so the Visual Context Viewer can
            // badge "isolated" vs "cleaned fallback".
            'has_isolated' => ! empty($node->isolated_image_url),
            // The generated textbook illustration (idealised render), if present —
            // the viewer shows this by default when available.
            'has_illustrated' => ! empty($node->illustrated_image_url),
            // Which image variants actually exist on disk (so the UI can offer them).
            'images'       => array_values(array_filter(array_keys(self::VARIANTS), fn ($v) => (bool) $node->{self::VARIANTS[$v]})),
        ]);
    }

    /** GET /tutor/nodes/{node}/image/{variant} — stream a rendered asset PNG. */
    public function image(Request $request, KnowledgeNode $node, string $variant)
    {
        abort_unless($node->user_id === $request->user()->id, 404);

        $column = self::VARIANTS[$variant] ?? null;
        abort_if($column === null, 404, 'Unknown image variant.');

        // Build a preference-ordered candidate list: the requested variant first,
        // then every other variant that actually has a stored path. Any variant
        // (not just "isolated") thus degrades gracefully to whatever exists, so
        // the Visual Context Viewer never renders a broken image when at least
        // one asset was written (Diagram Fixes §1).
        $candidates = [];
        foreach ([$variant => $column] + self::VARIANTS as $col) {
            $rel = $node->{$col};
            if ($rel && ! in_array($rel, $candidates, true)) {
                $candidates[] = $rel;
            }
        }
        abort_if(empty($candidates), 404, 'No such image for this diagram.');

        foreach ($candidates as $rel) {
            // Guard against path traversal, then resolve against the shared
            // volume. Tolerate Laravel 11's private disk root (storage/app/private)
            // in case UPLOAD_ROOT points there — mirrors the AI service's own
            // read fallback (Diagram Fixes §1.2 volume-path mismatch).
            if (str_contains((string) $rel, '..')) {
                continue;
            }
            $relClean = ltrim((string) $rel, '/');
            foreach ([storage_path('app/' . $relClean), storage_path('app/private/' . $relClean)] as $abs) {
                if (is_file($abs)) {
                    return response()->file($abs, [
                        'Content-Type'  => 'image/png',
                        'Cache-Control' => 'private, max-age=86400',
                    ]);
                }
            }
        }

        // Nothing on disk — log the exact paths we tried so a 404 is diagnosable
        // (Diagram Fixes §1.2 / testing protocol §3.1).
        \Illuminate\Support\Facades\Log::warning('diagram image not found on disk', [
            'node'    => $node->id,
            'variant' => $variant,
            'tried'   => array_map(fn ($rel) => storage_path('app/' . ltrim((string) $rel, '/')), $candidates),
        ]);
        abort(404, 'Diagram image not found.');
    }
}
