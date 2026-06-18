"""Prompt construction for each AI role.

In production these move to the DB (`prompt_templates`, admin-editable). Kept
here for the MVP so the service is self-contained. Each builder returns
(system, user).
"""
from .schemas import StudentContext, ChatTurnRequest


def _persona(s: StudentContext) -> str:
    bits = ["You are an expert, patient tutor for Indian school students."]
    if s.level:
        bits.append(f"The student is in {s.level}.")
    if s.learning_style:
        bits.append(f"They learn best in a {s.learning_style} style — lean into that.")
    if s.language and s.language.lower() != "english":
        bits.append(f"Reply primarily in {s.language} but keep technical terms in English.")
    if s.memory.get("weak_topics"):
        bits.append(f"Known weak areas: {', '.join(s.memory['weak_topics'][:5])}.")
    return " ".join(bits)


_MODE_RULES = {
    "teach": "Explain step by step; never just give the final answer. Use one concrete "
             "Indian-context example. Point out the common mistake. End with one short "
             "comprehension question.",
    "socratic": "Do NOT give the answer. Guide only with one focused question at a time "
                "until the student reaches it themselves.",
    "quiz": "Drill the student: ask one question, wait, give brief feedback, then the next.",
    "exam": "Act as an exam coach: board-pattern phrasing, time-aware tips, mark-scheme cues.",
    "eli10": "Explain as if to a curious 10-year-old: simple words, a vivid analogy, short sentences.",
}


def chat_turn(req: ChatTurnRequest, context: str) -> tuple[str, str]:
    rules = _MODE_RULES.get(req.mode, _MODE_RULES["teach"])
    relearn = ""
    if req.attempt_no > 1:
        relearn = ("This is a re-teach attempt. Name what the student got wrong before and "
                   "explain it a DIFFERENT way (new analogy or representation) — never repeat "
                   "the earlier wording. ")
    system = (
        f"{_persona(req.student)}\n"
        f"You are tutoring strictly within: \"{req.topic}\" "
        f"(Chapter: {req.chapter}, Subject: {req.subject}). If the student drifts, steer back.\n"
        f"{relearn}{rules}\n"
        "Formatting: clear Markdown — short paragraphs, **bold** key terms, lists for steps, "
        "`inline code` for variables, LaTeX maths inline as $...$ and display as $$...$$. "
        "Be concise and encouraging."
        f"{context}"
    )
    convo = ""
    for m in req.history:
        who = "Student" if m.role == "user" else "Tutor"
        convo += f"{who}: {m.content}\n"
    user = f'Topic: "{req.topic}"\n\nConversation so far:\n{convo}\nStudent: {req.message}\n\nTutor:'
    return system, user


def chat_metadata(req: ChatTurnRequest, reply: str) -> tuple[str, str]:
    """Second, cheap call: extract structured signals from the exchange."""
    system = (
        "You analyse a tutoring exchange and return ONLY JSON with keys: "
        "concept_tags (array of strings), detected_misconception (string or null), "
        "difficulty_delta (-1, 0, or 1), suggested_render (one of text|canvas|quiz|flashcard|mindmap), "
        "next_step (short string or null)."
    )
    user = (
        f'Topic: "{req.topic}". Student said: "{req.message}". '
        f'Tutor replied: "{reply[:800]}". Return the JSON.'
    )
    return system, user


def assessment_generate(s: StudentContext, topic: str, count: int) -> tuple[str, str]:
    system = (
        f"{_persona(s)}\nYou create a short diagnostic assessment that reveals what the "
        "student truly understands. Return ONLY JSON."
    )
    user = (
        f'Create {count} multiple-choice questions for the topic "{topic}". Each must probe a '
        "distinct sub-concept and include one plausible misconception distractor. JSON shape: "
        '{"questions":[{"concept","type":"mcq","stem","options":[4 strings],"answer_key","difficulty"}]}'
    )
    return system, user


def assessment_grade(topic: str, items: list) -> tuple[str, str]:
    system = (
        "You grade student answers for short/open questions and name the precise "
        "misconception behind any error. Return ONLY JSON."
    )
    lines = []
    for it in items:
        lines.append(
            f'- concept="{it.concept}" Q="{it.stem}" correct="{it.correct_answer}" '
            f'student="{it.student_answer}"'
        )
    user = (
        f'Topic "{topic}". Grade each item below. JSON shape: '
        '{"graded":[{"concept","is_correct":bool,"partial_score":0..1,"feedback",'
        '"detected_misconception":string|null}]}\n' + "\n".join(lines)
    )
    return system, user


