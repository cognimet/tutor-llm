"""Diagram instance segmentation & isolation (Diagram Isolation upgrade §2).

Rectangular crops on densely packed handwritten notes inevitably capture slices
of the paragraphs above and below a drawing. This module upgrades the ingest
pipeline from bounding boxes to POLYGON masks so the diagram (plus its direct
labels) is perfectly isolated from the surrounding prose.

Three engines, in priority order — consistent with the pipeline's "everything
degrades" design:

  0. MARKER BOUNDARY (strongest signal) — if the student hand-drew a CLOSED loop
     (a pen/marker circle or ellipse) around the figure, that IS the ground
     truth: everything inside the loop is "the diagram", everything outside is
     surrounding text. We find it as the largest enclosed interior "hole" in the
     ink after bridging small gaps in the stroke, so a slightly-open hand-drawn
     loop still counts. This directly honours a student who rings the diagram.
  1. VLM segmentation (Gemini 2.5) — ask the vision model for a segmentation
     mask of the hand-drawn diagram/figure. Gemini returns `box_2d` (0–1000
     normalised) plus a base64 PNG probability `mask`; we threshold, resize and
     place it into crop coordinates. Zero new dependencies: it is the same
     model that already classifies regions and extracts UVSS.
  2. OpenCV heuristic — when both fail (offline, mock, malformed reply):
     classify ink connected-components into "text-row-like" (short, wide,
     arranged in lines) vs "drawing-like" (tall/large strokes), seed the mask
     from the drawing strokes, then pull in only the nearby short components
     (the diagram's own labels), leaving distant paragraph rows out.

Either way the result is normalised by `mask_and_polygon()` into a filled
binary mask + a simplified polygon, from which `make_isolated()` renders the
new clean asset: `…_isolated.png` — the drawing and its labels floating on a
transparent background (alpha 0 outside the polygon, adaptive-threshold
cleanup inside). `suppress_regions()` whites the polygons out of the page so
the REMAINING content can be OCR'd as pure text (§2.3 content separation).
"""
import base64
import json
import logging
import re

log = logging.getLogger("ai.segmentation")


def _cv():
    import cv2  # noqa: F401
    import numpy as np  # noqa: F401
    return cv2, np


# ── The VLM segmentation prompt (Gemini 2.5 native mask output) ─────────
_SEG_PROMPT = (
    "You are a precise vision segmenter for an educational notes engine. "
    "This image is a region cropped from a student's handwritten study notes. It may contain a "
    "hand-drawn DIAGRAM/figure/flowchart, possibly surrounded or sandwiched by paragraphs of "
    "handwritten body text.\n\n"
    "Segment ONLY the diagram itself together with its DIRECT labels (short words/phrases that "
    "point at parts of the drawing, e.g. 'Nasal Cavity', 'Larynx'). EXCLUDE headings, numbered "
    "sections, bullet lists and every paragraph of running body text above, below or beside the "
    "drawing.\n\n"
    "IMPORTANT: if the student has hand-drawn a CLOSED boundary (a pen or marker circle, ellipse "
    "or box) around the figure, treat the INSIDE of that loop as the exact diagram region — "
    "segment everything enclosed by it and nothing outside it.\n\n"
    "Output a JSON list of segmentation masks. Each entry has the 2D bounding box in the key "
    "\"box_2d\" ([y0, x0, y1, x1], normalised to 0-1000), the segmentation mask in key \"mask\" "
    "(base64 PNG), and the text label in the key \"label\". If there is NO diagram in the image, "
    "return an empty list []."
)


def _strip_json_list(text: str):
    """Pull the first JSON array out of a VLM reply (tolerates fences/prose)."""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        out = json.loads(t)
        return out if isinstance(out, list) else None
    except Exception:  # noqa: BLE001
        pass
    a, b = t.find("["), t.rfind("]")
    if a >= 0 and b > a:
        try:
            out = json.loads(t[a:b + 1])
            return out if isinstance(out, list) else None
        except Exception:  # noqa: BLE001
            return None
    return None


