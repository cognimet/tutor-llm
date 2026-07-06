"""Multimodal diagram ingestion: OpenCV → PaddleOCR → Gemini → UVSS.

Turns a student's uploaded note (image or PDF) into structured, retrievable
diagram nodes. The pipeline, per the Multimodal RAG plan:

  1. OpenCV  — preprocess (denoise + adaptive threshold), then propose diagram
     regions with contour/morphology heuristics (generous; Gemini filters).
  2. 3 assets — for every region render and store: the ORIGINAL crop, a CLEANED
     crop (shadow-removed, contrast-boosted) and a NORMALIZED line-art sketch.
  3. PaddleOCR — read label text off the cleaned crop (graceful fallback).
  4. Gemini 2.5 Flash — the single multimodal reasoning layer: classify the
     region, understand the diagram, link labels, and emit schema-valid UVSS
     JSON + a confidence score.
  5. ISOLATION (Diagram Isolation upgrade §2) — for every ACCEPTED diagram,
     trace its true polygon (VLM segmentation mask, OpenCV heuristic fallback)
     and render a fourth asset, `…_isolated.png`: the drawing + its direct
     labels on a transparent ground, surrounding paragraphs removed. The
     node's ocr_text is re-read from the isolated render (labels only), while
     the page MINUS the diagram polygons is OCR'd into `surrounding_text` —
     the anchor prose Laravel links to the diagram (§3 anchor relationship).
  6. Fallback — when UVSS is missing or low-confidence, keep the node anyway
     (image + summary + labels), so the tutor can always show the real drawing.

Everything degrades: no OpenCV → whole page is one region; no PaddleOCR → VLM
text only; VLM off/mock → image-only nodes. The orchestrator returns plain
descriptors; persistence (Postgres) and vector indexing are driven by Laravel
so this module stays storage-agnostic apart from writing the asset PNGs to the
shared volume Laravel serves from.
"""
import base64
import json
import logging
import os
import re
import uuid

from . import segmentation
from .config import settings
from .schemas import Usage
from .providers import read_image, read_image_genai, generate_image_genai

log = logging.getLogger("ai.diagrams")


# ── lazy OpenCV / numpy (kept optional, like fastembed) ─────────────────
def _cv():
    import cv2  # noqa: F401
    import numpy as np  # noqa: F401
    return cv2, np


def _cv_available() -> bool:
    try:
        _cv()
        return True
    except Exception:  # noqa: BLE001
        return False


# ── VLM dispatch (Gemini via google-genai, else OpenAI-compatible VLM) ──
async def _vlm_read(image_b64: str, mime: str, instruction: str) -> tuple[str, Usage]:
    reader = read_image_genai if settings.vision_provider == "gemini" else read_image
    try:
        return await reader(image_b64, mime, instruction)
    except Exception as e:  # noqa: BLE001
        log.warning("vlm read failed: %s", e)
        return "", Usage(model="none")


