"""Engine 2 (content half) — the LLM authors game content, never game code.

Ported from LearnQuest's `engines/game_generator.py` and generalised from its 16
hard-coded seed skills to an arbitrary curriculum.

The split that makes this safe:

  * The **mechanic** is a hand-built template that already exists in the client.
  * The **LLM** supplies only the semantic payload a teacher would supply — the
    word to spell, the term/definition pairs, the categories to sort into.
  * **This module** assembles the renderable structure (letter tiles, shuffled
    options, scrambled sentence tiles) from that payload, so the structural
    invariants the renderer depends on hold by construction.
  * **`validate_item`** then re-checks every item independently. Anything that
    fails is dropped here, and Laravel re-validates once more before persisting.

Deterministic math mechanics (number_line, build_number, compare, pizza) never
reach this module — Laravel authors those in PHP for free.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import string

from .llm import llm
from .schemas import Usage
from .config import settings

log = logging.getLogger(__name__)

# Every mechanic this module can author. The math mechanics used to be pure
# random PHP drills, disconnected from the topic; now the model picks
# topic-appropriate numbers (grounded in the curriculum) and Python assembles the
# exact renderable params + the validator re-solves. Laravel keeps the old
# deterministic authors only as an offline / failure fallback.
AUTHORED = (
    "word_builder", "word_match", "rhyme_pick", "sort_bucket", "sentence_builder",
    "number_line", "build_number", "compare", "pizza",
    "fill_blank", "sequence", "pattern",
)

# Roughly how demanding each difficulty should be, injected into the prompt.
_DIFFICULTY_HINT = {
    1: "very easy — the simplest possible examples a beginner meets first",
    2: "easy — straightforward, textbook examples",
    3: "medium — typical exam-level examples",
    4: "hard — examples that require combining two ideas",
    5: "very hard — the subtlest distinctions in this topic",
}

# What we ask the model for, per mechanic. We ask ONLY for meaning, never for
# tiles/options/shuffles, because those are what the validator checks structurally.
_CONTRACTS = {
    "word_builder": (
        'Spelling. JSON: {"items":[{"prompt":"Spell the word for ...","word":"lowercase target word",'
        '"emoji":"one emoji or empty string"}]} '
        "Each `word` must be a single lowercase a–z word (no spaces, no punctuation) that is a key "
        "term of the topic."
    ),
    "word_match": (
        'Matching. JSON: {"items":[{"prompt":"Match each term to its meaning.",'
        '"pairs":[{"left":"term","right":"short meaning"}]}]} '
        "Give exactly 4 pairs per item. Every `left` must be distinct and every `right` must be "
        "distinct, and no `right` may plausibly describe a different `left` — the match must be "
        "unambiguous. Keep each `right` under 6 words."
    ),
    "rhyme_pick": (
        'Rhyming. JSON: {"items":[{"prompt":"Pop the balloon that rhymes with \\"X\\"",'
        '"word":"X","answer":"a word that rhymes with X","distractors":["3 words that do NOT rhyme with X"]}]}'
    ),
    "sort_bucket": (
        'Classification. JSON: {"items":[{"prompt":"Sort each one...","bins":["2 or 3 category names"],'
        '"items":[{"text":"thing to sort","bin":"which category"}]}]} '
        "Give 6 things per item, spread across the bins. Every `bin` must be one of `bins`. "
        "Every `text` must be distinct and belong to exactly ONE category beyond argument."
    ),
    "sentence_builder": (
        'Sentence order. JSON: {"items":[{"solution":["one","word","per","entry"]}]} '
        "Each `solution` is a correct, meaningful sentence of 4–8 words about the topic, split into "
        "words. No word may repeat within a sentence."
    ),
    # --- Study-while-playing mechanics ---
    "fill_blank": (
        'Complete-the-statement. JSON: {"items":[{"sentence":"a real fact with ___ where a key '
        'term is removed","answer":"the exact term that fills the blank","distractors":["3 wrong '
        'but plausible terms"]}]} '
        "Each `sentence` must be a TRUE, exam-worthy statement from this topic with exactly one "
        "blank written as ___ (three underscores). The `answer` is the removed term. Distractors "
        "must be related to the topic but clearly wrong in this sentence."
    ),
    "sequence": (
        'Order-the-steps. JSON: {"items":[{"steps":["first step","second step","third step"]}]} '
        "Each `steps` is a real ordered process, method, or timeline from this topic (3–5 steps), "
        "written IN THE CORRECT ORDER. Each step is a short phrase (<= 8 words). No step repeats."
    ),
    "pattern": (
        'Number patterns — learn by extending. JSON: {"items":[{"terms":[4 or 5 numbers that '
        'start a real pattern],"answer":the next number,"distractors":[2-3 wrong "next" numbers]}]} '
        "Each `terms` starts a REAL number pattern this topic teaches, following ONE simple rule: "
        "a constant add/subtract step (2,4,6,8), a constant multiply (3,6,12,24), or a constant "
        "second difference (1,3,6,10 or 1,4,9,16). Give at least 4 terms so the rule is visible. "
        "`answer` is the next number; distractors are plausible but wrong. Use whole numbers where "
        "the grade allows."
    ),
    # --- Math mechanics: the model supplies topic-appropriate NUMBERS only; the
    #     service computes answers and builds the renderable params. Numbers must
    #     illustrate THIS topic (e.g. the divisor/dividend of the lemma being
    #     taught), not arbitrary arithmetic. ---
    "number_line": (
        'Arithmetic on a number line. JSON: {"items":[{"a":int,"b":int,"op":"+|-|x|/"}]} '
        "Choose `op` and operands that match how THIS topic is computed, with grade-appropriate "
        "sizes. For \"-\" ensure a>=b; for \"/\" ensure a is exactly divisible by b (a % b == 0). "
        "Keep the answer under ~120 so it fits a number line."
    ),
    "build_number": (
        'Place value. JSON: {"items":[{"target":int}]} '
        "Each `target` is a 3-digit number (100–999) that is a meaningful example for this topic."
    ),
    "compare": (
        'Comparing numbers. JSON: {"items":[{"a":int,"b":int}]} '
        "Two numbers to compare (>, <, or =), sized for this topic/grade."
    ),
    "pizza": (
        'Fractions. JSON: {"items":[{"parts":int}]} '
        "`parts` (2–8) is the number of equal parts of a whole for the fraction 1/parts, chosen to "
        "match the fractions this topic teaches."
    ),
}


def _system(mechanic: str, context: str = "") -> str:
    base = (
        "You are a K–12 curriculum specialist authoring content for a learning game. "
        "You are filling the content slots of an existing game template — you never write code. "
        "Everything you return must be factually correct, age-appropriate, unambiguous, and drawn "
        "from the specific topic being taught (not generic filler). Return ONLY JSON."
    )
    # Ground the content in the actual course material when we have it.
    return base + context


def _user(mechanic: str, topic: str, chapter: str | None, subject: str | None,
          difficulty: int, count: int) -> str:
    scope = " · ".join(x for x in (subject, chapter, topic) if x)
    return (
        f"Course location: {scope}\n"
        f"Difficulty: {difficulty}/5 ({_DIFFICULTY_HINT.get(difficulty, 'medium')}).\n"
        f"Author {count} items for the '{mechanic}' mechanic, based on what THIS topic actually "
        "teaches — use its real terms, examples and the way it is worked, not unrelated content.\n\n"
        f"{_CONTRACTS[mechanic]}\n\n"
        'Every item must ALSO include "explain": one kid-friendly sentence (max 18 words) that '
        "teaches WHY the correct answer is correct — a mini-lesson, not a restatement.\n\n"
        'Return ONE JSON object whose only key is "items", holding the array — '
        'i.e. {"items": [ ... ]}. Do NOT return a bare array, and no prose or code fences.'
    )


def _extract_items(data) -> list[dict]:
    """Pull the item array out of whatever shape the model returned.

    Gemini honours `response_mime_type=application/json` but not reliably the
    *shape*: the same prompt returns `{"items": [...]}` on one call and a bare
    top-level `[...]` on the next. Reading only `data["items"]` silently threw
    away every item and surfaced as "we couldn't build a game for this topic".
    """
    if isinstance(data, list):
        log.info("game author: model returned a bare array; normalising")
        return [x for x in data if isinstance(x, dict)]

    if isinstance(data, dict):
        items = data.get("items")
        if isinstance(items, list):
            return [x for x in items if isinstance(x, dict)]
        # Wrapped under some other key ("questions", "games", the mechanic name…).
        for key, value in data.items():
            if isinstance(value, list) and any(isinstance(x, dict) for x in value):
                log.info("game author: found items under %r; normalising", key)
                return [x for x in value if isinstance(x, dict)]
        # A single item returned unwrapped.
        if "pairs" in data or "word" in data or "solution" in data or "bins" in data:
            return [data]

    return []


# --------------------------------------------------------------------------- #
# Structure assembly: turn the model's semantic payload into a renderable item.
# --------------------------------------------------------------------------- #
def _explain(raw: dict, fallback: str) -> str:
    """The post-answer mini-lesson: prefer the model's, else a computed one, so
    every item can teach WHY — never just "correct"/"wrong". Shown only after
    grading (forPlay strips it), so it may name the answer freely."""
    text = str(raw.get("explain", "") or "").strip()
    return (text or fallback)[:220]


def _build_word_builder(raw: dict, rng: random.Random) -> dict | None:
    word = str(raw.get("word", "")).strip().lower()
    if not word or not word.isalpha():
        return None
    # Two decoy letters so the puzzle isn't a pure ordering exercise.
    letters = list(word) + [rng.choice(string.ascii_lowercase) for _ in range(2)]
    rng.shuffle(letters)
    emoji = str(raw.get("emoji", "") or "")
    return {
        "prompt": str(raw.get("prompt") or f"Spell the word for {emoji}".strip()),
        "answer": word,
        "distractors": [],
        "hint": "Tap the letters in order.",
        "explain": _explain(raw, f'"{word}" — that\'s the key word here. Say it out loud as you spell it!'),
        "params": {"kind": "word_builder", "word": word, "emoji": emoji, "letters": letters},
    }


def _build_word_match(raw: dict, rng: random.Random) -> dict | None:
    pairs = [
        {"left": str(p.get("left", "")).strip(), "right": str(p.get("right", "")).strip()}
        for p in (raw.get("pairs") or []) if isinstance(p, dict)
    ]
    pairs = [p for p in pairs if p["left"] and p["right"]]
    if len(pairs) < 2:
        return None
    # De-duplicate both sides; an ambiguous match is worse than a shorter game.
    seen_l, seen_r, clean = set(), set(), []
    for p in pairs:
        if p["left"] in seen_l or p["right"] in seen_r:
            continue
        seen_l.add(p["left"]); seen_r.add(p["right"]); clean.append(p)
    if len(clean) < 2:
        return None
    return {
        "prompt": str(raw.get("prompt") or "Match each term to its meaning."),
        "answer": json.dumps({p["left"]: p["right"] for p in clean}),
        "distractors": [],
        "hint": "Tap one, then its match.",
        "explain": _explain(raw, "The pairs: " + "; ".join(f"{p['left']} → {p['right']}" for p in clean)),
        "params": {"kind": "word_match", "pairs": clean},
    }


def _build_rhyme_pick(raw: dict, rng: random.Random) -> dict | None:
    answer = str(raw.get("answer", "")).strip()
    word = str(raw.get("word", "")).strip()
    distractors = [str(d).strip() for d in (raw.get("distractors") or []) if str(d).strip()]
    distractors = [d for d in dict.fromkeys(distractors) if d != answer]
    if not answer or not word or len(distractors) < 2:
        return None
    options = [answer] + distractors[:3]
    rng.shuffle(options)
    return {
        "prompt": str(raw.get("prompt") or f'Pop the balloon that rhymes with "{word}"'),
        "answer": answer,
        "distractors": distractors[:3],
        "hint": "Rhyming words end with the same sound.",
        "explain": _explain(raw, f'"{answer}" and "{word}" end with the same sound — that makes a rhyme!'),
        "params": {"kind": "rhyme_pick", "word": word, "options": options, "answer": answer},
    }


def _build_sort_bucket(raw: dict, rng: random.Random) -> dict | None:
    bins = [str(b).strip() for b in (raw.get("bins") or []) if str(b).strip()]
    bins = list(dict.fromkeys(bins))
    elems = [
        {"text": str(e.get("text", "")).strip(), "bin": str(e.get("bin", "")).strip()}
        for e in (raw.get("items") or []) if isinstance(e, dict)
    ]
    elems = [e for e in elems if e["text"] and e["bin"] in bins]
    # Drop repeats: the same token in two bins would be unsolvable.
    seen, clean = set(), []
    for e in elems:
        if e["text"] in seen:
            continue
        seen.add(e["text"]); clean.append(e)
    if len(bins) < 2 or len(clean) < 2:
        return None
    rng.shuffle(clean)
    return {
        "prompt": str(raw.get("prompt") or f"Sort each one: {' or '.join(bins)}?"),
        "answer": json.dumps({e["text"]: e["bin"] for e in clean}),
        "distractors": [],
        "hint": "Drag each one into the right box.",
        "explain": _explain(raw, "Where they belong: " + "; ".join(f"{e['text']} → {e['bin']}" for e in clean)),
        "params": {"kind": "sort_bucket", "bins": bins, "items": clean},
    }


def _build_sentence_builder(raw: dict, rng: random.Random) -> dict | None:
    solution = [str(w).strip() for w in (raw.get("solution") or []) if str(w).strip()]
    if len(solution) < 2 or len(set(solution)) != len(solution):
        return None  # a repeated word makes the tiles ambiguous
    tiles = solution[:]
    for _ in range(8):  # never hand back the answer already in order
        rng.shuffle(tiles)
        if tiles != solution:
            break
    else:
        return None
    return {
        "prompt": "Put the words in order to make a sentence.",
        "answer": " ".join(solution),
        "distractors": [],
        "hint": "Sentences start with a capital letter.",
        "explain": _explain(raw, 'The sentence reads: "' + " ".join(solution) + '."'),
        "params": {"kind": "sentence_builder", "solution": solution, "tiles": tiles},
    }


# --------------------------------------------------------------------------- #
# Math builders: the model supplies topic-appropriate NUMBERS; we compute the
# answer, build the exact render params, and let validate_item() re-solve. Any
# item whose numbers don't hold up (e.g. a non-divisible division) is dropped.
# --------------------------------------------------------------------------- #
def _num_distractors(correct: int, span: int, rng: random.Random) -> list[str]:
    out: set[int] = set()
    delta = max(2, span // 5)
    guard = 0
    while len(out) < 3 and guard < 50:
        guard += 1
        cand = correct + rng.randint(-delta, delta)
        if cand != correct and cand >= 0:
            out.add(cand)
    return [str(x) for x in out]


def _build_number_line(raw: dict, rng: random.Random) -> dict | None:
    try:
        a, b = int(raw["a"]), int(raw["b"])
    except (KeyError, TypeError, ValueError):
        return None
    op = str(raw.get("op", "+")).strip().lower()
    op = {"×": "x", "*": "x", "÷": "/", "add": "+", "subtract": "-", "multiply": "x", "divide": "/"}.get(op, op)
    if op not in ("+", "-", "x", "/"):
        return None
    if op == "-" and a < b:
        a, b = b, a
    if op == "/":
        if b == 0 or a % b != 0:
            return None
        result = a // b
    else:
        result = {"+": a + b, "-": a - b, "x": a * b}[op]
    if result < 0 or result > 999:
        return None
    hi = max(20, int(result * 1.25) + 5)
    return {
        "prompt": f"{a} {op} {b} = ?",
        "answer": str(result),
        "distractors": _num_distractors(result, max(result, 10), rng),
        "hint": "Hop the marker to the answer, then lock it in.",
        "params": {"kind": "number_line", "op": op, "a": a, "b": b, "answer": result, "min": 0, "max": hi},
    }


def _build_build_number(raw: dict, rng: random.Random) -> dict | None:
    try:
        num = int(raw["target"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (100 <= num <= 999):
        return None
    return {
        "prompt": f"Build the number {num}",
        "answer": str(num),
        "distractors": [],
        "hint": "Drag hundreds, tens and ones until the total matches.",
        "explain": _explain(raw, f"{num} = {(num // 100) % 10} hundreds + {(num // 10) % 10} tens + {num % 10} ones."),
        "params": {"kind": "build_number", "target": num,
                   "hundreds": (num // 100) % 10, "tens": (num // 10) % 10, "ones": num % 10},
    }


def _build_compare(raw: dict, rng: random.Random) -> dict | None:
    try:
        a, b = int(raw["a"]), int(raw["b"])
    except (KeyError, TypeError, ValueError):
        return None
    ans = ">" if a > b else "<" if a < b else "="
    return {
        "prompt": f"Compare: {a} __ {b}",
        "answer": ans,
        "distractors": [x for x in (">", "<", "=") if x != ans],
        "hint": "The alligator always eats the bigger number.",
        "explain": _explain(raw, f"{a} is equal to {b} — same size!" if a == b else f"{max(a,b)} is bigger than {min(a,b)}, so the alligator eats {max(a,b)}."),
        "params": {"kind": "compare", "a": a, "b": b},
    }


def _build_pizza(raw: dict, rng: random.Random) -> dict | None:
    try:
        parts = int(raw["parts"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (2 <= parts <= 8):
        return None
    return {
        "prompt": f"A pizza is cut into {parts} equal parts. Click ONE slice to show 1/{parts}.",
        "answer": f"1/{parts}",
        "distractors": [],
        "hint": "One part out of the total equal parts.",
        "explain": _explain(raw, f"1/{parts} means 1 slice out of {parts} equal slices — the bottom number counts ALL the parts."),
        "params": {"kind": "pizza", "parts": parts, "shade": 1},
    }


# --------------------------------------------------------------------------- #
# Number patterns: teach-by-doing. The child sees the jumps and extends the
# rule. We re-solve the pattern (arithmetic / geometric / figurate) so the game
# is never wrong, mirroring GameValidator::solvePattern in PHP.
# --------------------------------------------------------------------------- #
def _all_close(xs: list[float]) -> bool:
    return bool(xs) and all(abs(x - xs[0]) < 1e-6 for x in xs)


def _solve_pattern(t: list[float]) -> float | None:
    n = len(t)
    if n < 3:
        return None
    d1 = [t[i] - t[i - 1] for i in range(1, n)]
    if _all_close(d1):
        return t[-1] + d1[0]
    if all(abs(t[i - 1]) > 1e-9 for i in range(1, n)):
        ratios = [t[i] / t[i - 1] for i in range(1, n)]
        if _all_close(ratios):
            return t[-1] * ratios[0]
    if len(d1) >= 2:
        d2 = [d1[i] - d1[i - 1] for i in range(1, len(d1))]
        if _all_close(d2):
            return t[-1] + (d1[-1] + d2[0])
    return None


def _pfmt(x: float):
    return int(round(x)) if abs(x - round(x)) < 1e-9 else round(x, 2)


def _build_pattern(raw: dict, rng: random.Random) -> dict | None:
    try:
        terms = [float(x) for x in (raw.get("terms") or [])][:6]
    except (TypeError, ValueError):
        return None
    if len(terms) < 3:
        return None
    nxt = _solve_pattern(terms)
    if nxt is None:
        return None  # not a simple rule — drop rather than mislead

    # The solver is authoritative; trust it over a mis-keyed model answer.
    answer = nxt
    distractors: list[float] = []
    for d in (raw.get("distractors") or []):
        try:
            dv = float(d)
        except (TypeError, ValueError):
            continue
        if abs(dv - answer) > 1e-6 and all(abs(dv - x) > 1e-6 for x in distractors):
            distractors.append(dv)

    # Synthesise near-miss distractors if the model gave too few.
    base_step = abs(terms[-1] - terms[-2]) or 1
    guard = 0
    while len(distractors) < 2 and guard < 24:
        guard += 1
        cand = answer + rng.choice([-2, -1, 1, 2, 3]) * base_step
        if abs(cand - answer) > 1e-6 and all(abs(cand - x) > 1e-6 for x in distractors):
            distractors.append(cand)
    if len(distractors) < 2:
        return None

    options = [_pfmt(answer)] + [_pfmt(d) for d in distractors[:3]]
    seen, uniq = set(), []
    for o in options:
        if o not in seen:
            seen.add(o)
            uniq.append(o)
    if len(uniq) < 3:
        return None
    rng.shuffle(uniq)

    return {
        "prompt": "What number comes next in the pattern?",
        "answer": str(_pfmt(answer)),
        "distractors": [str(_pfmt(d)) for d in distractors[:3]],
        "hint": "Look at how much it jumps each time.",
        "explain": _explain(raw, "Each step follows the same rule — find the jump and keep it going."),
        "params": {"kind": "pattern", "terms": [_pfmt(x) for x in terms], "options": uniq},
    }


def _build_fill_blank(raw: dict, rng: random.Random) -> dict | None:
    sentence = str(raw.get("sentence", "")).strip()
    answer = str(raw.get("answer", "")).strip()
    distractors = [str(d).strip() for d in (raw.get("distractors") or []) if str(d).strip()]
    if not sentence or not answer:
        return None
    # Normalise the blank: accept a few placeholder styles, else blank the answer.
    for ph in ("_____", "____", "___", "__", "_", "[blank]", "[BLANK]", "……", "…"):
        if ph in sentence:
            sentence = sentence.replace(ph, "_____")
            break
    else:
        # No placeholder — carve one out of the first occurrence of the answer.
        idx = sentence.lower().find(answer.lower())
        if idx == -1:
            return None
        sentence = sentence[:idx] + "_____" + sentence[idx + len(answer):]
    if "_____" not in sentence:
        return None
    distractors = [d for d in dict.fromkeys(distractors) if d.lower() != answer.lower()][:3]
    if len(distractors) < 2:
        return None
    options = [answer] + distractors
    rng.shuffle(options)
    return {
        "prompt": "Tap the term that completes the statement.",
        "answer": answer,
        "distractors": distractors,
        "hint": "Read the whole sentence first.",
        "explain": _explain(raw, f'The missing term is "{answer}" — reread the sentence with it in place.'),
        "params": {"kind": "fill_blank", "sentence": sentence, "options": options},
    }


def _build_sequence(raw: dict, rng: random.Random) -> dict | None:
    steps = [str(s).strip() for s in (raw.get("steps") or []) if str(s).strip()]
    steps = list(dict.fromkeys(steps))  # drop exact dupes, keep order
    if len(steps) < 3:
        return None
    steps = steps[:5]
    shuffled = steps[:]
    for _ in range(8):  # never present them already in order
        rng.shuffle(shuffled)
        if shuffled != steps:
            break
    else:
        return None
    return {
        "prompt": "Put the steps in the correct order.",
        "answer": " | ".join(steps),
        "distractors": [],
        "hint": "Think about what has to happen first.",
        "explain": _explain(raw, "The correct order: " + " → ".join(steps)),
        "params": {"kind": "sequence", "steps": steps, "shuffled": shuffled},
    }


_BUILDERS = {
    "word_builder": _build_word_builder,
    "word_match": _build_word_match,
    "rhyme_pick": _build_rhyme_pick,
    "sort_bucket": _build_sort_bucket,
    "sentence_builder": _build_sentence_builder,
    "number_line": _build_number_line,
    "build_number": _build_build_number,
    "compare": _build_compare,
    "pizza": _build_pizza,
    "fill_blank": _build_fill_blank,
    "sequence": _build_sequence,
    "pattern": _build_pattern,
}


# --------------------------------------------------------------------------- #
# The validator (mirrors backend/app/Services/Quest/GameValidator.php).
# --------------------------------------------------------------------------- #
def validate_item(item: dict) -> list[str]:
    """Independently re-check one item. Empty list == safe to serve."""
    errs: list[str] = []
    params = item.get("params") or {}
    kind = params.get("kind")
    answer = item.get("answer", "")

    if not str(item.get("prompt", "")).strip():
        errs.append("empty prompt")
    if answer in (item.get("distractors") or []):
        errs.append("answer duplicated in distractors")

    if kind == "word_builder":
        word = params.get("word", "")
        letters = list(params.get("letters", []))
        if answer != word:
            errs.append("answer != target word")
        for ch in word:
            if ch in letters:
                letters.remove(ch)
            else:
                errs.append(f"letter '{ch}' missing from tiles")
                break
    elif kind == "word_match":
        pairs = params.get("pairs", [])
        if len(pairs) < 2:
            errs.append("word_match needs >= 2 pairs")
        rights = [p.get("right") for p in pairs]
        lefts = [p.get("left") for p in pairs]
        if len(set(rights)) != len(rights) or len(set(lefts)) != len(lefts):
            errs.append("ambiguous match")
    elif kind == "rhyme_pick":
        if answer not in params.get("options", []):
            errs.append("answer not among options")
    elif kind == "sort_bucket":
        bins = set(params.get("bins", []))
        elems = params.get("items", [])
        if len(bins) < 2:
            errs.append("sort needs >= 2 bins")
        if len(elems) < 2:
            errs.append("sort needs >= 2 items")
        for e in elems:
            if e.get("bin") not in bins:
                errs.append(f"bin '{e.get('bin')}' not in bins")
                break
    elif kind == "sentence_builder":
        sol = params.get("solution", [])
        tiles = params.get("tiles", [])
        if sorted(sol) != sorted(tiles):
            errs.append("tiles not a permutation of solution")
        if " ".join(sol) != answer:
            errs.append("answer != joined solution")
    elif kind == "number_line":
        a, b, op = params.get("a"), params.get("b"), params.get("op")
        try:
            expected = {"+": a + b, "-": a - b, "x": a * b,
                        "/": (a // b if b else None)}.get(op)
        except TypeError:
            expected = None
        if expected is None or str(expected) != answer:
            errs.append("number_line solver mismatch")
        elif not (isinstance(params.get("min"), int) and isinstance(params.get("max"), int)
                  and params["min"] < params["max"] and params["min"] <= expected <= params["max"]):
            errs.append("answer outside the number line range")
    elif kind == "build_number":
        if str(params.get("target")) != answer:
            errs.append("build_number target != answer")
        elif not (isinstance(params.get("target"), int) and 0 <= params["target"] <= 999):
            errs.append("build_number out of range")
    elif kind == "compare":
        a, b = params.get("a"), params.get("b")
        expected = ">" if a > b else "<" if a < b else "=" if a == b else None
        if expected != answer:
            errs.append("compare solver mismatch")
    elif kind == "pizza":
        parts, shade = params.get("parts"), params.get("shade")
        if not (isinstance(parts, int) and parts >= 2):
            errs.append("pizza needs >= 2 parts")
        elif not (isinstance(shade, int) and 1 <= shade <= parts):
            errs.append("pizza shade out of range")
    elif kind == "fill_blank":
        sentence = params.get("sentence", "")
        options = params.get("options", [])
        if "_____" not in sentence:
            errs.append("fill_blank sentence has no blank")
        if len(sentence.strip()) < 12:
            errs.append("fill_blank sentence too short")
        if len(options) < 3:
            errs.append("fill_blank needs >= 3 options")
        if answer not in options:
            errs.append("fill_blank answer not among options")
        if len(set(options)) != len(options):
            errs.append("fill_blank duplicate options")
    elif kind == "sequence":
        steps = params.get("steps", [])
        shuffled = params.get("shuffled", [])
        if len(steps) < 3:
            errs.append("sequence needs >= 3 steps")
        if len(set(steps)) != len(steps):
            errs.append("sequence duplicate steps")
        if sorted(steps) != sorted(shuffled):
            errs.append("shuffled not a permutation of steps")
        if " | ".join(steps) != answer:
            errs.append("answer != ordered steps")
    elif kind == "pattern":
        terms = params.get("terms", [])
        options = params.get("options", [])
        if len(terms) < 3:
            errs.append("pattern needs >= 3 terms")
        try:
            nxt = _solve_pattern([float(x) for x in terms])
        except (TypeError, ValueError):
            nxt = None
        if nxt is None:
            errs.append("pattern not re-solvable")
        else:
            try:
                if abs(nxt - float(answer)) > 1e-6:
                    errs.append("pattern solver mismatch")
            except (TypeError, ValueError):
                errs.append("pattern answer not numeric")
        opt_strs = [str(o) for o in options]
        if len(options) < 3:
            errs.append("pattern needs >= 3 options")
        if str(answer) not in opt_strs:
            errs.append("pattern answer not among options")
        if len(set(opt_strs)) != len(opt_strs):
            errs.append("pattern duplicate options")
    else:
        errs.append(f"unknown mechanic '{kind}'")

    return errs


# --------------------------------------------------------------------------- #
# Mock authoring — keeps AI_MOCK=true development fully playable.
# --------------------------------------------------------------------------- #
def _mock_raw(mechanic: str, topic: str, count: int) -> list[dict]:
    word = "".join(c for c in topic.lower() if c.isalpha())[:6] or "study"
    if mechanic == "word_builder":
        return [{"prompt": f"Spell a key word from {topic}", "word": word, "emoji": "📘"}] * count
    if mechanic == "word_match":
        return [{"prompt": "Match each term to its meaning.", "pairs": [
            {"left": f"{topic} term {i}", "right": f"meaning {i}"} for i in range(1, 5)]}] * count
    if mechanic == "rhyme_pick":
        return [{"word": "cat", "answer": "hat", "distractors": ["dog", "sun", "pen"]}] * count
    if mechanic == "sort_bucket":
        return [{"prompt": f"Sort each {topic} example.", "bins": ["Group A", "Group B"], "items": [
            {"text": f"example {i}", "bin": "Group A" if i % 2 else "Group B"} for i in range(1, 7)]}] * count
    if mechanic == "number_line":
        return [{"a": 6 + i, "b": 3, "op": "+"} for i in range(count)]
    if mechanic == "build_number":
        return [{"target": 100 + i * 37} for i in range(count)]
    if mechanic == "compare":
        return [{"a": 10 + i, "b": 20 - i} for i in range(count)]
    if mechanic == "pizza":
        return [{"parts": 2 + (i % 7)} for i in range(count)]
    if mechanic == "fill_blank":
        return [{"sentence": f"A key idea in {topic} is the concept of ___.",
                 "answer": word, "distractors": ["alpha", "beta", "gamma"]} for _ in range(count)]
    if mechanic == "sequence":
        return [{"steps": [f"{topic} step one", f"{topic} step two", f"{topic} step three"]} for _ in range(count)]
    if mechanic == "pattern":
        return [{"terms": [2 + 2 * i, 4 + 2 * i, 6 + 2 * i, 8 + 2 * i],
                 "answer": 10 + 2 * i, "distractors": [9 + 2 * i, 11 + 2 * i, 12 + 2 * i]} for i in range(count)]
    return [{"solution": ["This", "is", "about", topic.split()[0] if topic else "learning"]}] * count


# --------------------------------------------------------------------------- #
# Public entry point.
# --------------------------------------------------------------------------- #
def _assemble(mechanic: str, raw_items: list[dict], count: int, rng: random.Random) -> list[dict]:
    build = _BUILDERS[mechanic]
    out: list[dict] = []
    for raw in raw_items[: count * 2]:  # tolerate over-generation
        item = build(raw, rng)
        if item and not validate_item(item):
            out.append(item)
        if len(out) >= count:
            break
    return out


async def author(mechanic: str, topic: str, chapter: str | None, subject: str | None,
                 difficulty: int, count: int, context: str = "") -> tuple[list[dict], Usage]:
    """Author `count` validated items for `mechanic`, grounded in `context` (the
    topic's retrieved curriculum). Invalid items are dropped, so the caller may
    receive fewer than requested (possibly zero)."""
    if mechanic not in AUTHORED:
        return [], Usage(model="none", mock=settings.is_mock)

    rng = random.Random()

    if settings.is_mock:
        return _assemble(mechanic, _mock_raw(mechanic, topic, count), count, rng), Usage(model="mock", mock=True)

    system = _system(mechanic, context)
    user = _user(mechanic, topic, chapter, subject, difficulty, count)

    # One retry: the model intermittently returns content that fails validation
    # outright. A single miss shouldn't cost the student a game. (Transport-level
    # failures — 429s, 5xx — are already retried inside the provider.)
    usage = Usage(model=settings.model_for("structured"))
    for attempt in (1, 2):
        data, usage = await llm.json(system, user, {"items": []}, action="structured")
        out = _assemble(mechanic, _extract_items(data), count, rng)
        if out:
            return out, usage
        log.warning("game author: no valid items for %r (%s), attempt %d", topic, mechanic, attempt)
        if attempt == 1:
            await asyncio.sleep(1.5)  # don't hammer a model that just gave us nothing

    return [], usage