def _decode_mask_png(b64: str):
    """Decode a (possibly data-URI) base64 PNG mask into a grayscale ndarray."""
    cv2, np = _cv()
    if not b64 or not isinstance(b64, str):
        return None
    if "," in b64 and b64.lstrip().lower().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64, validate=False)
        arr = np.frombuffer(raw, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    except Exception:  # noqa: BLE001
        return None


async def vlm_mask(crop_bgr, vlm_read) -> "object | None":
    """Ask the VLM for the diagram's segmentation mask. Returns a binary mask in
    crop coordinates (uint8, 255 = diagram) or None. `vlm_read` is the shared
    dispatcher from diagrams.py: async (b64, mime, instruction) -> (text, Usage).
    The caller merges the returned usage; we only need the text here."""
    cv2, np = _cv()
    H, W = crop_bgr.shape[:2]
    ok, buf = cv2.imencode(".png", crop_bgr)
    if not ok:
        return None, None
    text, usage = await vlm_read(base64.b64encode(buf.tobytes()).decode(), "image/png", _SEG_PROMPT)
    entries = _strip_json_list(text) or []

    full = np.zeros((H, W), dtype=np.uint8)
    placed = False
    for e in entries:
        if not isinstance(e, dict):
            continue
        box = e.get("box_2d")
        m = _decode_mask_png(e.get("mask"))
        if m is None or not isinstance(box, (list, tuple)) or len(box) != 4:
            continue
        try:
            y0, x0, y1, x1 = (int(v) for v in box)
        except (TypeError, ValueError):
            continue
        # box_2d is normalised 0–1000 → pixel coords, clamped.
        y0, y1 = max(0, min(H, y0 * H // 1000)), max(0, min(H, y1 * H // 1000))
        x0, x1 = max(0, min(W, x0 * W // 1000)), max(0, min(W, x1 * W // 1000))
        if y1 - y0 < 8 or x1 - x0 < 8:
            continue
        m = cv2.resize(m, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
        _, mbin = cv2.threshold(m, 127, 255, cv2.THRESH_BINARY)
        full[y0:y1, x0:x1] = np.maximum(full[y0:y1, x0:x1], mbin)
        placed = True

    return (full if placed else None), usage


# ── Marker-boundary detection (the student rings the diagram) ───────────
def marker_boundary_mask(crop_bgr, min_frac: float = 0.04, max_frac: float = 0.92):
    """Detect a CLOSED boundary the student hand-drew around a diagram (a pen or
    marker circle/ellipse enclosing the figure) and return its filled interior
    as the diagram mask.

    This is the strongest, most explicit isolation signal: the student has
    literally ringed the figure, so everything inside the loop is 'the diagram'
    and everything outside is surrounding text. We bridge small breaks in the
    stroke (hand-drawn loops are rarely perfectly closed), find the ink's
    interior 'holes' via contour hierarchy, and take the largest blob-shaped one
    — that is the enclosed region. Returns None when no plausible enclosing loop
    exists (the caller then falls back to the VLM / heuristic)."""
    cv2, np = _cv()
    H, W = crop_bgr.shape[:2]
    page_area = float(W * H) or 1.0
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 3)
    ink = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, 35, 10)
    # Bridge small breaks so a hand-drawn loop closes into a ring with a hole.
    k = max(7, (min(W, H) // 55) | 1)
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), iterations=2)
    contours, hierarchy = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return None
    hierarchy = hierarchy[0]

    best, best_area = None, 0.0
    for i, cnt in enumerate(contours):
        # A hole (interior region) has a parent contour; top-level ink does not.
        if hierarchy[i][3] == -1:
            continue
        area = cv2.contourArea(cnt)
        if area < min_frac * page_area or area > max_frac * page_area:
            continue
        # Reject thin slivers (stroke gaps, ruled lines): a genuine enclosed
        # region roughly fills its own bounding box.
        x, y, w, h = cv2.boundingRect(cnt)
        if w * h == 0 or area / (w * h) < 0.35:
            continue
        if area > best_area:
            best, best_area = cnt, area

    if best is None:
        return None
    mask = np.zeros((H, W), np.uint8)
    cv2.drawContours(mask, [best], -1, 255, thickness=cv2.FILLED)
    # Grow slightly so labels touching the inner edge of the loop aren't clipped.
    pad = max(3, min(W, H) // 160) | 1
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad, pad)))
    return mask


# ── OpenCV heuristic fallback: drawing strokes vs text rows ─────────────
def heuristic_mask(crop_bgr):
    """Estimate the diagram mask classically. Ink components that are large or
    tall are 'drawing'; short wide ones arranged in rows are 'text'. The mask is
    seeded from drawing strokes, then nearby short components (the diagram's own
    labels) are pulled in; distant paragraph rows stay out. Returns a binary
    mask (255 = diagram) or None when the page looks like pure text."""
    cv2, np = _cv()
    H, W = crop_bgr.shape[:2]
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 3)
    ink = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, 35, 10)

    # Lightly bridge broken strokes so a drawing forms one component.
    k = max(3, (min(W, H) // 160) | 1)
    bridged = cv2.morphologyEx(ink, cv2.MORPH_CLOSE,
                               cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(bridged, connectivity=8)
    if n <= 1:
        return None

    hs = [stats[i, cv2.CC_STAT_HEIGHT] for i in range(1, n)
          if stats[i, cv2.CC_STAT_AREA] >= 12]
    if not hs:
        return None
    text_h = float(np.median(hs))          # typical handwriting line height
    page_area = float(W * H)

    drawing = np.zeros((H, W), dtype=np.uint8)
    smalls = []                            # candidate labels / text pieces
    for i in range(1, n):
        x, y, w, h, area = (stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
                            stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT],
                            stats[i, cv2.CC_STAT_AREA])
        if area < 12:
            continue
        # Drawing-like: clearly taller than a text line, or a big blob that is
        # ALSO tall (a very wide short blob is a merged text row, not a figure).
        if h > 2.6 * text_h or (area > 0.01 * page_area and h > 1.6 * text_h):
            drawing[lab == i] = 255
        else:
            smalls.append((x, y, w, h, i))

    if not drawing.any() or drawing.sum() / 255 < 0.004 * page_area:
        return None                        # no credible drawing on this crop

    # Pull in ONLY the short components that sit right next to the drawing —
    # its own labels — by testing overlap with a dilated halo of the strokes.
    halo_r = max(9, int(1.6 * text_h)) | 1
    halo = cv2.dilate(drawing, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (halo_r, halo_r)))
    mask = drawing.copy()
    for (x, y, w, h, i) in smalls:
        comp = (lab[y:y + h, x:x + w] == i)
        if (halo[y:y + h, x:x + w][comp] > 0).any():
            mask[y:y + h, x:x + w][comp] = 255
    return mask


# ── normalisation: raw mask → filled region + simplified polygon ────────
def mask_and_polygon(raw_mask, min_frac: float = 0.01, max_frac: float = 0.985):
    """Close label gaps, keep the dominant region, and return (filled_mask,
    polygon) where polygon is [[x, y], …] hugging the diagram cluster. Returns
    (None, None) when the region is implausibly small or swallows the whole
    crop (isolation would be meaningless)."""
    cv2, np = _cv()
    if raw_mask is None or not raw_mask.any():
        return None, None
    H, W = raw_mask.shape[:2]

    # Bridge the drawing and its floating labels into one region.
    k = max(9, (min(W, H) // 36) | 1)
    closed = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    big = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(big)
    if area < min_frac * W * H or area > max_frac * W * H:
        return None, None

    filled = np.zeros((H, W), dtype=np.uint8)
    cv2.drawContours(filled, [big], -1, 255, thickness=cv2.FILLED)
    # Small margin so strokes on the boundary aren't clipped.
    pad = max(3, min(W, H) // 200) | 1
    filled = cv2.dilate(filled, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad, pad)))

    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    big = max(contours, key=cv2.contourArea)
    eps = 0.004 * cv2.arcLength(big, True)
    poly = cv2.approxPolyDP(big, eps, True).reshape(-1, 2)
    if len(poly) < 3:
        return None, None
    return filled, [[int(x), int(y)] for x, y in poly]


# ── asset generation ────────────────────────────────────────────────────
def make_isolated(crop_bgr, filled_mask) -> bytes:
    """Render the perfectly clean asset (§2.2): adaptive-threshold cleanup run
    ONLY inside the mask, every pixel outside the polygon fully transparent.
    The diagram + labels float on a clean ground; paragraphs are simply gone."""
    cv2, np = _cv()
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 3)
    clean = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY, 35, 10)
    bgra = cv2.cvtColor(clean, cv2.COLOR_GRAY2BGRA)
    bgra[:, :, 3] = np.where(filled_mask > 0, 255, 0).astype(np.uint8)
    # Trim to the mask's bounding box (plus margin) so the asset is tight.
    ys, xs = np.where(filled_mask > 0)
    if ys.size:
        m = 6
        y0, y1 = max(0, ys.min() - m), min(bgra.shape[0], ys.max() + m)
        x0, x1 = max(0, xs.min() - m), min(bgra.shape[1], xs.max() + m)
        bgra = bgra[y0:y1, x0:x1]
    ok, buf = cv2.imencode(".png", bgra)
    return buf.tobytes() if ok else b""