def gap_analyze(topic: str, results: list) -> tuple[str, str]:
    system = (
        "You are a diagnostic tutor. From assessment results, identify the specific "
        "concept gaps, their severity, the root misconception, and a recommendation. "
        "Return ONLY JSON."
    )
    user = (
        f'Topic "{topic}". Results: {results}. JSON shape: '
        '{"gaps":[{"concept","severity":"low|medium|high","misconception","recommendation"}],'
        '"summary"}'
    )
    return system, user


def plan_build(topic: str, gaps: list) -> tuple[str, str]:
    system = ("You turn concept gaps into a short, motivating study plan of 3–4 concrete "
              "next steps. Return ONLY JSON.")
    user = (
        f'Topic "{topic}". Gaps: {gaps}. JSON shape: '
        '{"title","items":[{"title","detail","concept"}]}'
    )
    return system, user


def study_schedule(topic: str, horizon: str, days_remaining, exam_date,
                   notes_summary: str, gaps: list, mastery: int,
                   from_notes: bool = False) -> tuple[str, str]:
    spans = {"day": "today (a single focused day)", "week": "the next 7 days",
             "month": "the next 4 weeks", "exam": "the run-up to the exam"}
    span = spans.get(horizon, "the next 7 days")
    horizon_rule = {
        "day":   "Plan ONE day only: 3–5 short tasks the student can finish today.",
        "week":  "Plan 7 days. Use day_index 0..6. ~1–3 tasks per day; lighter near the end.",
        "month": "Plan 4 weeks. Use day_index 0..27, but you may schedule on ~12–16 key days.",
        "exam":  "Work backwards from the exam: learn weak concepts first, then practice, then "
                 "revision + a final mock. Front-load the hardest gaps. End the last day with a "
                 "light revise/assess task, not new material.",
    }.get(horizon, "Plan 7 days using day_index 0..6.")
    exam_ctx = ""
    if days_remaining is not None:
        exam_ctx = f"There are {days_remaining} day(s) until the exam. Fit the plan within them. "

    if from_notes and notes_summary.strip():
        # NOTES-DRIVEN: the plan must mirror what's actually in the student's notes.
        system = (
            "You are an expert study coach for Indian school students. Build a concrete, dated study "
            "plan STRICTLY from the student's OWN uploaded notes given below. EVERY task must cover a "
            "topic, heading or section that ACTUALLY APPEARS in their notes — walk through the notes in "
            "order. Do NOT invent topics that are not in the notes, and do NOT pad with generic "
            "syllabus items. Use the notes' own wording for concept names. Return ONLY JSON."
        )
        user = (
            f'Subject: "{topic}". Horizon: {horizon} ({span}). {exam_ctx}'
            f'Current mastery: {mastery}/100. Open gaps: {gaps}.\n'
            f'=== THE STUDENT\'S OWN NOTES (build the plan from THESE) ===\n{notes_summary[:6000]}\n=== END NOTES ===\n'
            f'{horizon_rule} Break the notes into a sequence of tasks; each names the concept (from the '
            'notes) it builds. Mix kinds: "learn" (understand a section), "practice" (solve problems on '
            'it), "revise" (recap), "assess" (a quick quiz on it). Cover the weak concepts first.\n'
            'JSON shape: {"title","summary","tasks":[{"day_index":int,"title","detail",'
            '"concept","kind":"learn|practice|revise|assess","estimated_minutes":int}]}'
        )
        return system, user

    system = (
        "You are an expert study coach for Indian school students. You turn a topic, the "
        "student's own notes, their concept gaps and mastery into a concrete, dated study "
        "schedule that builds mastery without burning them out. Return ONLY JSON."
    )
    user = (
        f'Topic: "{topic}". Horizon: {horizon} ({span}). {exam_ctx}'
        f'Current mastery: {mastery}/100. Open gaps: {gaps}. '
        f'{("Notes summary: " + notes_summary[:1500]) if notes_summary else "No notes uploaded yet."}\n'
        f'{horizon_rule} Each task has a clear action and names the concept it builds. '
        'Mix kinds: "learn" (study/understand), "practice" (solve problems), '
        '"revise" (recap), "assess" (a quiz/mock). Prefer the student\'s weak concepts first.\n'
        'JSON shape: {"title","summary","tasks":[{"day_index":int,"title","detail",'
        '"concept","kind":"learn|practice|revise|assess","estimated_minutes":int}]}'
    )
    return system, user


def notes_ingest(text: str, topic: str | None) -> tuple[str, str]:
    system = ("You summarise a student's own study notes and produce flashcards from them. "
              "Return ONLY JSON.")
    user = (
        f'{"Topic: " + topic + ". " if topic else ""}Notes:\n"""{text[:6000]}"""\n'
        'JSON shape: {"summary","flashcards":[{"front","back"}]}'
    )
    return system, user
