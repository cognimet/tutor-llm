"""Background ingestion of large textbook PDFs into the GraphRAG "AI mind".

The MBBS Physiology book is ~800 hand-drawn pages: `pypdf.extract_text()` gets
almost nothing, so we treat every page as an image. For each page we:
  1) rasterise it with PyMuPDF,
  2) read it with the vision model (diagram structures, labels, flow — not just
     OCR), and
  3) embed that description into Qdrant `documents` as a FIGURE, so the tutor
     retrieves and teaches from it (notes-first), and the UI can show the page.

Built for the realities of an 800-page book on a free-tier VLM:
  * ONE page at a time with a polite pause — don't trip rate limits.
  * Per-page try/except — one unreadable page never aborts the whole run.
  * RESUMABLE — progress + per-page state persist to a sidecar JSON beside the
    page images; a crash/restart continues where it stopped (figure point ids
    are deterministic, so re-doing a page overwrites instead of duplicating).

State lives under `${UPLOAD_ROOT}/figures/{note_id}/`:
  p0001.png …            rendered page images (served by Laravel)
  _progress.json         {state,total,done,figures,blank,failed,error,…}
"""
import asyncio
import base64
import json
import logging
import os
import time

from .config import settings
from . import rag
from .providers import read_image

log = logging.getLogger("ai.pdfjobs")

# Per-process registry of running ingests, keyed by note_id. Survives within a
# process; on restart we rehydrate status from the on-disk _progress.json.
_JOBS: dict[int, dict] = {}
_TASKS: dict[int, asyncio.Task] = {}

_VISION_FIGURE = (
    "You are reading ONE page of a student's medical/science textbook (it may be "
    "hand-drawn). If the page is a diagram, figure, flowchart or table, do this:\n"
    "TITLE: <a short title for the figure>\n"
    "TOPIC: <the anatomy/physiology topic it belongs to, your best guess>\n"
    "LABELS: <comma-separated list of every labelled structure/part>\n"
    "Then a clear, exam-ready description: what the figure shows, how the parts "
    "relate, the direction of any arrows/flow, and key values. Transcribe ALL "
    "printed/handwritten text exactly. If the page is plain prose, just transcribe "
    "it. Output study text only — no preamble."
)


def _figdir(note_id: int) -> str:
    return os.path.join(settings.upload_root, "figures", str(note_id))


def _progress_path(note_id: int) -> str:
    return os.path.join(_figdir(note_id), "_progress.json")