# ── The UVSS extraction prompt (Gemini does ALL the visual reasoning) ───
_UVSS_PROMPT = (
    "You are a vision parser for an educational diagram-reconstruction engine. "
    "You are given ONE cropped region from a student's hand-drawn study notes. You may also be "
    "given a NOISY OCR hint produced by a printed-text engine.\n\n"
    "CRITICAL — READ LABELS WITH YOUR OWN EYES: the OCR hint is frequently WRONG on handwriting "
    "and cursive (it turns 'Ciliary Muscle' into gibberish like 'iljarqHux'). Transcribe every "
    "label by LOOKING at the image yourself. Treat the OCR hint as a weak fallback only, and IGNORE "
    "it whenever it disagrees with what you can clearly read. Never copy a garbled OCR string into "
    "the labels array.\n\n"
    "First decide if this region is a DIAGRAM/figure/flowchart (not plain paragraph text or a "
    "photo). Then extract it into a Universal Vector Sketch Schema (UVSS) so it can be redrawn as "
    "an animated SVG.\n\n"
    "Return ONLY a single JSON object (no markdown fence, no prose) with EXACTLY these keys:\n"
    "{\n"
    '  "is_diagram": true|false,\n'
    '  "title": "short title",\n'
    '  "summary": "exam-ready description: what it shows, how parts relate, arrows/flow, key values",\n'
    '  "labels": ["every labelled structure/part"],\n'
    '  "confidence_score": 0.0,  // 0..1: how accurately the paths+labels capture the visual intent\n'
    '  "uvss": {\n'
    '    "id": "slug",\n'
    '    "title": "same title",\n'
    '    "canvas": { "width": 800, "height": 600, "viewBox": "0 0 800 600" },\n'
    '    "elements": [\n'
    '      { "id": "el1", "type": "path", "stroke_path": "M x y L x y ...", "style": {"stroke":"#4f46e5","strokeWidth":3} },\n'
    '      { "id": "el2", "type": "text", "label": "PORTAL VEIN", "style": {"x":400,"y":215,"fill":"#fff","fontSize":14} }\n'
    "    ],\n"
    '    "hotspots": [ { "element_id": "el2", "explanation": "what this part is / does" } ]\n'
    "  }\n"
    "}\n\n"
    "Rules: coordinates live inside the 800x600 canvas. 'stroke_path' is a valid SVG path 'd' string. "
    "Use 'path' for every drawn line/shape and 'text' for each label (place style.x/style.y near what it "
    "labels). Add a hotspot for each important labelled part.\n"
    "ALWAYS REBUILD A CLEAN, RECOGNISABLE SKETCH: if the region is a diagram you MUST return a usable "
    "'uvss' that redraws it as a tidy, textbook-quality schematic — the kind of clean labelled figure a "
    "teacher would draw, NOT a rough trace of the handwriting.\n"
    "DRAW WITH SMOOTH CURVES: use cubic/quadratic Bézier ('C'/'Q') and arc ('A') commands for every "
    "organic shape — circles, ellipses, lens curves, anatomical outlines. Do NOT approximate curves with "
    "straight 'L' segments (that looks crude and angular). Real anatomy is curved, so the eyeball, cornea, "
    "iris, lens and retina must be smooth rounded paths.\n"
    "GET THE STRUCTURE RIGHT: lay parts out with correct RELATIVE positions, proportions and nesting so "
    "the figure is instantly recognisable. For an eye cross-section, for example: a large smooth eyeball "
    "outline; the transparent cornea bulging at the FRONT; behind it the coloured iris with the pupil "
    "opening; the lens just behind the pupil; the concentric outer layers (sclera then choroid then "
    "retina) lining the back; and the optic nerve leaving the rear. Nest and align these correctly.\n"
    "DETAIL: provide roughly 15-30 elements — enough smooth paths to actually depict the structure — plus "
    "one 'text' label per part placed right next to what it names, and a hotspot per key part. Use the full "
    "800x600 canvas. Coordinates may be decimals for smooth curves.\n"
    "Only use uvss=null when the region is NOT a diagram (is_diagram=false) or is genuinely unintelligible; "
    "otherwise ALWAYS reconstruct. Set confidence_score to how well your schematic captures the drawing."
)


# Lightweight classify+label prompt used when UVSS reconstruction is OFF — a
# small reply (no SVG paths), so illustration-only mode costs a fraction of the
# tokens the full UVSS extraction does.
_CLASSIFY_PROMPT = (
    "You are a vision parser for an educational notes engine. Look at this cropped region from a "
    "student's notes.\n"
    "First decide if it is a DIAGRAM/figure/flowchart (not plain paragraph text or a photo). Then "
    "read it. Transcribe every label by LOOKING at the image yourself — if a noisy OCR hint is "
    "given it is often wrong on handwriting, so trust your own reading and never copy garbled OCR.\n"
    "LABELS — BE EXHAUSTIVE BUT ONLY PART-LABELS: a label is a SHORT part name that points at a "
    "structure in the drawing (usually via a leader line or arrow), e.g. 'Cornea', 'Retina', "
    "'Optic nerve connecting with brain', 'Blind Spot'. Scan the WHOLE image — top, bottom, both "
    "sides and the faint/dense ones near the drawing — and list EVERY such part-label, exactly as "
    "written (keep the student's spelling and word order). Do NOT omit outer or bottom labels, do "
    "NOT shorten them, do NOT merge two into one.\n"
    "EXCLUDE non-labels: do NOT list the page/section TITLE or any heading (e.g. 'Human Eye and the "
    "Colourful World'), and do NOT list running sentences or descriptions — only the short names "
    "that annotate parts of the diagram itself.\n"
    "Return ONLY a single JSON object (no markdown fence, no prose) with EXACTLY these keys:\n"
    "{\n"
    '  "is_diagram": true|false,\n'
    '  "title": "short title",\n'
    '  "summary": "exam-ready description: what it shows, how the parts relate, key values",\n'
    '  "labels": ["EVERY labelled structure/part, verbatim"],\n'
    '  "confidence_score": 0.0\n'
    "}"
)


