"""PaddleOCR microservice.

A tiny FastAPI wrapper around PaddleOCR, kept in its OWN container so the heavy
paddlepaddle/paddleocr wheels stay out of the main AI service image. The AI
service calls POST /ocr with a base64 crop; we return recognised text lines with
boxes + confidence. The model loads lazily on the first request (per language)
and is cached for the life of the process.

This service is OPTIONAL: the AI service degrades to local tesseract / the VLM's
own text reading when PADDLE_OCR_URL is unset or this container is down.
"""
import base64
import logging

from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("paddleocr")
app = FastAPI(title="PaddleOCR Service", version="1.0.0")

_ENGINES: dict[str, object] = {}


def _engine(lang: str):
    """One cached PaddleOCR engine per language (loaded on first use)."""
    if lang not in _ENGINES:
        from paddleocr import PaddleOCR
        log.info("loading PaddleOCR engine lang=%s", lang)
        _ENGINES[lang] = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
    return _ENGINES[lang]


class OcrRequest(BaseModel):
    image_base64: str
    lang: str = "en"


@app.get("/health")
def health():
    return {"ok": True, "loaded": list(_ENGINES.keys())}


@app.post("/ocr")
def ocr(req: OcrRequest):
    """Recognise text in a base64 image. Returns {text, lines:[{text,score,box}]}."""
    import cv2
    import numpy as np

    try:
        raw = base64.b64decode(req.image_base64, validate=False)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return {"text": "", "lines": [], "error": "could not decode image"}
    except Exception as e:  # noqa: BLE001
        return {"text": "", "lines": [], "error": f"decode failed: {e}"}

    try:
        result = _engine(req.lang).ocr(img, cls=True)
    except Exception as e:  # noqa: BLE001
        log.warning("ocr failed: %s", e)
        return {"text": "", "lines": [], "error": str(e)}

    lines: list[dict] = []
    for page in (result or []):
        for entry in (page or []):
            try:
                box, (txt, score) = entry[0], entry[1]
                if not txt:
                    continue
                lines.append({
                    "text": str(txt),
                    "score": float(score),
                    "box": [[float(p[0]), float(p[1])] for p in box],
                })
            except Exception:  # noqa: BLE001 — skip a malformed entry
                continue

    return {"text": "\n".join(l["text"] for l in lines), "lines": lines}