def _load_progress(note_id: int) -> dict | None:
    try:
        with open(_progress_path(note_id), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def _save_progress(p: dict) -> None:
    try:
        os.makedirs(_figdir(p["note_id"]), exist_ok=True)
        p["updated_at"] = time.time()
        tmp = _progress_path(p["note_id"]) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(p, f)
        os.replace(tmp, _progress_path(p["note_id"]))
    except Exception as e:  # noqa: BLE001
        log.warning("could not persist progress for note %s: %s", p.get("note_id"), e)


def status(note_id: int) -> dict | None:
    """Live status for a note's ingest (memory first, then the on-disk sidecar)."""
    return _JOBS.get(note_id) or _load_progress(note_id)


def _parse_vision(text: str) -> tuple[str, str, list[str], str | None]:
    """Pull TITLE / TOPIC / LABELS off the VLM output; the rest is the body."""
    title, topic, labels, body_lines = "", None, [], []
    for line in (text or "").splitlines():
        s = line.strip()
        up = s.upper()
        if up.startswith("TITLE:") and not title:
            title = s.split(":", 1)[1].strip()
        elif up.startswith("TOPIC:") and topic is None:
            topic = s.split(":", 1)[1].strip() or None
        elif up.startswith("LABELS:") and not labels:
            labels = [x.strip() for x in s.split(":", 1)[1].split(",") if x.strip()]
        else:
            body_lines.append(line)
    return title, "\n".join(body_lines).strip() or (text or "").strip(), labels, topic


def _is_blank(pix) -> bool:
    """Near-white page (no ink) → skip the VLM call. Sample bytes for speed."""
    try:
        samples = pix.samples
        n = len(samples)
        if n == 0:
            return True
        step = max(1, n // 4096)
        sampled = samples[::step]
        mean = sum(sampled) / len(sampled)
        return mean >= 250  # essentially white
    except Exception:  # noqa: BLE001
        return False


def _page_image(doc, page) -> tuple[bytes | None, str, str, bool]:
    """Return (bytes, mime, ext, blank) for a page. Scanned books store each page
    as ONE full-page JPEG — use it natively: it's sharper (full source resolution)
    AND ~4x smaller than re-rasterising to PNG. Fall back to rendering at
    `pdf_render_dpi` for vector/text pages."""
    try:
        imgs = page.get_images(full=True)
        if len(imgs) == 1:
            info = doc.extract_image(imgs[0][0])
            if info.get("ext") in ("jpg", "jpeg") and info.get("image"):
                return info["image"], "image/jpeg", "jpg", False
    except Exception:  # noqa: BLE001 — fall back to rasterising
        pass
    pix = page.get_pixmap(dpi=settings.pdf_render_dpi)
    if _is_blank(pix):
        return None, "", "", True
    return pix.tobytes("jpg"), "image/jpeg", "jpg", False


async def _ingest_page(doc, i: int, p: dict) -> None:
    page = doc[i]
    pno = i + 1
    img, mime, ext, blank = _page_image(doc, page)
    if blank:
        p["blank"] += 1
        return

    rel = os.path.join("figures", str(p["note_id"]), f"p{pno:04d}.{ext}")
    abspath = os.path.join(settings.upload_root, rel)
    try:
        os.makedirs(os.path.dirname(abspath), exist_ok=True)
        with open(abspath, "wb") as f:
            f.write(img)
    except Exception as e:  # noqa: BLE001
        log.warning("could not write page image %s: %s", abspath, e)

    text, _usage = await read_image(base64.b64encode(img).decode(), mime, _VISION_FIGURE)
    text = (text or "").strip()
    if len(text) < 12:
        p["empty"] += 1
        return

    title, body, labels, vtopic = _parse_vision(text)
    pid = await rag.index_figure(
        user_id=p["user_id"], note_id=p["note_id"], page=pno,
        title=title or f"Figure (p.{pno})", description=body, labels=labels,
        image_rel=rel, subject_id=p.get("subject_id"), topic=vtopic or p.get("topic"),
        topic_id=p.get("topic_id"), is_primary=bool(p.get("is_primary")),
    )
    if pid:
        p["figures"] += 1

    # Also embed the page TEXT into the vetted `curriculum` collection so the
    # uploaded book IS the subject's curriculum grounding (not AI-authored).
    cid = await rag.index_curriculum_doc(
        note_id=p["note_id"], page=pno,
        body="\n".join(x for x in (title, body) if x).strip(),
        subject_id=p.get("subject_id"), topic=vtopic or p.get("topic"),
    )
    if cid:
        p["curriculum"] = p.get("curriculum", 0) + 1


async def _run(note_id: int) -> None:
    import fitz  # PyMuPDF

    p = _JOBS[note_id]
    path = p["abs_path"]
    try:
        doc = fitz.open(path)
    except Exception as e:  # noqa: BLE001
        p["state"], p["error"] = "failed", f"Could not open PDF: {e}"
        _save_progress(p)
        return

    p["total"] = doc.page_count
    p["state"] = "running"
    _save_progress(p)
    log.info("textbook ingest start: note=%s pages=%s file=%s", note_id, p["total"], path)

    start_at = int(p.get("done", 0))  # resume from where a prior run stopped
    for i in range(start_at, doc.page_count):
        if p.get("cancel"):
            p["state"] = "cancelled"
            break
        try:
            await _ingest_page(doc, i, p)
        except Exception as e:  # noqa: BLE001 — one bad page never aborts the run
            p["failed"] += 1
            log.warning("page %s failed (note %s): %s", i + 1, note_id, e)
        p["done"] = i + 1
        if (i + 1) % 5 == 0 or i + 1 == doc.page_count:
            _save_progress(p)
        await asyncio.sleep(settings.pdf_page_pause)  # be gentle on the free tier

    doc.close()
    if p["state"] not in ("cancelled", "failed"):
        p["state"] = "done"
    _save_progress(p)
    log.info("textbook ingest %s: note=%s figures=%s blank=%s failed=%s",
             p["state"], note_id, p["figures"], p["blank"], p["failed"])


async def start(note_id: int, rel_path: str, user_id: int, *, subject_id: int | None = None,
                subject: str | None = None, topic: str | None = None,
                topic_id: int | None = None, is_primary: bool = False) -> dict:
    """Begin (or resume) ingesting a textbook PDF. Returns the initial status.
    Idempotent: calling again while running just returns the live status."""
    if note_id in _TASKS and not _TASKS[note_id].done():
        return _JOBS[note_id]

    abs_path = os.path.join(settings.upload_root, rel_path)
    if not os.path.exists(abs_path):
        return {"note_id": note_id, "state": "failed",
                "error": f"File not found on the shared volume: {rel_path}"}

    prior = _load_progress(note_id) or {}
    p = {
        "note_id": note_id, "abs_path": abs_path, "rel_path": rel_path,
        "user_id": user_id, "subject_id": subject_id, "subject": subject,
        "topic": topic, "topic_id": topic_id, "is_primary": is_primary,
        "state": "queued", "total": prior.get("total", 0),
        "done": prior.get("done", 0), "figures": prior.get("figures", 0),
        "curriculum": prior.get("curriculum", 0),
        "blank": prior.get("blank", 0), "empty": prior.get("empty", 0),
        "failed": prior.get("failed", 0), "error": None, "cancel": False,
        "started_at": prior.get("started_at", time.time()),
    }
    _JOBS[note_id] = p
    _save_progress(p)
    _TASKS[note_id] = asyncio.create_task(_run(note_id))
    return p


def cancel(note_id: int) -> dict | None:
    p = _JOBS.get(note_id)
    if p:
        p["cancel"] = True
    return p
