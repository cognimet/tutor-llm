#!/usr/bin/env python3
"""Extract a SCANNED MBBS Physiology textbook into RAG seed JSON, using a vision
model (the pages have NO text layer, so pdftotext/pypdf get nothing — verified:
1/810 pages had any text). This is the vision equivalent of
extract_ncert_science.py, producing the SAME seed-data JSON shape so the normal
seeder + `rag:index` flow embeds it into Qdrant's `curriculum` collection.

For each page it:
  * pulls the page's native full-page JPEG (sharper + smaller than re-rendering),
  * asks the vision model to CLASSIFY the page into one Physiology chapter, give
    a topic title, and TRANSCRIBE the text + describe any diagram, and
  * appends a per-page record; the grouped seed JSON is rebuilt on every save.

RESUMABLE + LIMIT-SAFE: per-page records are appended to <out>.pages.jsonl keyed
by (file, page); re-running skips pages already done. When the API returns a
persistent rate/daily limit (HTTP 429), the run STOPS cleanly WITHOUT recording
the failed page — so re-running the SAME command continues exactly where it
stopped (it never burns pages as blanks). One page at a time with a pause.

MULTIPLE FILES: pass --pdf repeatedly, or --src <dir>, to treat several PDFs
(e.g. an 800-page book split into 8 parts) as ONE continuous book.

Usage:
  export OPENAI_API_KEY=sk-or-...                 # OpenRouter key
  export OPENAI_BASE_URL=https://openrouter.ai/api/v1
  export AI_MODEL_VISION=nvidia/nemotron-nano-12b-v2-vl:free
  # one book split into parts:
  python3 scripts/extract_physiology.py --src ./physiology_parts \
      --out backend/database/seed-data/mbbs_physiology.json
  # or explicit files, processing 150 NEW pages this run (stay under a daily cap):
  python3 scripts/extract_physiology.py --pdf p1.pdf --pdf p2.pdf \
      --out backend/database/seed-data/mbbs_physiology.json --max-pages 150
  # re-run the SAME command to continue after a limit/stop.
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Chapter names MUST match MbbsCurriculumSeeder so chunks merge into the seeded
# curriculum (the seeder fuzzy-matches chapter/topic names).
CHAPTERS = [
    "General Physiology", "Blood (Hematology)", "Nerve & Muscle Physiology",
    "Gastrointestinal System", "Cardiovascular System", "Respiratory System",
    "Renal System", "Endocrine System", "Reproductive System", "Nervous System",
    "Special Senses", "Integrative & Applied Physiology",
]

LEVEL_SLUG = "mbbs-year-1"
SUBJECT = "Physiology"
PDF_FILE_REF = "educlub_physiology.pdf"

PROMPT = (
    "You are reading ONE page of a scanned MBBS first-year PHYSIOLOGY textbook "
    "(it may be hand-written with diagrams). Do BOTH:\n"
    "1) Classify the page into exactly ONE of these chapters:\n"
    + "\n".join(f"   - {c}" for c in CHAPTERS) + "\n"
    "2) Give a short topic title, and TRANSCRIBE all text exactly; for any "
    "diagram/figure/flowchart/table add a clear labelled description (structures, "
    "labels, arrows/flow, key values) a student can revise from.\n"
    "Reply as STRICT JSON only:\n"
    '{"chapter": "<one chapter from the list above>", '
    '"topic": "<short topic title>", '
    '"type": "diagram" | "explainer", '
    '"text": "<full transcription + any diagram description>"}\n'
    "If the page is a cover/blank/index page, set type to \"skip\"."
)


def vlm_read(img_b64: str, model: str, base: str, key: str, timeout: int = 120) -> dict:
    """Call an OpenAI-compatible (OpenRouter) chat endpoint with an image part."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
        ]}],
        "temperature": 0.1,
        "max_tokens": 1800,
    }
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    return parse_json(content)


