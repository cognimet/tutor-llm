"""Role prompts — the 'AI roles' of master prompt B5, prompt-specialized
functions of this one service. Chat-turn replies end with a hidden JSON
trailer (after META_MARKER) carrying the tutor's structured 'mind' for the
live right panel (spec D6/D9); the marker is stripped before the student
sees anything.
"""
from .schemas import ChatTurnRequest, StudentContext

META_MARKER = "<<TUTOR_META>>"

MODES = {
    "teach": (
        "MODE teach-me (default): Explain step by step with a concrete example "
        "relevant to Indian school students. Point out the common mistake. Never "
        "just hand over a final answer to homework — scaffold first. End by "
        "checking understanding with one short question."
    ),
    "socratic": (
        "MODE socratic: NEVER explain directly. Respond ONLY with guiding "
        "questions (1–2 per turn) that lead the student to discover the idea "
        "themselves. Acknowledge their answers, then ask the next question."
    ),
    "quiz": (
        "MODE quiz-me: Ask one short question at a time on this topic, wait for "
        "the answer, grade it kindly, explain briefly, then ask the next. Vary "
        "difficulty with performance."
    ),
    "exam": (
        "MODE exam-drill: Pose exam-style questions in board-exam phrasing with "
        "marks weighting. Grade strictly against the marking scheme, show the "
        "ideal answer, and give one exam-technique tip per question."
    ),
    "eli10": (
        "MODE simplify (ELI10): Explain like the student is 10 years old — short "
        "sentences, everyday analogies, zero jargon. Then one-line 'grown-up "
        "version' at the end."
    ),
    "answer": (
        "MODE direct-answer: The student explicitly asked for the answer. Give "
        "the full worked solution clearly, then one line on how to avoid needing "
        "it next time."
    ),
}

FORMATTING = (
    "Formatting: clear Markdown — short paragraphs, **bold** key terms, numbered "
    "steps, `inline code` for variables. Write mathematics in LaTeX: inline as "
    "$...$ and display as $$...$$. Keep it concise and encouraging."
)


def persona(s: StudentContext) -> str:
    lang = {"hi": "Hindi", "hinglish": "Hinglish (Hindi + English mix)"}.get(
        s.language, "simple English")
    ctx = (f"a learner in the Indian education system studying: {s.curriculum_path}"
           if s.curriculum_path
           else f"a Class {s.grade or 10} {(s.board or 'CBSE').upper()} student in India")
    p = (f"You are 'Tuto', a warm, patient AI tutor for {ctx}. Calibrate depth, "
         f"vocabulary, examples and exam framing precisely to that level. "
         f"Explain in {lang}.")
    if s.memory:
        facts = "; ".join(f"{k}: {v}" for k, v in list(s.memory.items())[:8])
        p += f"\nWhat you remember about this student: {facts}."
    return p


def chat_turn(req: ChatTurnRequest) -> tuple[str, str]:
    """Build (system, user) for a tutor chat turn."""
    weak = [m for m in req.student.concept_mastery if float(m.get("score", 1)) < 0.6]
    mastery_lines = "".join(
        f"- {m.get('concept')}: {round(float(m.get('score', 0)) * 100)}%\n"
        for m in req.student.concept_mastery[:12])

    system = persona(req.student)
    system += (f"\nYou are tutoring strictly within this topic: \"{req.topic}\""
               f" (Chapter: {req.chapter}, Subject: {req.subject})."
               " If the student drifts off-topic, gently steer them back.\n")
    system += MODES.get(req.mode, MODES["teach"]) + "\n" + FORMATTING

    if req.attempt_no > 1 and req.last_gap:
        system += (f"\nThis is attempt {req.attempt_no} on this topic. Last time the "
                   f"student's gap was: \"{req.last_gap}\". Re-teach it DIFFERENTLY — "
                   "a new analogy or representation, never the same explanation again.")

    if mastery_lines:
        system += f"\nCurrent concept mastery for this topic:\n{mastery_lines}"
    if weak:
        system += ("Adapt difficulty toward the weak concepts: "
                   + ", ".join(m.get("concept", "") for m in weak[:5]) + ".\n")
    if req.student.open_misconceptions:
        system += ("Open misconceptions to watch for and fix: "
                   + "; ".join(req.student.open_misconceptions[:5]) + ".\n")

    if req.context_chunks:
        joined = "\n---\n".join(req.context_chunks[:6])
        system += ("\nGround your teaching in this curriculum material (do not go "
                   f"off-syllabus):\n{joined}\n")

    system += (
        f"\nAfter your reply, on a new line output exactly {META_MARKER} followed by "
        "a single-line JSON object (no code fence) of the form: "
        '{"concept_tags":["..."],"detected_misconception":null,'
        '"resolved_misconception":null,"mastery_signal":0.0,"difficulty_delta":0,'
        '"next_step":"...","suggested_render":"text"} . '
        "concept_tags = the concepts this turn touched; detected_misconception = a "
        "short description ONLY if the student's message reveals a genuine "
        "misconception, else null; resolved_misconception = a previously open "
        "misconception this turn clearly fixed, else null; mastery_signal in [-1,1] "
        "= how well the student is doing this turn; difficulty_delta in {-1,0,1}; "
        "next_step = one short sentence on what to do next; suggested_render in "
        '{"text","quiz","flashcards","canvas"}. The student never sees this trailer.'
    )

    convo = "".join(
        f"{'Student' if m.role == 'user' else 'Tutor'}: {m.content}\n"
        for m in req.history)
    user = (f"Topic: \"{req.topic}\"\n\nConversation so far:\n{convo}\n"
            f"Student: {req.message}\n\nTutor:")
    return system, user