def _strip_json(text: str) -> dict | None:
    """Pull the first JSON object out of a VLM reply (tolerates code fences/prose)."""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:  # noqa: BLE001
        pass
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(t[a:b + 1])
        except Exception:  # noqa: BLE001
            return None
    return None


def _valid_uvss(uvss) -> bool:
    """Minimal structural check so the frontend never renders a malformed schema."""
    if not isinstance(uvss, dict):
        return False
    els = uvss.get("elements")
    if not isinstance(els, list) or not els:
        return False
    drawable = [e for e in els if isinstance(e, dict) and e.get("type") in ("path", "node", "edge", "text")]
    return len(drawable) >= 2


def _normalise_uvss(uvss: dict, title: str) -> dict:
    """Fill canvas defaults + ensure ids, so the React engine can rely on shape."""
    canvas = uvss.get("canvas") if isinstance(uvss.get("canvas"), dict) else {}
    w = int(canvas.get("width") or 800)
    h = int(canvas.get("height") or 600)
    uvss["canvas"] = {"width": w, "height": h, "viewBox": canvas.get("viewBox") or f"0 0 {w} {h}"}
    uvss.setdefault("id", re.sub(r"[^a-z0-9]+", "_", (title or "diagram").lower()).strip("_") or "diagram")
    uvss.setdefault("title", title or "Diagram")
    for i, el in enumerate(uvss.get("elements", [])):
        if isinstance(el, dict):
            el.setdefault("id", f"el{i}")
    if not isinstance(uvss.get("hotspots"), list):
        uvss["hotspots"] = []
    return uvss


async def extract_uvss(cleaned_b64: str, ocr_hint: str = "") -> tuple[dict, Usage]:
    """Ask the VLM to classify + vectorise the region. Returns (result, usage)
    where result = {is_diagram, title, summary, labels, confidence, schema|None}.
    The schema is dropped (None) when invalid OR below the confidence floor, but
    title/summary/labels are always kept for the fallback path.

    The OCR hint (from a printed-text engine) is passed clearly marked as NOISY
    and untrusted — modern VLMs read handwriting far better, so we never want the
    model to regurgitate garbled OCR into the labels (Diagram Fixes §2).

    When UVSS reconstruction is disabled (illustration-only mode) a compact
    classify/label prompt is used instead of the heavy UVSS prompt, so the call
    costs a fraction of the tokens and no schema is produced."""
    base_prompt = _UVSS_PROMPT if settings.diagram_reconstruct_enabled else _CLASSIFY_PROMPT
    instruction = base_prompt + (
        "\n\nNOISY OCR hint (printed-text engine — often wrong on handwriting; "
        f"trust your own visual reading and use this only as a weak fallback):\n{ocr_hint[:1200]}"
        if ocr_hint else "")
    text, usage = await _vlm_read(cleaned_b64, "image/png", instruction)
    data = _strip_json(text) or {}

    is_diagram = bool(data.get("is_diagram", True))
    title = str(data.get("title") or "").strip()
    summary = str(data.get("summary") or "").strip()
    labels = [str(x).strip() for x in (data.get("labels") or []) if str(x).strip()]
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence_score", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0

    schema = None
    uvss = data.get("uvss")
    valid = _valid_uvss(uvss)
    if settings.diagram_reconstruct_enabled:
        if is_diagram and valid and confidence >= settings.diagram_min_confidence:
            schema = _normalise_uvss(uvss, title)
        elif is_diagram and valid and confidence < settings.diagram_min_confidence:
            log.info("UVSS dropped (confidence %.2f < %.2f) — image fallback kept",
                     confidence, settings.diagram_min_confidence)

    # Diagnostic: when reconstruction is ON but produced no schema, say exactly
    # why — parse failure vs. no uvss vs. too-few elements vs. low confidence.
    # Skipped in illustration-only mode, which never asks for a schema.
    if schema is None and settings.diagram_reconstruct_enabled:
        n_elems = len(uvss.get("elements", [])) if isinstance(uvss, dict) else 0
        reason = ("not_a_diagram" if not is_diagram
                  else "parse_failed_or_no_uvss" if not isinstance(uvss, dict)
                  else "too_few_elements" if not valid
                  else "low_confidence")
        t = text or ""
        # parsed=False + a tail that stops mid-value ⇒ the reply was truncated
        # (raise vision_max_tokens / disable thinking). parsed=True but no 'uvss'
        # key ⇒ the model didn't follow the contract (prompt problem).
        log.warning("no UVSS reconstruction (provider=%s reason=%s parsed=%s keys=%s is_diagram=%s "
                    "uvss_elems=%s conf=%.2f floor=%.2f len=%d) head=%r tail=%r",
                    settings.vision_provider, reason, bool(data), list(data.keys())[:10],
                    is_diagram, n_elems, confidence, settings.diagram_min_confidence,
                    len(t), t[:180], t[-180:])

    return ({
        "is_diagram": is_diagram, "title": title, "summary": summary,
        "labels": labels, "confidence": confidence, "schema": schema,
    }, usage)


