"""Thin client for the Dockerized PaddleOCR microservice.

PaddleOCR runs as its own container (heavy paddle deps stay out of this image).
We POST a base64 crop and get back recognised text lines with boxes + scores.
Everything degrades gracefully: if PADDLE_OCR_URL is unset or the service is
down/slow, `ocr()` returns an empty result and the caller falls back to local
tesseract (and the VLM still reads labels during UVSS extraction), so diagram
ingestion never hard-depends on PaddleOCR being up.
"""
import logging

import httpx

from .config import settings

log = logging.getLogger("ai.paddleocr")


def enabled() -> bool:
    return bool(settings.paddle_ocr_url)


async def ocr(image_b64: str, lang: str | None = None, timeout: float = 30.0) -> dict:
    """Run PaddleOCR on a base64 image. Returns {"text": str, "lines": [...]} —
    or {} on any failure so the caller can fall back. `lines` items look like
    {"text": str, "score": float, "box": [[x,y],...]}."""
    if not settings.paddle_ocr_url:
        return {}
    url = settings.paddle_ocr_url.rstrip("/") + "/ocr"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json={
                "image_base64": image_b64,
                "lang": lang or settings.paddle_ocr_lang,
            })
            if r.status_code == 200:
                data = r.json()
                lines = data.get("lines") or []
                text = data.get("text") or "\n".join(
                    str(l.get("text", "")) for l in lines if l.get("text"))
                return {"text": (text or "").strip(), "lines": lines}
            log.warning("paddleocr error %s", r.status_code)
    except httpx.HTTPError as e:
        log.warning("paddleocr request failed: %s", e)
    except Exception as e:  # noqa: BLE001
        log.warning("paddleocr unexpected error: %s", e)
    return {}


def labels_from_lines(lines: list[dict], min_score: float = 0.5,
                      max_labels: int = 24) -> list[str]:
    """Pick short, high-confidence text lines as diagram labels (drop long
    sentences and low-score noise). Order preserved, de-duplicated."""
    out: list[str] = []
    seen: set[str] = set()
    for l in lines or []:
        txt = str(l.get("text", "")).strip()
        score = float(l.get("score", 1.0) or 0.0)
        if not txt or score < min_score:
            continue
        # Labels are short — a few words; longer runs are body text, not labels.
        if len(txt) > 40 or len(txt.split()) > 6:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= max_labels:
            break
    return out
