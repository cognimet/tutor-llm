"""Deterministic mock responses so the entire product flow runs with zero
external calls (no API key needed). Mirrors the real prompt contracts in
prompts.py — including the chat meta trailer and JSON shapes.
"""
import json
import re

from .prompts import META_MARKER


def _topic_from(user: str) -> str:
    m = re.search(r'[Tt]opic:?\s*"([^"]+)"', user)
    return m.group(1) if m else "this topic"


def _student_message(user: str) -> str:
    msgs = re.findall(r"Student: (.+)", user)
    return msgs[-1].strip() if msgs else ""


def respond(system: str, user: str, json_mode: bool) -> str:
    if json_mode or "Return ONLY JSON" in system:
        return _json_response(system, user)
    return _chat_response(system, user)


def _chat_response(system: str, user: str) -> str:
    topic = _topic_from(user)
    msg = _student_message(user)
    socratic = "MODE socratic" in system

    if socratic:
        body = (
            f"Interesting thought! Let's reason it out together.\n\n"
            f"1. What do you already know about **{topic}**?\n"
            f"2. If we change one quantity in the relationship, what do you "
            f"predict happens to the other?\n\nTell me your best guess — there "
            f"are no wrong answers here, only clues. 🦉"
        )
    else:
        body = (
            f"Great question! Let's break **{topic}** down step by step.\n\n"
            f"**Step 1 — The core idea.** Think of it like a water pipe: more "
            f"pressure pushes more water through. The same relationship holds here.\n\n"
            f"**Step 2 — The relationship.** We can write it as\n\n"
            f"$$y = k \\cdot x$$\n\n"
            f"where $k$ stays constant while $x$ and $y$ change together.\n\n"
            f"**Step 3 — A quick example.** If $k = 5$ and $x = 2$, then "
            f"$y = 10$. Double $x$ and $y$ doubles too — that's the heart of it.\n\n"
            f"⚠️ **Common mistake:** students often invert the relationship when "
            f"rearranging. Always move one symbol at a time.\n\n"
            f"Quick check: in our example, what would $y$ be if $x = 6$?"
        )

    meta = {
        "concept_tags": [f"{topic} basics"],
        "detected_misconception": (
            f"May be inverting the relationship in {topic}"
            if any(w in msg.lower() for w in ("divide", "opposite", "confus", "wrong"))
            else None
        ),
        "resolved_misconception": None,
        "mastery_signal": 0.3,
        "difficulty_delta": 0,
        "next_step": f"Try one practice question on {topic}, then take a mini-assessment.",
        "suggested_render": "text",
    }
    return body + "\n" + META_MARKER + json.dumps(meta)


def _json_response(system: str, user: str) -> str:
    topic = _topic_from(user)

    if "multiple-choice questions" in user:
        m = re.search(r"Create (\d+)", user)
        count = int(m.group(1)) if m else 3
        qs = []
        stems = [
            ("What does the constant in {t} represent?",
             ["The fixed ratio between the quantities", "A random number",
              "The largest value", "The unit of measurement"], 0,
             "Core definition of {t}"),
            ("If one quantity doubles in {t}, what happens to the related quantity?",
             ["It also doubles", "It halves", "It stays the same", "It becomes zero"], 0,
             "Proportional reasoning in {t}"),
            ("Which is a correct rearrangement of the {t} relationship?",
             ["k = y / x", "k = y + x", "k = y - x", "k = x / y"], 0,
             "Rearranging the {t} equation"),
            ("Which real-life situation best models {t}?",
             ["Cost rising steadily with quantity bought", "A coin toss",
              "Random weather changes", "A fixed monthly rent"], 0,
             "Applying {t} to real life"),
            ("A student gets the inverse answer in a {t} problem. What likely went wrong?",
             ["They swapped the variables when rearranging", "They added instead of subtracting",
              "They forgot the units", "Nothing — it's also correct"], 0,
             "Common misconception in {t}"),
            ("What stays constant in {t}?",
             ["The ratio of the two quantities", "Both quantities",
              "Neither quantity", "Only the larger quantity"], 0,
             "Identifying the invariant in {t}"),
        ]
        for i in range(min(count, len(stems))):
            q, opts, idx, concept = stems[i]
            qs.append({
                "question": q.format(t=topic),
                "options": opts,
                "correct_index": idx,
                "concept": concept.format(t=topic),
                "misconception": f"Confusing the direct and inverse forms of {topic}",
                "explanation": "This follows directly from the definition.",
                "difficulty": ["easy", "medium", "medium", "hard"][min(i, 3)],
            })
        return json.dumps({"questions": qs})

    if '"results"' in user and "Grade each" in user:
        n = user.count("- Q:")
        return json.dumps({"results": [
            {"is_correct": True, "partial_score": 1.0,
             "ai_feedback": "Clear and correct — well done!",
             "detected_misconception": None}
            for _ in range(max(n, 1))
        ]})

    if '"gaps"' in user:
        lines = re.findall(r"- Concept: ([^|]+)\|", user)
        gaps = [{
            "concept": c.strip(),
            "severity": "medium" if i % 2 == 0 else "high",
            "root_cause": f"Shaky grasp of the prerequisite behind {c.strip()}",
            "recommendation": f"Revisit {c.strip()} with one worked example, then re-test.",
        } for i, c in enumerate(lines)]
        return json.dumps({
            "gaps": gaps,
            "summary": ("You're close! A couple of concepts need another pass — "
                        "fix the root cause first and the rest will click."
                        if gaps else
                        "No gaps detected — you answered everything correctly. Strong work!"),
        })

    if '"items"' in user and "next-step" in user:
        return json.dumps({
            "title": f"Your next steps for {topic}",
            "rationale": "Prerequisites first, then practice, then prove it.",
            "items": [
                {"title": f"Re-read the core idea of {topic}",
                 "detail": "Focus on the definition and one worked example.",
                 "concept": f"{topic} basics", "estimated_minutes": 10},
                {"title": "Solve 3 practice questions",
                 "detail": "Start easy, end with one hard one.",
                 "concept": f"Applying {topic}", "estimated_minutes": 15},
                {"title": "Re-take the mini-assessment",
                 "detail": "Show the gap is closed.",
                 "concept": f"{topic} mastery", "estimated_minutes": 10},
            ],
        })

    if '"headline"' in user:
        return json.dumps({
            "headline": "On track overall — steady, consistent effort this period.",
            "summary": ("Your child studied regularly and completed their "
                        "assessments. Understanding is improving steadily, and "
                        "they responded well to feedback on weaker areas."),
            "wins": ["Completed all planned study sessions",
                     "Improved assessment accuracy"],
            "focus_areas": ["One concept needs another pass — the tutor has "
                            "already planned it"],
            "suggestion": "Ask them to explain today's topic to you in two "
                          "minutes — teaching it back is the best revision.",
        })

    return json.dumps({})