# ── Idealised render: redraw the isolated diagram as a clean textbook figure ──
_ILLUSTRATE_PROMPT = (
    "Redraw the diagram in this image as a CLEAN, professional, textbook-style scientific "
    "illustration of {subject}. Keep the SAME overall structure, parts and spatial layout as "
    "the drawing, but render it neatly — smooth accurate lines, correct proportions, light "
    "shading — exactly like a printed biology/physics textbook figure.\n"
    "LABELS ARE MANDATORY AND MUST MATCH: reproduce EVERY label listed below, spelled EXACTLY as "
    "given, as clear printed text with a thin leader line to the correct part. Do NOT invent new "
    "labels, do NOT rename, shorten, translate or drop any, and do NOT leave a listed label out. "
    "If a part is labelled in the list, it must appear labelled in your illustration.{label_hint}\n"
    "Plain white background. Do not copy the student's handwriting or messy strokes. Output only "
    "the illustration image."
)


async def illustrate_diagram(image_b64: str, title: str, labels: list[str]) -> tuple[bytes, Usage]:
    """Turn a student's isolated hand-drawing into a clean, labelled textbook
    illustration via the Gemini image model (the plan's 'idealised render'),
    faithfully reproducing all of its labels. Best-effort: returns (b'', usage)
    when disabled or on failure, so the caller keeps the vector sketch / crop."""
    if not settings.diagram_illustrate_enabled or settings.vision_provider != "gemini":
        return b"", Usage(model="none")
    label_hint = ("\nLABELS TO REPRODUCE (exactly, all of them): "
                  + "; ".join(labels[:30]) + ".") if labels else ""
    prompt = _ILLUSTRATE_PROMPT.format(subject=(title or "the subject"), label_hint=label_hint)
    return await generate_image_genai(image_b64, "image/png", prompt)


# ── OpenCV: preprocessing, region proposals, 3-asset generation ─────────
def _decode(raw: bytes):
    cv2, np = _cv()
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _png_bytes(img) -> bytes:
    cv2, _ = _cv()
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes() if ok else b""


def _ink_mask(gray):
    """Binary ink mask (ink=white) via adaptive threshold — robust to shadows."""
    cv2, _ = _cv()
    blur = cv2.medianBlur(gray, 3)
    return cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv2.THRESH_BINARY_INV, 35, 10)


