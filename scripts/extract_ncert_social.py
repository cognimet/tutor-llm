#!/usr/bin/env python3
"""Extract the three NCERT Class 10 Social Science books (jess1/2/3) into RAG
seed JSON — one file per book.

Why chapter-level (not section-level like Maths/Science): the SST books have no
decimal-numbered sections, Geography is two-column with letter-spaced and
line-split ALL-CAPS headings ("L AND D EGRADATION", "WATER SCARCITY … / …
MANAGEMENT") buried among repeating running-heads, and several chapters expose
almost no parseable sub-headings at all. Reliable per-section segmentation isn't
achievable across all 17 chapters, so each chapter becomes ONE topic whose body
is chunked into ~1400-char passages. RAG retrieval is unaffected — the chunk
prose is identical; only topic granularity is coarser (one theme per chapter,
which suits these books).

Books (all map to the single "Social Science" subject in the curriculum):
  jess1 — Geography: Contemporary India II            (7 chapters)
  jess2 — Economics: Understanding Economic Development (5 chapters)
  jess3 — History: India and the Contemporary World II (5 chapters)

Usage: python3 extract_ncert_social.py --src <downloads_dir> --out-dir <dir>
where <downloads_dir> contains the three "Social Science 1|2|3" folders.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

# Each book: out filename stem, source label, subfolder, econ-style teacher-notes
# trimming, and the ordered chapter list [(no, pdf, canonical name)].
BOOKS = [
    {
        "stem": "geography", "folder": "Social Science 1",
        "source": "NCERT Class 10 Social Science · Geography (Contemporary India II)",
        "trim_teacher_notes": False,
        "chapters": [
            (1, "jess101.pdf", "Resources and Development"),
            (2, "jess102.pdf", "Forest and Wildlife Resources"),
            (3, "jess103.pdf", "Water Resources"),
            (4, "jess104.pdf", "Agriculture"),
            (5, "jess105.pdf", "Minerals and Energy Resources"),
            (6, "jess106.pdf", "Manufacturing Industries"),
            (7, "jess107.pdf", "Lifelines of National Economy"),
        ],
    },
    {
        "stem": "economics", "folder": "Social Science 2",
        "source": "NCERT Class 10 Social Science · Economics (Understanding Economic Development)",
        "trim_teacher_notes": True,
        "chapters": [
            (1, "jess201.pdf", "Development"),
            (2, "jess202.pdf", "Sectors of the Indian Economy"),
            (3, "jess203.pdf", "Money and Credit"),
            (4, "jess204.pdf", "Globalisation and the Indian Economy"),
            (5, "jess205.pdf", "Consumer Rights"),
        ],
    },
    {
        "stem": "history", "folder": "Social Science 3",
        "source": "NCERT Class 10 Social Science · History (India and the Contemporary World II)",
        "trim_teacher_notes": False,
        "chapters": [
            (1, "jess301.pdf", "The Rise of Nationalism in Europe"),
            (2, "jess302.pdf", "Nationalism in India"),
            (3, "jess303.pdf", "The Making of a Global World"),
            (4, "jess304.pdf", "The Age of Industrialisation"),
            (5, "jess305.pdf", "Print Culture and the Modern World"),
        ],
    },
]

TARGET = 1400
MIN_LEN = 180

# Lines dropped entirely: page numbers, reprint stamps, running heads, the
# exercise/activity/crossword apparatus, and figure/source captions.
NOISE = re.compile(
    r"^\s*("
    r"\d{1,3}|"
    r"Reprint \d{4}-\d{2}|Rationalised \d{4}-\d{2}|"
    r"(EXERCISES\s*)+|ACTIVITY|ACTIVITIES|PROJECT WORK|QUIZ DRIVE|"
    r"ACROSS|DOWN|LET'?S? (DO|RECALL|DISCUSS).*|"
    r"NOTES ?FOR ?THE ?TEACHERS?|TEACHER|NOTESFOR|FORTHE|TEACHERS|"
    r"Fig\.?\s?\d.*|Figure \d.*|Source ?[A-Z]?\s*:?.*|Map \d.*|Table \d.*"
    r")\s*$", re.I)

# Crossword grid rows: 4+ single letters separated by spaces.
CROSSWORD = re.compile(r"^\s*([A-Za-z]\s+){4,}[A-Za-z]?\s*$")

def pdf_text(path: Path) -> str:
    return subprocess.run(["pdftotext", str(path), "-"],
                          capture_output=True, text=True, check=True).stdout

def norm_caps(s: str) -> str:
    """Uppercase, drop non-letters and spaces — to compare a line against the
    chapter running-head regardless of letter-spacing ('A GRICULTURE')."""
    return re.sub(r"[^A-Z]", "", s.upper())

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def fix_dropcap(text: str) -> str:
    return re.sub(r"^([A-Z])\s+([a-z])", r"\1\2", text.strip())

def chapter_body(path: Path, chapter_name: str, trim_teacher_notes: bool):
    """Return list of (text, page) for the student-facing body, noise removed."""
    raw = pdf_text(path)
    rows, page = [], 1
    for ln in raw.splitlines():
        page += ln.count("\f")
        rows.append((ln.replace("\f", ""), page))

    if trim_teacher_notes:
        # Economics opens with a "NOTES FOR THE TEACHERS" spread; the real
        # chapter begins at the SECOND "CHAPTER N" marker (running head).
        marks = [i for i, (t, _) in enumerate(rows) if re.match(r"^\s*CHAPTER\b", t)]
        if len(marks) >= 2:
            rows = rows[marks[1] + 1:]

    head_key = norm_caps(chapter_name)
    body = []
    for text, page in rows:
        if NOISE.match(text) or CROSSWORD.match(text):
            continue
        # Drop the repeating chapter running-head (caps, possibly spaced).
        nk = norm_caps(text)
        if nk and (nk == head_key or (len(nk) > 6 and nk in head_key) or
                   (len(head_key) > 6 and head_key in nk)) and not any(c.islower() for c in text):
            continue
        body.append((text, page))
    return body

def pack_chunks(body):
    """Group blank-separated paragraphs, pack to ~TARGET chars, all 'explainer'."""
    paras, cur, cur_page = [], [], None
    def flush_para():
        nonlocal cur
        if cur:
            txt = clean(" ".join(cur))
            if len(txt) > 40:
                paras.append((txt, cur_page))
        cur = []
    for text, page in body:
        if not text.strip():
            flush_para(); continue
        if not cur:
            cur_page = page
        cur.append(text.strip())
    flush_para()
    if paras:
        paras[0] = (fix_dropcap(paras[0][0]), paras[0][1])

    chunks, buf, bpage = [], "", 1
    def flush_chunk():
        nonlocal buf
        if buf and len(buf) >= MIN_LEN:
            chunks.append({"type": "explainer", "body": buf.strip(), "page": bpage})
        elif buf and chunks:
            chunks[-1]["body"] += "\n\n" + buf.strip()
        elif buf:
            chunks.append({"type": "explainer", "body": buf.strip(), "page": bpage})
        buf = ""
    for txt, page in paras:
        if buf and len(buf) + len(txt) > TARGET:
            flush_chunk()
        if not buf:
            bpage = page
        buf = (buf + "\n\n" + txt).strip()
    flush_chunk()
    return [c for c in chunks if len(c["body"]) >= 70]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="dir containing the 3 SST folders")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()
    src, out_dir = Path(args.src), Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    grand = 0
    for book in BOOKS:
        folder = src / book["folder"]
        out = {"board": "CBSE", "class_number": 10, "subject": "Social Science",
               "source": book["source"], "chapters": []}
        print(f"\n### {book['source']}")
        for no, fname, name in book["chapters"]:
            path = folder / fname
            if not path.exists():
                print(f"  !! missing {fname}", file=sys.stderr); continue
            body = chapter_body(path, name, book["trim_teacher_notes"])
            chunks = pack_chunks(body)
            out["chapters"].append({"number": no, "name": name, "file": fname,
                                    "topics": [{"section": str(no), "name": name, "chunks": chunks}]})
            print(f"  ch{no:02d} {name}: {len(chunks)} chunks")
        path_out = out_dir / f"ncert_class10_sst_{book['stem']}.json"
        path_out.write_text(json.dumps(out, ensure_ascii=False, indent=1))
        n = sum(len(t["chunks"]) for c in out["chapters"] for t in c["topics"])
        grand += n
        print(f"  -> {n} chunks -> {path_out.name}")
    print(f"\nGRAND TOTAL: {grand} chunks across 3 books")

if __name__ == "__main__":
    main()