def assessment_generate(student: StudentContext, topic: str, count: int,
                        concepts: list[str], difficulty: str, attempt_no: int) -> tuple[str, str]:
    system = (persona(student)
              + "\nYou create a short diagnostic assessment that reveals what the "
                "student truly understands. Return ONLY JSON.")
    focus = (f"Target these weak concepts: {', '.join(concepts)}. "
             if concepts else "Cover the topic's distinct sub-concepts. ")
    fresh = (f"This is attempt {attempt_no}; generate FRESH questions the student "
             "has not seen before. " if attempt_no > 1 else "")
    user = (f"Create {count} multiple-choice questions for the topic \"{topic}\". "
            f"{focus}{fresh}Difficulty: {difficulty}. Each question must probe one "
            "sub-concept and include a plausible distractor reflecting a common "
            "misconception.\nReturn JSON: "
            '{"questions":[{"question":"...","options":["..","..","..",".."],'
            '"correct_index":0,"concept":"sub-concept name",'
            '"misconception":"what picking the trap option reveals",'
            '"explanation":"why correct","difficulty":"easy|medium|hard"}]}')
    return system, user


def assessment_grade(student: StudentContext, topic: str, items: list[dict]) -> tuple[str, str]:
    system = (persona(student)
              + "\nYou grade a student's free-text answers against a rubric, "
                "kindly but accurately. Return ONLY JSON.")
    lines = "".join(
        f"- Q: {i.get('question')} | concept: {i.get('concept')} | "
        f"expected: {i.get('answer_key')} | student wrote: {i.get('raw_answer')}\n"
        for i in items)
    user = (f"Topic: \"{topic}\". Grade each answer:\n{lines}\n"
            'Return JSON: {"results":[{"is_correct":true,"partial_score":1.0,'
            '"ai_feedback":"one supportive line","detected_misconception":null}]} '
            "in the same order. partial_score in [0,1].")
    return system, user


def gap_analyze(student: StudentContext, topic: str, results: list[dict]) -> tuple[str, str]:
    system = (persona(student)
              + "\nYou analyse wrong answers to find the underlying knowledge gaps "
                "and their ROOT CAUSE (the prerequisite concept that's actually "
                "broken), not just the symptom. Return ONLY JSON.")
    lines = "".join(
        f"- Concept: {r.get('concept')} | Question: {r.get('question')}"
        + (f" | student answered: {r.get('raw_answer')}" if r.get("raw_answer") else "")
        + "\n"
        for r in results)
    user = (f"Topic: \"{topic}\". The student got these wrong:\n{lines}\n"
            "Identify the gaps. For each give severity (low|medium|high), the "
            "likely root-cause prerequisite, and a one-line recommendation.\n"
            'Return JSON: {"gaps":[{"concept":"..","severity":"medium",'
            '"root_cause":"..","recommendation":".."}],'
            '"summary":"one short paragraph for the student"}')
    return system, user


def plan_build(student: StudentContext, topic: str, gaps: list[dict]) -> tuple[str, str]:
    system = (persona(student)
              + "\nYou design a light, motivating learning plan (next steps), "
                "ordered so prerequisites come first. Return ONLY JSON.")
    gap_text = ("Focus on these gaps (worst first): "
                + ", ".join(g.get("concept", "") for g in gaps) + "."
                if gaps else "No major gaps; suggest light reinforcement.")
    user = (f"Topic: \"{topic}\". {gap_text}\n"
            "Create 3-4 short concrete next-step tasks, each under 20 minutes.\n"
            'Return JSON: {"title":"..","rationale":"one line on why this order",'
            '"items":[{"title":"..","detail":"..","concept":"..",'
            '"estimated_minutes":15}]}')
    return system, user


def parent_report(student: StudentContext, period: str, stats: dict) -> tuple[str, str]:
    system = ("You write a short, plain-language progress report for a "
              "non-technical Indian parent reading on a phone. Warm, honest, "
              "specific. No jargon, no raw scores dump. Return ONLY JSON.")
    user = (f"Student: {student.name}. Period: {period}. Data: {stats}\n"
            'Return JSON: {"headline":"one sentence (e.g. On track in Maths, '
            'needs attention in Electricity)","summary":"3-4 sentences",'
            '"wins":["..."],"focus_areas":["..."],"suggestion":"one thing the '
            'parent can do"}')
    return system, user