def propose_regions(bgr) -> list[tuple[int, int, int, int]]:
    """Contour/morphology region proposals for diagram candidates. Generous on
    purpose — the VLM later classifies and discards non-diagram regions. Returns
    (x,y,w,h) boxes, largest first, plus the full page as a final fallback."""
    cv2, np = _cv()
    H, W = bgr.shape[:2]
    page_area = float(W * H) or 1.0
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    mask = _ink_mask(gray)
    # Merge nearby strokes into blobs (close gaps), scaled to page size.
    k = max(9, (min(W, H) // 40) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes: list[tuple[int, int, int, int]] = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < 48 or h < 48:
            continue
        if (w * h) / page_area < settings.diagram_min_area_frac:
            continue
        if w >= 0.98 * W and h >= 0.98 * H:
            continue  # the whole page contour — added explicitly below
        pad = 8
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(W, x + w + pad), min(H, y + h + pad)
        boxes.append((x0, y0, x1 - x0, y1 - y0))

    boxes = _merge_boxes(boxes)
    boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
    boxes = boxes[: max(1, settings.diagram_max_regions)]
    # Always offer the full page as a last-resort candidate (single-drawing notes).
    boxes.append((0, 0, W, H))
    return boxes


def _iou_or_contained(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix0, iy0 = max(ax, bx), max(ay, by)
    ix1, iy1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    smaller = min(aw * ah, bw * bh) or 1
    return inter / smaller   # containment-aware overlap


def _merge_boxes(boxes: list[tuple[int, int, int, int]], thresh: float = 0.6):
    """Greedily union heavily-overlapping/nested boxes."""
    merged: list[list[int]] = []
    for b in sorted(boxes, key=lambda r: r[2] * r[3], reverse=True):
        placed = False
        for m in merged:
            if _iou_or_contained(tuple(m), b) >= thresh:
                x0 = min(m[0], b[0]); y0 = min(m[1], b[1])
                x1 = max(m[0] + m[2], b[0] + b[2]); y1 = max(m[1] + m[3], b[1] + b[3])
                m[0], m[1], m[2], m[3] = x0, y0, x1 - x0, y1 - y0
                placed = True
                break
        if not placed:
            merged.append(list(b))
    return [tuple(m) for m in merged]


def make_cleaned(crop_bgr) -> bytes:
    """Shadow-removed, contrast-boosted black-on-white render (OpenCV adaptive
    thresholding) — the crisp version sent to the VLM and shown as 'cleaned'."""
    cv2, _ = _cv()
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 3)
    clean = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY, 35, 10)
    return _png_bytes(clean)


def make_normalized(crop_bgr) -> bytes:
    """Idealized 'textbook' line-art: Canny edges → dilated → dark strokes on a
    clean white ground (the normalized sketch, plan §4.2)."""
    cv2, np = _cv()
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 60, 160)
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)), iterations=1)
    normalized = 255 - edges  # dark strokes on white
    return _png_bytes(normalized)


# ── asset storage on the shared volume (Laravel serves these) ───────────
def _diag_dir(note_id: int) -> str:
    return os.path.join(settings.upload_root, "diagrams", str(note_id))


def _save_asset(note_id: int, page: int, region: int, variant: str, data: bytes) -> str | None:
    """Write a PNG asset and return its path relative to upload_root (or None).

    The asset is written world-readable (dir 0755, file 0644) so the Laravel web
    server user (www-data / nginx) can stream it even when this worker runs as a
    different user — otherwise NodeController::image 404s on a permission error
    (Diagram Fixes §1.3)."""
    if not data:
        return None
    rel = os.path.join("diagrams", str(note_id), f"p{page:04d}_r{region}_{variant}.png")
    abspath = os.path.join(settings.upload_root, rel)
    try:
        os.makedirs(os.path.dirname(abspath), exist_ok=True)
        with open(abspath, "wb") as f:
            f.write(data)
        # Best-effort permission fix-up (no-op on filesystems that don't support it).
        try:
            os.chmod(os.path.dirname(abspath), 0o755)
            os.chmod(abspath, 0o644)
        except OSError:
            pass
        return rel
    except Exception as e:  # noqa: BLE001
        log.warning("could not write diagram asset %s: %s", abspath, e)
        return None


# ── page loading (image or PDF) ─────────────────────────────────────────
def _load_pages(raw: bytes, mime: str | None, max_pages: int = 20) -> list[bytes]:
    """Return a list of page images (PNG/orig bytes). PDFs are rasterised with
    PyMuPDF; a single image returns itself."""
    is_pdf = (mime or "").lower().endswith("pdf") or raw[:5] == b"%PDF-"
    if not is_pdf:
        return [raw]
    pages: list[bytes] = []
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=raw, filetype="pdf")
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(dpi=settings.pdf_render_dpi)
            pages.append(pix.tobytes("png"))
        doc.close()
    except Exception as e:  # noqa: BLE001
        log.warning("pdf rasterise failed: %s", e)
    return pages


def _merge_usage(a: Usage, b: Usage) -> Usage:
    return Usage(model=b.model if b.model != "none" else a.model,
                 prompt_tokens=a.prompt_tokens + b.prompt_tokens,
                 completion_tokens=a.completion_tokens + b.completion_tokens,
                 total_tokens=a.total_tokens + b.total_tokens,
                 mock=a.mock or b.mock)


