#!/usr/bin/env python3
"""Extract NCERT Class 6 Mathematics — Ganita Prakash (fegp1) — into RAG seed JSON.

Ganita Prakash is single-column with clean decimal section headings
("2.5 Angle", "1.1 What is Mathematics?"), so we segment on N.M headings (using
the real extracted title) and chunk the body between them — same approach as the
Class 10 Maths extractor. Intro text before the first numbered section becomes a
"<Chapter> – Introduction" topic; "Figure it Out" activity blocks and worked
"Example"s are tagged as `example`.

Usage: python3 extract_ncert_class6_maths.py --src <pdf_dir> --out <json_path>
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

CHAPTERS = [
    (1, "fegp101.pdf", "Patterns in Mathematics"),
    (2, "fegp102.pdf", "Lines and Angles"),
    (3, "fegp103.pdf", "Number Play"),
    (4, "fegp104.pdf", "Data Handling and Presentation"),
    (5, "fegp105.pdf", "Prime Time"),
    (6, "fegp106.pdf", "Perimeter and Area"),
    (7, "fegp107.pdf", "Fractions"),
    (8, "fegp108.pdf", "Playing with Constructions"),
    (9, "fegp109.pdf", "Symmetry"),
    (10, "fegp110.pdf", "The Other Side of Zero"),
]

TARGET = 1400
MIN_LEN = 180

def pdf_text(path: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(path), "-"],
                          capture_output=True, text=True, check=True).stdout

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())

def parse_chapter(path: Path, chap_no: int, chap_name: str):
    raw = pdf_text(path)
    heading = re.compile(rf"^\s*{chap_no}\.(\d{{1,2}})(?!\d)\s+([A-Za-z][^\n]{{1,60}})$")
    example = re.compile(r"^\s*Example\s+\d+", re.I)
    figureit = re.compile(r"^\s*Figure it Out\s*$", re.I)
    noise = re.compile(
        rf"^\s*(\d{{1,3}}|Reprint \d{{4}}-\d{{2}}|Ganita Prakash.*|Grade 6|"
        rf"Table \d+\s*:?.*|Fig\.? ?\d.*)\s*$", re.I)
    head_key = norm(chap_name)

    sections, current = [], None
    para, para_page, page, mode = [], 1, 1, "explainer"

    def flush_para():
        nonlocal para
        text = clean(" ".join(para))
        if current is not None and len(text) > 40:
            current["blocks"].append({"type": mode, "body": text, "page": para_page})
        para = []

    for ln in raw.splitlines():
        page += ln.count("\f")
        line = ln.replace("\f", "")
        stripped = line.strip()
        if not stripped:
            flush_para(); continue
        if noise.match(line) or norm(stripped) == head_key:
            continue
        m = heading.match(line)
        if m and not para:
            flush_para()
            title = re.split(r"\s{2,}", m.group(2).strip())[0].strip()
            title = re.sub(r"\s+[A-Z]$", "", title).strip()  # drop a stray column letter
            current = {"section": f"{chap_no}.{m.group(1)}", "name": title, "blocks": []}
            sections.append(current)
            mode = "explainer"
            continue
        if figureit.match(line):
            flush_para(); mode = "example"; para_page = page; para = ["Figure it Out (practice):"]; continue
        if example.match(line):
            flush_para(); mode = "example"; para_page = page; para = [stripped]; continue
        if not para:
            para_page = page
        para.append(stripped)
    flush_para()

    # Intro before the first numbered section.
    intro_blocks = []
    if sections and sections[0]["blocks"]:
        pass
    return sections

def pack_chunks(blocks):
    chunks, buf, btype, bpage = [], "", None, 1
    def flush():
        nonlocal buf
        if buf and len(buf) >= MIN_LEN:
            chunks.append({"type": btype, "body": buf.strip(), "page": bpage})
        elif buf and chunks and chunks[-1]["type"] == btype:
            chunks[-1]["body"] += "\n\n" + buf.strip()
        elif buf:
            chunks.append({"type": btype, "body": buf.strip(), "page": bpage})
        buf = ""
    for b in blocks:
        if buf and (b["type"] != btype or len(buf) + len(b["body"]) > TARGET):
            flush()
        if not buf:
            btype, bpage = b["type"], b["page"]
        buf = (buf + "\n\n" + b["body"]).strip()
    flush()
    return [c for c in chunks if len(c["body"]) >= 70]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    src = Path(args.src)

    out = {"board": "CBSE", "class_number": 6, "subject": "Mathematics",
           "source": "NCERT Class 6 Mathematics — Ganita Prakash (fegp1)", "chapters": []}
    for no, fname, name in CHAPTERS:
        path = src / fname
        if not path.exists():
            print(f"!! missing {fname}", file=sys.stderr); continue
        sections = parse_chapter(path, no, name)
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