def gemini_read(img_b64: str, model: str, timeout: int = 120) -> dict:
    """Read a page with Google Gemini (e.g. gemini-2.5-flash) via the Gemini API.
    Auth: GEMINI_API_KEY/GOOGLE_API_KEY (?key=), else an ADC OAuth token in
    GOOGLE_ACCESS_TOKEN (+ GOOGLE_CLOUD_PROJECT for the x-goog-user-project quota
    header — from `gcloud auth application-default print-access-token`)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    token = os.environ.get("GOOGLE_ACCESS_TOKEN")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json"}
    if api_key:
        url += f"?key={api_key}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
        if project:
            headers["x-goog-user-project"] = project
    else:
        raise RuntimeError("gemini: set GEMINI_API_KEY or GOOGLE_ACCESS_TOKEN")

    body = {
        "contents": [{"parts": [
            {"text": PROMPT},
            {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}},
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1800,
                             "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    cand = (data.get("candidates") or [{}])[0]
    parts = cand.get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    return parse_json(text)


def read_with_retry(do_call, tag: str):
    """do_call() -> dict (raises on failure). Returns (status, data):
    'ok' | 'limit' (STOP + resume later, page NOT recorded) | 'error' (skip page)."""
    for attempt in range(4):
        try:
            return "ok", do_call()
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()[:300]
            except Exception:  # noqa: BLE001
                pass
            if e.code == 429:
                if attempt < 3:
                    wait = 10 * (attempt + 1)  # 10s, 20s, 30s
                    print(f"  {tag}: 429 rate-limited, waiting {wait}s…", file=sys.stderr)
                    time.sleep(wait)
                    continue
                return "limit", None  # daily/sustained cap — stop and resume later
            if e.code in (401, 403):
                print(f"  {tag}: HTTP {e.code} auth/quota — stopping. {body}", file=sys.stderr)
                return "limit", None  # bad/expired token or quota → resume after fixing
            print(f"  {tag}: HTTP {e.code} — skipping. {body}", file=sys.stderr)
            return "error", None
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(8 * (attempt + 1))
                continue
            print(f"  {tag}: network error ({e}) — stopping (resumable)", file=sys.stderr)
            return "limit", None  # don't lose pages on a flaky connection
        except Exception as e:  # noqa: BLE001 — a single odd page shouldn't block
            print(f"  {tag}: {e} — skipping this page", file=sys.stderr)
            return "error", None


def parse_json(text: str) -> dict:
    """Pull the first {...} object out of a model reply (handles ``` fences)."""
    text = text.strip()
    if "```" in text:
        text = re.sub(r"^```[a-zA-Z]*", "", text).strip().strip("`").strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:  # noqa: BLE001
            pass
    return {}


def match_chapter(name: str) -> str:
    name = (name or "").strip().lower()
    for c in CHAPTERS:
        if c.lower() == name:
            return c
    for c in CHAPTERS:  # loose contains match
        key = re.sub(r"[^a-z]", "", c.lower())
        if key and key[:6] in re.sub(r"[^a-z]", "", name):
            return c
    return "General Physiology"


def assemble(records: list[dict]) -> dict:
    """Group per-page records -> the NCERT-shaped seed JSON."""
    chapters: dict[str, dict] = {}
    for rec in sorted(records, key=lambda r: r.get("page", 0)):
        if rec.get("type") == "skip" or not (rec.get("text") or "").strip():
            continue
        ch = match_chapter(rec.get("chapter", ""))
        topic = (rec.get("topic") or ch).strip()[:160]
        chapters.setdefault(ch, {})
        chapters[ch].setdefault(topic, [])
        chapters[ch][topic].append({
            "type": rec.get("type") if rec.get("type") in ("diagram", "explainer") else "explainer",
            "body": rec["text"].strip(),
            "page": rec.get("page", 0),
        })

    out_chapters = []
    for i, ch in enumerate(CHAPTERS, start=1):
        if ch not in chapters:
            continue
        topics = [{"section": "", "name": t, "chunks": chunks}
                  for t, chunks in chapters[ch].items()]
        out_chapters.append({"number": i, "name": ch, "file": PDF_FILE_REF, "topics": topics})

    return {
        "level_slug": LEVEL_SLUG, "subject": SUBJECT,
        "source": "Educlub Physiology (scanned, vision-extracted)",
        "chapters": out_chapters,
    }


def page_image(doc, page, dpi: int) -> bytes:
    """Native full-page JPEG when available (scanned book), else render to JPEG."""
    try:
        imgs = page.get_images(full=True)
        if len(imgs) == 1:
            info = doc.extract_image(imgs[0][0])
            if info.get("ext") in ("jpg", "jpeg") and info.get("image"):
                return info["image"]
    except Exception:  # noqa: BLE001
        pass
    return page.get_pixmap(dpi=dpi).tobytes("jpg")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", action="append", default=[], help="PDF path (repeat for multiple parts)")
    ap.add_argument("--src", help="directory of PDFs, processed in sorted filename order")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-pages", type=int, default=0,
                    help="max NEW pages to process THIS run (0 = all). Use it to stay under a "
                         "daily API cap; re-run the same command to continue.")
    ap.add_argument("--pause", type=float, default=1.2)
    ap.add_argument("--dpi", type=int, default=150, help="render DPI for non-image pages")
    ap.add_argument("--provider", choices=["openrouter", "gemini"], default="openrouter",
                    help="which vision model to read pages with")
    ap.add_argument("--gemini-model", default="gemini-2.5-flash")
    args = ap.parse_args()

    # Pick the per-page reader for the chosen provider.
    base = os.environ.get("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")
    or_model = os.environ.get("AI_MODEL_VISION", "nvidia/nemotron-nano-12b-v2-vl:free")
    or_key = os.environ.get("OPENAI_API_KEY")
    gmodel = args.gemini_model

    if args.provider == "gemini":
        if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
                or os.environ.get("GOOGLE_ACCESS_TOKEN")):
            print("ERROR: --provider gemini needs GEMINI_API_KEY/GOOGLE_API_KEY, or an ADC token "
                  "in GOOGLE_ACCESS_TOKEN (gcloud auth application-default print-access-token).",
                  file=sys.stderr)
            return 1

        def reader(b64):
            return gemini_read(b64, gmodel)
        model_label = f"gemini:{gmodel}"
    else:  # openrouter (default)
        if not or_key:
            print("ERROR: set OPENAI_API_KEY (your OpenRouter key) for --provider openrouter.", file=sys.stderr)
            return 1

        def reader(b64):
            return vlm_read(b64, or_model, base, or_key)
        model_label = f"openrouter:{or_model}"

    try:
        import fitz  # PyMuPDF
    except Exception:
        print("ERROR: pip install PyMuPDF", file=sys.stderr)
        return 1

    # One logical book from one or many PDFs (explicit --pdf order, then --src sorted).
    pdfs = list(args.pdf)
    if args.src:
        pdfs += [str(p) for p in sorted(Path(args.src).glob("*.pdf"))]
    pdfs = list(dict.fromkeys(pdfs))  # dedupe, keep order
    if not pdfs:
        print("ERROR: pass --pdf <file> (repeatable) or --src <dir>.", file=sys.stderr)
        return 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pages_file = out_path.with_suffix(".pages.jsonl")

    # Resume: records already extracted, keyed by (file, local page).
    records: list[dict] = []
    done: set[tuple] = set()
    if pages_file.exists():
        for line in pages_file.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
                records.append(rec)
                done.add((rec.get("file", ""), rec.get("local_page", rec.get("page"))))
            except Exception:  # noqa: BLE001
                pass
        print(f"resuming — {len(done)} pages already extracted")

    print(f"book: {len(pdfs)} file(s) with {model_label}")
    global_page = 0
    processed = 0      # NEW pages done this run
    stopped = False    # True if we stopped on a limit or the per-run budget
    fh = pages_file.open("a", encoding="utf-8")
    try:
        for pdf in pdfs:
            doc = fitz.open(pdf)
            fname = Path(pdf).name
            print(f"== {fname}: {doc.page_count} pages ==")
            for i in range(doc.page_count):
                global_page += 1
                lp = i + 1
                if (fname, lp) in done:
                    continue
                if args.max_pages and processed >= args.max_pages:
                    print(f"reached --max-pages={args.max_pages} for this run.")
                    stopped = True
                    break

                tag = f"{fname} p{lp}"
                img = page_image(doc, doc[i], args.dpi)
                b64 = base64.b64encode(img).decode()
                status, res = read_with_retry(lambda: reader(b64), tag)

                if status == "limit":
                    print("\n⏳ Hit the API rate/daily limit — progress saved.\n"
                          "   Re-run the SAME command later to continue from here.", file=sys.stderr)
                    stopped = True
                    break

                rec = {"file": fname, "local_page": lp, "page": global_page,
                       "chapter": "", "topic": "", "type": "explainer", "text": ""}
                if status == "ok" and res:
                    rec.update({k: res.get(k, rec[k]) for k in ("chapter", "topic", "type", "text")})
                elif status == "error":
                    rec["type"] = "error"

                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                fh.flush()
                records.append(rec)
                done.add((fname, lp))
                processed += 1

                if processed % 10 == 0:
                    out_path.write_text(json.dumps(assemble(records), ensure_ascii=False, indent=1), encoding="utf-8")
                    print(f"  …{processed} new this run ({len(done)} total pages)")

                time.sleep(args.pause)
            doc.close()
            if stopped:
                break
    finally:
        fh.close()

    out_path.write_text(json.dumps(assemble(records), ensure_ascii=False, indent=1), encoding="utf-8")
    grouped = assemble(records)
    nchunks = sum(len(t["chunks"]) for c in grouped["chapters"] for t in c["topics"])
    head = "STOPPED (resumable)" if stopped else "DONE"
    print(f"\n{head} -> {out_path}")
    print(f"  {len(done)} pages processed · {len(grouped['chapters'])} chapters · {nchunks} chunks")
    if stopped:
        print("  Re-run the SAME command to continue where it left off.")
    else:
        print("Next:\n  php artisan db:seed --class=MbbsPhysiologyContentSeeder --force\n"
              "  php artisan rag:index --pending")
    return 0


if __name__ == "__main__":
    sys.exit(main())