async def ingest(note_id: int, raw: bytes, mime: str | None, *,
                 subject_id: int | None = None, chapter_id: int | None = None,
                 topic_id: int | None = None, topic: str | None = None,
                 is_primary: bool = False) -> dict:
    """Run the full pipeline over an uploaded note. Returns
    {"nodes": [descriptor,...], "pages": int, "usage": Usage}.

    Each descriptor is storage-ready for Laravel: title, summary, labels,
    ocr_text, confidence, has_schema, diagram_schema, qdrant_id, the four asset
    paths (original / cleaned / normalized / ISOLATED, relative to the shared
    volume), the traced mask_polygon (page coords) and the page's diagram-free
    surrounding_text (the anchor prose). Persistence + Qdrant indexing happen
    back in Laravel (which owns the knowledge_nodes table)."""
    from . import paddleocr_client

    nodes: list[dict] = []
    usage = Usage(model="none")
    if not _cv_available():
        log.warning("OpenCV unavailable — diagram ingest skipped for note %s", note_id)
        return {"nodes": nodes, "pages": 0, "usage": usage.model_dump()}
    if not settings.vision_enabled:
        # The VLM is the region classifier + UVSS extractor; without it we'd
        # create image-only noise nodes. Skip cleanly (Laravel also gates on this).
        log.info("vision disabled — diagram ingest skipped for note %s", note_id)
        return {"nodes": nodes, "pages": 0, "usage": usage.model_dump()}

    cv2, np = _cv()
    pages = _load_pages(raw, mime)
    region_counter = 0

    for pno, page_bytes in enumerate(pages, start=1):
        if region_counter >= settings.diagram_max_regions:
            break  # global region budget spent — stop scanning further pages
        bgr = _decode(page_bytes)
        if bgr is None:
            continue
        H, W = bgr.shape[:2]
        proposals = propose_regions(bgr)
        accepted_full_page = False
        page_masks: list = []   # filled diagram masks in PAGE coords (this page)

        for (x, y, w, h) in proposals:
            if region_counter >= settings.diagram_max_regions:
                break
            is_full_page = (w >= 0.98 * W and h >= 0.98 * H)
            # Only fall back to the full page if nothing else was accepted on it.
            if is_full_page and (accepted_full_page or any(n["page"] == pno for n in nodes)):
                continue

            crop = bgr[y:y + h, x:x + w]
            if crop.size == 0:
                continue
            cleaned = make_cleaned(crop)
            normalized = make_normalized(crop)
            original_png = _png_bytes(crop)
            cleaned_b64 = base64.b64encode(cleaned or original_png).decode()

            # ── LABEL/ILLUSTRATION SOURCE: a generously PADDED, cleaned crop.
            # A diagram's labels sit AROUND the drawing (Aorta on top, Vena Cava
            # on the side…), so a tight region/isolation box clips them and the
            # model never reads them. Padding the crop keeps every outer label
            # visible, which is what makes the rebuilt figure's labels faithful.
            pad_x, pad_y = int(0.16 * w) + 24, int(0.16 * h) + 24
            lx0, ly0 = max(0, x - pad_x), max(0, y - pad_y)
            lx1, ly1 = min(W, x + w + pad_x), min(H, y + h + pad_y)
            label_crop = bgr[ly0:ly1, lx0:lx1]
            label_b64 = base64.b64encode(make_cleaned(label_crop) or _png_bytes(label_crop)).decode()

            # ── VLM-FREE isolation (marker → heuristic) on the tight crop — used
            # for the isolated ASSET and the page's surrounding-text separation.
            # (The VLM segmentation fallback, a model call, stays gated below.)
            filled, poly = None, None
            if settings.diagram_isolation_enabled:
                try:
                    raw_mask = segmentation.marker_boundary_mask(crop)  # strongest signal
                    if raw_mask is None:
                        raw_mask = segmentation.heuristic_mask(crop)
                    filled, poly = segmentation.mask_and_polygon(raw_mask)
                except Exception as e:  # noqa: BLE001 — isolation is best-effort
                    log.warning("diagram pre-isolation failed (note %s p%s): %s", note_id, pno, e)

            # OCR + the VLM read the FULL labelled crop (noisy hint, distrusted),
            # so no label is lost before the model transcribes them.
            ocr = await paddleocr_client.ocr(label_b64)
            ocr_text = ocr.get("text", "")

            # Gemini: classify + read EVERY label off the full labelled image.
            result, u = await extract_uvss(label_b64, ocr_text)
            usage = _merge_usage(usage, u)
            if not result["is_diagram"]:
                continue  # the VLM says this region isn't a diagram — discard

            region = region_counter
            region_counter += 1
            if is_full_page:
                accepted_full_page = True

            # If marker/heuristic isolation found nothing, try the VLM
            # segmentation fallback NOW — only for ACCEPTED diagrams, so a model
            # call is never spent segmenting a plain-text region.
            if settings.diagram_isolation_enabled and filled is None:
                try:
                    raw_mask, seg_usage = await segmentation.vlm_mask(crop, _vlm_read)
                    if seg_usage is not None:
                        usage = _merge_usage(usage, seg_usage)
                    filled, poly = segmentation.mask_and_polygon(raw_mask)
                except Exception as e:  # noqa: BLE001
                    log.warning("diagram vlm-isolation failed (note %s p%s r%s): %s", note_id, pno, region, e)

            isolated_png = b""
            mask_polygon = None
            if filled is not None:
                isolated_png = segmentation.make_isolated(crop, filled)
                mask_polygon = segmentation.polygon_to_page(poly, x, y)
                page_masks.append(segmentation.to_page_mask(filled, bgr.shape, x, y))

            # Idealised render: redraw the FULL labelled crop (all labels visible)
            # into a neat, labelled textbook illustration. Best-effort + cost-gated.
            ill_bytes, ill_usage = await illustrate_diagram(label_b64, result["title"], result["labels"])
            usage = _merge_usage(usage, ill_usage)

            original_rel = _save_asset(note_id, pno, region, "original", original_png)
            cleaned_rel = _save_asset(note_id, pno, region, "cleaned", cleaned)
            normalized_rel = _save_asset(note_id, pno, region, "normalized", normalized)
            isolated_rel = _save_asset(note_id, pno, region, "isolated", isolated_png)
            illustrated_rel = _save_asset(note_id, pno, region, "illustrated", ill_bytes)

            # UI badges + retrieval labels come STRICTLY from the VLM's visual
            # reading — never PaddleOCR line output (which garbles handwriting).
            labels = result["labels"]
            schema = result["schema"]
            nodes.append({
                "region_index": region, "page": pno,
                "title": result["title"] or f"Diagram (p.{pno})",
                "summary": result["summary"],
                "labels": labels, "ocr_text": ocr_text,
                "confidence": result["confidence"],
                "has_schema": schema is not None,
                "diagram_schema": schema,
                "qdrant_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"diagram:{note_id}:{pno}:{region}")),
                "original_crop_rel": original_rel,
                "cleaned_crop_rel": cleaned_rel,
                "normalized_image_rel": normalized_rel,
                "isolated_image_rel": isolated_rel,
                "illustrated_image_rel": illustrated_rel,
                "mask_polygon": mask_polygon,
                "surrounding_text": "",
                "subject_id": subject_id, "chapter_id": chapter_id,
                "topic_id": topic_id, "topic": topic, "is_primary": is_primary,
            })

        # ── Content separation (§2.3): subtract the diagram polygons from the
        # page and OCR what remains — the pure textual knowledge that ANCHORS
        # these diagrams. Structure (headings → bullets) survives via
        # reading-order + paragraph-gap reconstruction.
        page_nodes = [n for n in nodes if n["page"] == pno]
        if page_nodes and page_masks:
            try:
                sup_png = segmentation.suppress_regions(bgr, page_masks)
                if sup_png:
                    page_ocr = await paddleocr_client.ocr(base64.b64encode(sup_png).decode())
                    page_text = segmentation.lines_to_markdown(page_ocr.get("lines", [])) \
                        or page_ocr.get("text", "")
                    for n in page_nodes:
                        n["surrounding_text"] = page_text
            except Exception as e:  # noqa: BLE001
                log.warning("page text separation failed (note %s p%s): %s", note_id, pno, e)

    log.info("diagram ingest note=%s pages=%s nodes=%s", note_id, len(pages), len(nodes))
    return {"nodes": nodes, "pages": len(pages), "usage": usage.model_dump()}
