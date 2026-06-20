#!/usr/bin/env python3
"""Convert the curated Grade 6 Maths RAG seed document (markdown) into seed JSON.

The source is a hand-authored "RAG Database Seed Document": 16 self-contained
chunks separated by `---`, each carrying a YAML metadata block (chunk_id,
chapter_number, chapter_title, section_title, tags, key_terms) followed by rich
content (definitions, formulas, exam-style Q&A). We map each chunk to its
Ganita Prakash chapter and emit the standard seed-JSON shape consumed by the
Laravel NcertContentSeeder.

Usage: python3 build_class6_curated_rag.py --md <md_path> --out <json_path>
"""
import argparse, json, re, sys
from pathlib import Path

# Canonical Class 6 (Ganita Prakash) chapter names — must match the curriculum.
CHAPTERS = [
    "Patterns in Mathematics", "Lines and Angles", "Number Play",
    "Data Handling and Presentation", "Prime Time", "Perimeter and Area",
    "Fractions", "Playing with Constructions", "Symmetry",
    "The Other Side of Zero",
]
CH_NO = {name: i + 1 for i, name in enumerate(CHAPTERS)}

# Chunks whose chapter_title doesn't directly name a single curriculum chapter.
TITLE_OVERRIDE = {
    "Front Matter & Introduction": "Patterns in Mathematics",
    "Prime Time to The Other Side of Zero": "Prime Time",
}

def parse_yaml_block(block):
    m = re.search(r"```yaml\s*\n(.*?)\n```", block, re.S)
    if not m:
        return None, None
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    content = block[m.end():].strip()
    return meta, content

def chunk_title(block):
    m = re.search(r"^###\s+Chunk\s+\d+:\s+(.+?)\s*$", block, re.M)
    return m.group(1).strip() if m else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    text = Path(args.md).read_text()
    # Split on horizontal rules that sit on their own line.
    blocks = re.split(r"\n---\n", text)

    # chapter name -> list of topic dicts
    by_chapter = {}
    order = []
    count = 0
    for block in blocks:
        meta, content = parse_yaml_block(block)
        if not meta or "chunk_id" not in meta:
            continue
        title = chunk_title(block) or meta.get("section_title", "Topic")
        chap_title = meta.get("chapter_title", "").strip()
        target = TITLE_OVERRIDE.get(chap_title, chap_title)
        if target not in CH_NO:
            print(f"!! chunk {meta.get('chunk_id')} chapter '{chap_title}' not mapped — skipped",
                  file=sys.stderr)
            continue

        section_title = meta.get("section_title", "").strip()
        key_terms = meta.get("key_terms", "").strip("[] ")
        # Prepend light context so the embedding/retrieval keys on the right
        # chapter + concepts, then the full curated content.
        body = (f"Class 6 Mathematics — {target}: {title}.\n"
                f"Section: {section_title}.\n"
                f"Key terms: {key_terms}.\n\n{content}").strip()

        topic = {
            "section": section_title or title,
            "name": title,
            "chunks": [{"type": "explainer", "body": body, "page": count + 1}],
        }
        if target not in by_chapter:
            by_chapter[target] = []
            order.append(target)
        by_chapter[target].append(topic)
        count += 1

    out = {"board": "CBSE", "class_number": 6, "subject": "Mathematics",
           "source": "NCERT Class 6 Mathematics — Ganita Prakash (curated RAG seed)",
           "chapters": []}
    for name in sorted(order, key=lambda n: CH_NO[n]):
        out["chapters"].append({"number": CH_NO[name], "name": name,
                                "file": "grade_6_math_curriculum_rag_seed.md",
                                "topics": by_chapter[name]})

    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"chunks: {count} across {len(out['chapters'])} chapters -> {args.out}")
    for ch in out["chapters"]:
        print(f"  ch{ch['number']:02d} {ch['name']}: {len(ch['topics'])} topics")

if __name__ == "__main__":
    main()
