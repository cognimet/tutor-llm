"""Deterministic mock AI so the entire flow runs with no API key.

Mirrors the shape of real responses closely enough that the product loop —
chat, assessment, gap analysis, plan — works end to end offline.
"""
import re


def _topic_from(user: str) -> str:
    m = re.search(r'topic[:\s"]+([^"\n]+)', user, re.IGNORECASE)
    return (m.group(1).strip().strip('"') if m else "this topic")[:60]


def text(system: str, user: str) -> str:
    topic = _topic_from(user)
    return (
        f"Let's work through **{topic}** together.\n\n"
        f"Here's the core idea, step by step:\n\n"
        f"1. First, we set up what we know.\n"
        f"2. Then we apply the key relationship.\n"
        f"3. Finally we check the result makes sense.\n\n"
        f"A common mistake is rushing step 2 — take it slowly.\n\n"
        f"**Quick check:** can you tell me, in your own words, what the first step is doing?"
    )


def json(system: str, user: str, fallback: dict) -> dict:
    low = (system + user).lower()
    topic = _topic_from(user)

    # Match on each role's unique JSON shape marker (embedded in the user
    # prompt) rather than loose words — the role system prompts share words
    # like "assessment" and "gaps", so shape markers are the reliable signal.
    if '"items"' in low:  # study plan
        return {
            "title": "Your next steps",
            "items": [
                {"title": f"Review {topic} basics", "detail": "Re-read the explainer and one example.",
                 "concept": f"{topic} — definition"},
                {"title": "Practise 3 applied problems", "detail": "Focus on direction of the relationship.",
                 "concept": f"{topic} — application"},
                {"title": "Re-take the mini check", "detail": "Confirm the gap is closed.",
                 "concept": f"{topic} — application"},
            ],
        }

    if '"gaps"' in low:
        return {
            "gaps": [
                {
                    "concept": f"{topic} — application",
                    "severity": "high",
                    "misconception": "Applies the relationship in the wrong direction.",
                    "recommendation": f"Re-practise applying {topic} on two worked examples.",
                }
            ],
            "summary": "One application gap detected; foundation concepts look solid.",
        }

    if '"graded"' in low:
        return {"graded": []}

    if '"flashcards"' in low:
        return {
            "summary": f"Your notes on {topic} cover the main definition and one example.",
            "flashcards": [
                {"front": f"What is {topic}?", "back": "The core definition in one line."},
                {"front": f"Common mistake in {topic}?", "back": "Applying it in the wrong direction."},
            ],
        }

    if '"questions"' in low or "multiple-choice" in low:
        return {
            "questions": [
                {
                    "concept": f"{topic} — definition",
                    "type": "mcq",
                    "stem": f"Which statement best defines the core idea of {topic}?",
                    "options": ["The correct definition", "A close but wrong idea",
                                "An unrelated idea", "A common misconception"],
                    "answer_key": "The correct definition",
                    "difficulty": "easy",
                },
                {
                    "concept": f"{topic} — application",
                    "type": "mcq",
                    "stem": f"Apply {topic} to a simple example. What is the result?",
                    "options": ["Right answer", "Off-by-one error",
                                "Wrong formula", "Unit mistake"],
                    "answer_key": "Right answer",
                    "difficulty": "medium",
                },
                {
                    "concept": f"{topic} — reasoning",
                    "type": "mcq",
                    "stem": f"Why does {topic} behave this way?",
                    "options": ["Correct reasoning", "Reversed cause and effect",
                                "Irrelevant reason", "Partial reason"],
                    "answer_key": "Correct reasoning",
                    "difficulty": "hard",
                },
            ]
        }

    return fallback
