#!/usr/bin/env python3
"""Extract NCERT Class 10 Science chapter PDFs (jesc1*) into RAG seed JSON.

Why this is separate from extract_ncert_pdfs.py (Maths): the Science book is
two-column with decorative *letter-spaced* headings ("SPHERIC AL MIRRORS",
"1 2 . 3 FORCE ON A CURRENT…") and drop-caps. pdftotext -layout interleaves the
columns and the heading text comes out garbled/truncated, so we instead:

  * use reading-order extraction (no -layout) for clean body prose, and
  * drive segmentation from a CURATED section map (canonical NCERT titles +
    section numbers) rather than trusting the extracted heading text. Each
    section's start is found with a SPACE-TOLERANT search for its number
    ("9 . 2", "1 2 . 3"), scanning forward from the previous section so later
    in-text references ("Fig. 9.2", "Activity 12.1") never steal a boundary.

Usage: python3 extract_ncert_science.py --src <pdf_dir> --out <json_path>
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

# chapter no -> (filename, chapter name, [(section_no, canonical_title), ...])
CHAPTERS = [
    (1, "jesc101.pdf", "Chemical Reactions and Equations", [
        ("1.1", "Chemical Equations"),
        ("1.2", "Types of Chemical Reactions"),
        ("1.3", "Have You Observed the Effects of Oxidation Reactions in Everyday Life?"),
    ]),
    (2, "jesc102.pdf", "Acids, Bases and Salts", [
        ("2.1", "Understanding the Chemical Properties of Acids and Bases"),
        ("2.2", "What do all Acids and all Bases have in Common?"),
        ("2.3", "How Strong are Acid or Base Solutions?"),
        ("2.4", "More about Salts"),
    ]),
    (3, "jesc103.pdf", "Metals and Non-metals", [
        ("3.1", "Physical Properties"),
        ("3.2", "Chemical Properties of Metals"),
        ("3.3", "How do Metals and Non-metals React?"),
        ("3.4", "Occurrence of Metals"),
    ]),
    (4, "jesc104.pdf", "Carbon and its Compounds", [
        ("4.1", "Bonding in Carbon – The Covalent Bond"),
        ("4.2", "Versatile Nature of Carbon"),
        ("4.3", "Chemical Properties of Carbon Compounds"),
        ("4.4", "Some Important Carbon Compounds – Ethanol and Ethanoic Acid"),
        ("4.5", "Soaps and Detergents"),
    ]),
    (5, "jesc105.pdf", "Life Processes", [
        ("5.1", "What are Life Processes?"),
        ("5.2", "Nutrition"),
        ("5.3", "Respiration"),
        ("5.4", "Transportation"),
        ("5.5", "Excretion"),
    ]),
    (6, "jesc106.pdf", "Control and Coordination", [
        ("6.1", "Animals – Nervous System"),
        ("6.2", "Coordination in Plants"),
        ("6.3", "Hormones in Animals"),
    ]),
    (7, "jesc107.pdf", "How do Organisms Reproduce?", [
        ("7.1", "Do Organisms Create Exact Copies of Themselves?"),
        ("7.2", "Modes of Reproduction Used by Single Organisms"),
        ("7.3", "Sexual Reproduction"),
    ]),
    (8, "jesc108.pdf", "Heredity", [
        ("8.1", "Accumulation of Variation During Reproduction"),
        ("8.2", "Heredity"),
    ]),
    (9, "jesc109.pdf", "Light – Reflection and Refraction", [
        ("9.1", "Reflection of Light"),
        ("9.2", "Spherical Mirrors"),
        ("9.3", "Refraction of Light"),
    ]),
    (10, "jesc110.pdf", "The Human Eye and the Colourful World", [
        ("10.1", "The Human Eye"),
        ("10.2", "Defects of Vision and their Correction"),
        ("10.3", "Refraction of Light through a Prism"),
        ("10.4", "Dispersion of White Light by a Glass Prism"),
        ("10.5", "Atmospheric Refraction"),
        ("10.6", "Scattering of Light"),
    ]),
    (11, "jesc111.pdf", "Electricity", [
        ("11.1", "Electric Current and Circuit"),
        ("11.2", "Electric Potential and Potential Difference"),
        ("11.3", "Circuit Diagram"),
        ("11.4", "Ohm's Law"),
        ("11.5", "Factors on which the Resistance of a Conductor Depends"),
        ("11.6", "Resistance of a System of Resistors"),
        ("11.7", "Heating Effect of Electric Current"),
        ("11.8", "Electric Power"),
    ]),
    (12, "jesc112.pdf", "Magnetic Effects of Electric Current", [
        ("12.1", "Magnetic Field and Field Lines"),
        ("12.2", "Magnetic Field due to a Current-carrying Conductor"),
        ("12.3", "Force on a Current-carrying Conductor in a Magnetic Field"),
        ("12.4", "Domestic Electric Circuits"),
    ]),
    (13, "jesc113.pdf", "Our Environment", [
        ("13.1", "Ecosystem — What are its Components?"),
        ("13.2", "How do our Activities affect the Environment?"),
    ]),
]

TARGET = 1400
MIN_LEN = 180

# Lines to drop entirely: running heads, page numbers, reprint stamps, figure
# captions, activity/table labels, and stray letter-spaced caps fragments.
NOISE = re.compile(
    r"^\s*(\d{1,3}|Science|Reprint \d{4}-\d{2}|Rationalised \d{4}-\d{2}|"
    r"Figure \d+\.\d+.*|Fig\.? ?\d.*|Table \d+\.\d+.*|Activity ?_+.*|"
    r"Activity \d+\.\d+\s*)$", re.I)

def pdf_text(path: Path, layout=False) -> str:
    cmd = ["pdftotext"] + (["-layout"] if layout else []) + [str(path), "-"]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout

def tolerant_number_re(num: str) -> re.Pattern:
    """'9.2' -> matches '9 . 2', '12.3' -> '1 2 . 3', at line start, followed by
    an uppercase letter (the title) — not '.' (sub-section) or '(' (reference)."""
    parts = list(num)  # e.g. ['1','2','.','3']
    pat = r"\s*".join(re.escape(c) for c in parts)
    return re.compile(rf"^\s*{pat}\s+[A-Z]")

def fix_dropcap(text: str) -> str:
    # "C onsider" -> "Consider", "H ow do" -> "How do" (section-opening drop cap).
    return re.sub(r"^([A-Z])\s+([a-z])", r"\1\2", text.strip())

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def find_boundaries(lines, sections):
    """Return [(line_idx, section_no, title), ...] in document order."""
    bounds, search_from = [], 0
    for num, title in sections:
        rx = tolerant_number_re(num)
        for i in range(search_from, len(lines)):
            if rx.match(lines[i]):
                bounds.append((i, num, title))
                search_from = i + 1
                break
        else:
            print(f"   !! section {num} not located", file=sys.stderr)
    return bounds

def split_into_chunks(body_lines):
    """body_lines: list of (text, page). Group blank-separated paragraphs,
    tag Example blocks, pack to ~TARGET chars."""
    paras, cur, cur_page, mode = [], [], None, "explainer"

    def flush_para():
        nonlocal cur
        if cur:
            txt = clean(" ".join(cur))
            if len(txt) > 40:
                paras.append((mode, txt, cur_page))
        cur = []

    for text, page in body_lines:
        if not text.strip():
            flush_para()
            continue
        if NOISE.match(text):
            continue
        if re.match(r"^\s*Example\s+\d+", text, re.I):
            flush_para(); mode = "example"; cur_page = page; cur = [text.strip()]; continue
        if re.match(r"^\s*(Q\s?U\s?E\s?S\s?T\s?I\s?O\s?N\s?S|E\s?X\s?E\s?R\s?C\s?I\s?S\s?E)", text):
            flush_para(); mode = "example"; cur_page = page; cur = ["Questions:"]; continue
        if not cur:
            cur_page = page
        cur.append(text.strip())
    flush_para()

    chunks, buf, btype, bpage = [], "", None, 1
    def flush_chunk():
        nonlocal buf
        if buf and len(buf) >= MIN_LEN:
            chunks.append({"type": btype, "body": buf.strip(), "page": bpage})
        elif buf and chunks and chunks[-1]["type"] == btype:
            chunks[-1]["body"] += "\n\n" + buf.strip()
        elif buf:
            chunks.append({"type": btype, "body": buf.strip(), "page": bpage})
        buf = ""
    for mode_, txt, page in paras:
        if buf and (mode_ != btype or len(buf) + len(txt) > TARGET):
            flush_chunk()
        if not buf:
            btype, bpage = mode_, page
        buf = (buf + "\n\n" + txt).strip()
    flush_chunk()
    # Drop tiny standalone fragments (stray figure captions the noise filter
    # missed) that couldn't merge into a neighbour.
    return [c for c in chunks if len(c["body"]) >= 70]

def parse_chapter(path: Path, sections):
    raw = pdf_text(path)
    # Build (line_text, page) keeping form-feed page tracking.
    rows, page = [], 1
    for ln in raw.splitlines():
        page += ln.count("\f")
        rows.append((ln.replace("\f", ""), page))
    lines = [r[0] for r in rows]

    bounds = find_boundaries(lines, sections)
    topics = []
    for idx, (start, num, title) in enumerate(bounds):
        end = bounds[idx + 1][0] if idx + 1 < len(bounds) else len(rows)
        seg = rows[start + 1:end]  # skip the garbled heading line itself
        # drop leading title-echo lines: letter-spaced caps ("V ARIA TION") or
        # short all-caps remnants of the heading ("W LAW", "TR ANSPORT").
        while seg and (re.match(r"^\s*([A-Z]\s*){3,}$", seg[0][0])
                       or (seg[0][0].strip()
                           and len(seg[0][0].strip()) <= 12
                           and re.match(r"^[A-Z '’]+$", seg[0][0].strip()))):
            seg = seg[1:]
        if seg:
            seg[0] = (fix_dropcap(seg[0][0]), seg[0][1])
        chunks = split_into_chunks(seg)
        if chunks:
            topics.append({"section": num, "name": title, "chunks": chunks})
    return topics

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    src = Path(args.src)

    out = {"board": "CBSE", "class_number": 10, "subject": "Science",
           "source": "NCERT Class 10 Science (jesc1)", "chapters": []}
    for no, fname, name, sections in CHAPTERS:
        path = src / fname
        if not path.exists():
            print(f"!! missing {fname}", file=sys.stderr); continue
        topics = parse_chapter(path, sections)
        out["chapters"].append({"number": no, "name": name, "file": fname, "topics": topics})
        n = sum(len(t["chunks"]) for t in topics)
        print(f"ch{no:02d} {name}: {len(topics)}/{len(sections)} topics, {n} chunks")
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    total = sum(len(t["chunks"]) for c in out["chapters"] for t in c["topics"])
    print(f"TOTAL chunks: {total} -> {args.out}")

if __name__ == "__main__":
    main()