def isolated_on_white(crop_bgr, filled_mask) -> bytes:
    """Same isolation, composited on pure white — the version fed to the VLM
    (UVSS extraction) and to OCR, since models read white grounds better than
    alpha channels."""
    cv2, np = _cv()
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 3)
    clean = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY, 35, 10)
    out = np.where(filled_mask > 0, clean, 255).astype(np.uint8)
    ys, xs = np.where(filled_mask > 0)
    if ys.size:
        m = 6
        y0, y1 = max(0, ys.min() - m), min(out.shape[0], ys.max() + m)
        x0, x1 = max(0, xs.min() - m), min(out.shape[1], xs.max() + m)
        out = out[y0:y1, x0:x1]
    ok, buf = cv2.imencode(".png", out)
    return buf.tobytes() if ok else b""


def suppress_regions(page_bgr, page_masks: list) -> bytes:
    """White the diagram polygons OUT of the page (§2.3) so OCR reads only the
    remaining textual content. page_masks are filled masks in page coords. Each
    mask is dilated a little before removal so a hand-drawn boundary STROKE
    around the figure (which sits just outside the filled interior) is wiped too
    — otherwise the marker ring survives as OCR noise in the anchor text."""
    cv2, np = _cv()
    H, W = page_bgr.shape[:2]
    out = page_bgr.copy()
    grow = max(9, (min(W, H) // 45) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow))
    for m in page_masks:
        if m is not None:
            out[cv2.dilate(m, kernel) > 0] = (255, 255, 255)
    ok, buf = cv2.imencode(".png", out)
    return buf.tobytes() if ok else b""


def to_page_mask(filled_mask, page_shape, x: int, y: int):
    """Lift a crop-local filled mask into full-page coordinates."""
    _, np = _cv()
    H, W = page_shape[:2]
    page = np.zeros((H, W), dtype=np.uint8)
    h, w = filled_mask.shape[:2]
    page[y:y + h, x:x + w] = filled_mask
    return page


def polygon_to_page(poly: list, x: int, y: int) -> list:
    """Offset a crop-local polygon into page coordinates."""
    return [[int(px + x), int(py + y)] for px, py in poly]


# ── structure-preserving OCR text assembly ──────────────────────────────
def lines_to_markdown(lines: list[dict]) -> str:
    """Rebuild PaddleOCR line boxes into reading-ordered text with paragraph
    breaks (blank line when the vertical gap exceeds ~1.8 line heights), so the
    notes' hierarchy (headings → bullets) survives into the stored text."""
    items = []
    for l in lines or []:
        txt = str(l.get("text", "")).strip()
        box = l.get("box") or []
        if not txt or not box:
            continue
        try:
            ys = [p[1] for p in box]
            xs = [p[0] for p in box]
            items.append((min(ys), min(xs), max(ys) - min(ys), txt))
        except (TypeError, IndexError):
            items.append((0, 0, 0, txt))
    if not items:
        return ""
    items.sort(key=lambda t: (t[0], t[1]))
    heights = sorted(h for (_, _, h, _) in items if h > 0)
    line_h = heights[len(heights) // 2] if heights else 18

    out: list[str] = []
    prev_y = None
    for (y, _x, _h, txt) in items:
        if prev_y is not None and y - prev_y > 1.8 * line_h:
            out.append("")                 # paragraph break
        out.append(txt)
        prev_y = y
    return "\n".join(out).strip()
