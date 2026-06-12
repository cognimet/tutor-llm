#!/usr/bin/env python3
"""Extract NCERT Class 10 Maths chapter PDFs (jemh1*) into RAG seed JSON.

Usage: python3 extract.py --src <pdf_dir> --out <json_path>

Output shape consumed by the Laravel NcertContentSeeder:
{
  "board": "CBSE", "class_number": 10, "subject": "Mathematics",
  "source": "NCERT Class 10 Mathematics (jemh1)",
  "chapters": [{"number": 1, "name": "Real Numbers", "file": "jemh101.pdf",
                "topics": [{"section": "1.2", "name": "...", 
                            "chunks": [{"type": "explainer|example", "body": "...", "page": 3}]}]}]
}
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

CHAPTERS = {
    "jemh101.pdf": (1, "Real Numbers"),
    "jemh102.pdf": (2, "Polynomials"),
    "jemh103.pdf": (3, "Pair of Linear Equations in Two Variables"),
    "jemh104.pdf": (4, "Quadratic Equations"),
    "jemh105.pdf": (5, "Arithmetic Progressions"),
    "jemh106.pdf": (6, "Triangles"),
    "jemh107.pdf": (7, "Coordinate Geometry"),
    "jemh108.pdf": (8, "Introduction to Trigonometry"),
    "jemh109.pdf": (9, "Some Applications of Trigonometry"),
    "jemh110.pdf": (10, "Circles"),
    "jemh111.pdf": (11, "Areas Related to Circles"),
    "jemh112.pdf": (12, "Surface Areas and Volumes"),
    "jemh113.pdf": (13, "Statistics"),
    "jemh114.pdf": (14, "Probability"),
}

TARGET = 1400   # soft max chars per chunk
MIN_LEN = 180   # merge anything smaller into neighbour

NOISE = re.compile(
    r"^\s*(Reprint \d{4}-\d{2}|Rationalised \d{4}-\d{2}|\d{1,3}|"
    r"[A-Z][A-Z &,'’–-]{3,}\s*\d{0,3}|\d{1,3}\s+[A-Z][A-Z &,'’–-]{3,}|Fig\.? ?[\d.]*)\s*$"
)

def pdf_text(path: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(path), "-"],
                          capture_output=True, text=True, check=True).stdout

def clean_line(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def parse_chapter(path: Path, chap_no: int):
    """Return list of sections: {section, name, blocks:[{type, body, page}]}."""
    raw = pdf_text(path)
    heading = re.compile(rf"^\s*({chap_no})\.(\d{{1,2}})\s+([A-Za-z][^=]{{2,60}}?)\s*$")
    example = re.compile(r"^\s*Example\s+\d+\s*:", re.I)
    exercise = re.compile(rf"^\s*EXERCISE\s+{chap_no}\.\d+\s*$")

    sections, current = [], None
    para, para_page, page = [], 1, 1
    mode = "explainer"  # explainer | example

    def flush_para():
        nonlocal para
        text = clean_line(" ".join(para))
        if current is not None and len(text) > 40:
            current["blocks"].append({"type": mode, "body": text, "page": para_page})
        para = []

    for line in raw.splitlines(keepends=False):
        page += line.count("\f")
        line = line.replace("\f", "")
        if not line.strip():
            flush_para()
            continue
        if NOISE.match(line):
            continue
        m = heading.match(line)
        if m and (not para or len(m.group(3).split()) <= 8) \
                and not m.group(3).rstrip().endswith((".", ",", ";")):
            flush_para()
            name = clean_line(m.group(3))
            current = {"section": f"{chap_no}.{m.group(2)}", "name": name, "blocks": []}
            sections.append(current)
            mode = "explainer"
            continue
        if exercise.match(line):
            flush_para()
            mode = "example"
            para_page = page
            para = [f"Exercise {clean_line(line).split()[-1]} (practice questions):"]
            continue
        if example.match(line):
            flush_para()
            mode = "example"
            para_page = page
            para = [line.strip()]
            continue
        if not para:
            para_page = page
            # a fresh non-example paragraph after an example/exercise block ends
            # only when it clearly starts prose at a section level; keep mode
            # sticky inside solutions ("Solution :") so worked steps stay examples.
        para.append(line.strip())
    flush_para()
    return sections

def pack_chunks(blocks):
    """Merge consecutive same-type blocks into ~TARGET-char chunks."""
    chunks, buf, buf_type, buf_page = [], "", None, 1
    def flush():
        nonlocal buf
        if buf and len(buf) >= MIN_LEN:
            chunks.append({"type": buf_type, "body": buf.strip(), "page": buf_page})
        elif buf and chunks and chunks[-1]["type"] == buf_type:
            chunks[-1]["body"] += "\n\n" + buf.strip()
        elif buf:
            chunks.append({"type": buf_type, "body": buf.strip(), "page": buf_page})
        buf = ""
    for b in blocks:
        if buf and (b["type"] != buf_type or len(buf) + len(b["body"]) > TARGET):
            flush()
        if not buf:
            buf_type, buf_page = b["type"], b["page"]
        buf = (buf + "\n\n" + b["body"]).strip()
    flush()
    return chunks

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    src = Path(args.src)

    out = {"board": "CBSE", "class_number": 10, "subject": "Mathematics",
           "source": "NCERT Class 10 Mathematics (jemh1)", "chapters": []}
    for fname, (no, name) in CHAPTERS.items():
        path = src / fname
        if not path.exists():
            print(f"!! missing {fname}", file=sys.stderr); continue
        sections = parse_chapter(path, no)
        topics = []
        for s in sections:
            sec_name = s["name"]
            if sec_name.lower() in ("introduction", "summary"):
                sec_name = f"{name} – {s['name']}"
            chunks = pack_chunks(s["blocks"])
            if chunks:
                topics.append({"section": s["section"], "name": sec_name, "chunks": chunks})
        out["chapters"].append({"number": no, "name": name, "file": fname, "topics": topics})
        n = sum(len(t["chunks"]) for t in topics)
        print(f"ch{no:02d} {name}: {len(topics)} topics, {n} chunks")
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    total = sum(len(t["chunks"]) for c in out["chapters"] for t in c["topics"])
    print(f"TOTAL chunks: {total} -> {args.out}")

if __name__ == "__main__":
    main()
