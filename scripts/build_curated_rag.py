#!/usr/bin/env python3
"""Convert any curated RAG seed Markdown (produced by the textbook-to-rag-compiler
skill) into the seed-JSON shape consumed by the Laravel NcertContentSeeder.

Generic version: chapters are derived from each chunk's YAML metadata
(chapter_number + chapter_title), so it works for any subject/class without a
hardcoded chapter list. A chunk with chapter_number 0 (front matter) is attached
to the lowest-numbered real chapter.

Usage:
  python3 build_curated_rag.py --md <md> --out <json> \
      --board CBSE --class 6 --subject Science --source "<label>"
"""
import argparse, json, re, sys
from pathlib import Path

def parse_yaml_block(block):
    m = re.search(r"```yaml\s*\n(.*?)\n```", block, re.S)
    if not m:
        return None, None
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip("'\"")
    return meta, block[m.end():].strip()

def chunk_title(block):
    m = re.search(r"^###\s+Chunk\s+\d+:\s+(.+?)\s*$", block, re.M)
    return m.group(1).strip() if m else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--board", default="CBSE")
    ap.add_argument("--class", dest="klass", type=int, required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--source", default="")
    args = ap.parse_args()

    blocks = re.split(r"\n---\n", Path(args.md).read_text())

    parsed = []  # (chap_no, chap_title, topic_dict)
    count = 0
    for block in blocks:
        meta, content = parse_yaml_block(block)
        if not meta or "chunk_id" not in meta:
            continue
        chap_no = int(meta.get("chapter_number", 0) or 0)
        chap_title = meta.get("chapter_title", "").strip()
        title = chunk_title(block) or meta.get("section_title", "Topic")
        section_title = meta.get("section_title", "").strip()
        key_terms = meta.get("key_terms", "").strip("[] ")
        body = (f"Class {args.klass} {args.subject} — {chap_title}: {title}.\n"
                f"Section: {section_title}.\nKey terms: {key_terms}.\n\n{content}").strip()
        topic = {"section": section_title or title, "name": title,
                 "chunks": [{"type": "explainer", "body": body, "page": count + 1}]}
        parsed.append((chap_no, chap_title, topic))
        count += 1

    # Resolve real chapter numbers; map front-matter (0) to the smallest real one.
    real = sorted({n for n, _, _ in parsed if n > 0})
    min_real = real[0] if real else 1
    by_chapter, order = {}, []
    for chap_no, chap_title, topic in parsed:
        if chap_no == 0:
            # attach to the first real chapter (by title)
            target_no = min_real
            target_title = next((t for n, t, _ in parsed if n == min_real), chap_title)
        else:
            target_no, target_title = chap_no, chap_title
        key = (target_no, target_title)
        if key not in by_chapter:
            by_chapter[key] = []
            order.append(key)
        by_chapter[key].append(topic)

    out = {"board": args.board, "class_number": args.klass, "subject": args.subject,
           "source": args.source or f"{args.board} Class {args.klass} {args.subject} (curated RAG seed)",
           "chapters": []}
    for (no, name) in sorted(order, key=lambda k: k[0]):
        out["chapters"].append({"number": no, "name": name,
                                "file": Path(args.md).name, "topics": by_chapter[(no, name)]})

    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"chunks: {count} across {len(out['chapters'])} chapters -> {args.out}")
    for ch in out["chapters"]:
        print(f"  ch{ch['number']:02d} {ch['name']}: {len(ch['topics'])} topics")

if __name__ == "__main__":
    main()
