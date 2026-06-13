"""AI Tutor — Python AI service (FastAPI).

The single home for all LLM/RAG/embedding work. Laravel (system of record)
calls these endpoints over internal REST; this service never touches the
product database. Every response carries token `usage` for metering.

Roles -> endpoints:
  POST /ai/chat/turn            teacher (grounded explanation + signals)
  POST /ai/chat/stream          teacher, streamed (SSE)
  POST /ai/assessment/generate  diagnostic questions
  POST /ai/assessment/grade     grade open answers + name misconceptions
  POST /ai/gap/analyze          concept gaps + root cause
  POST /ai/plan/build           study plan from gaps
  POST /ai/notes/ingest         summarise notes -> flashcards (+ index for RAG)
  GET  /health
"""
import json
import logging
import uuid

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import settings
from .llm import llm
from . import prompts, rag, graph
from .schemas import (
    ChatTurnRequest, ChatTurnResponse,
    AssessmentGenerateRequest, AssessmentGenerateResponse, Question,
    AssessmentGradeRequest, AssessmentGradeResponse, GradedItem,
    GapAnalyzeRequest, GapAnalyzeResponse, Gap,
    PlanBuildRequest, PlanBuildResponse, PlanItem,
    NotesIngestRequest, NotesIngestResponse, Usage,
    ExtractRequest, ExtractResponse,
    StudyScheduleRequest, StudyScheduleResponse, ScheduleTask,
)

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="AI Tutor — AI Service", version="1.0.0")


@app.on_event("startup")
async def _on_startup() -> None:
    """Ensure the Neo4j constraints exist (idempotent, non-fatal)."""
    try:
        await graph.ensure_schema()
    except Exception as e:  # noqa: BLE001
        logging.warning("graph schema init skipped: %s", e)


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    await graph.close()


def _auth(authorization: str | None) -> None:
    """Simple shared-secret guard so only Laravel can call this service."""
    if not settings.internal_api_key:
        return  # open in local/dev if no key set
    expected = f"Bearer {settings.internal_api_key}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "mock": settings.is_mock,
        "provider": settings.resolved_provider,
        "model": settings.resolved_model,
        "routing": settings.routing_table,
        "single_model": bool(settings.ai_model),
        "rag": bool(settings.qdrant_url),
        "embedder": rag.embed_provider(),
        "graph": await graph.status(),
    }


# ── Generic passthrough (lets Laravel route its existing prompts through the
#    one AI service so it never calls the LLM directly; returns token usage). ──
class TextRequest(BaseModel):
    system: str
    user: str
    topic: str | None = None        # when set, RAG curriculum context is injected
    rag_query: str | None = None    # text to retrieve on (defaults to `user`)
    student_id: int | None = None   # personalises graph-aware retrieval
    action: str = "chat"            # model-routing group: chat|structured|grade


class JsonRequest(BaseModel):
    system: str
    user: str
    fallback: dict = {}
    topic: str | None = None
    rag_query: str | None = None
    student_id: int | None = None
    action: str = "structured"      # model-routing group: chat|structured|grade


async def _ground(system: str, topic: str | None, query: str, student_id: int | None = None) -> str:
    """Prepend retrieved curriculum context to a system prompt when a topic is set.
    When `student_id` is given, retrieval is graph-aware (prerequisites + the
    student's weak concepts + their own uploaded notes)."""
    if not topic:
        return system
    chunks = await rag.retrieve(query, topic=topic, student_id=student_id)
    return system + rag.as_context(chunks)


@app.post("/ai/text")
async def ai_text(req: TextRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user, req.student_id)
    out, usage = await llm.text(system, req.user, action=req.action)
    return {"text": out, "usage": usage.model_dump()}


@app.post("/ai/json")
async def ai_json(req: JsonRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user, req.student_id)
    out, usage = await llm.json(system, req.user, req.fallback, action=req.action)
    return {"data": out, "usage": usage.model_dump()}


@app.post("/ai/stream")
async def ai_stream(req: TextRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user, req.student_id)

    async def gen():
        final_usage = None
        async for delta, usage in llm.stream(system, req.user, action=req.action):
            if delta:
                yield f"data: {json.dumps({'delta': delta})}\n\n"
            if usage is not None:
                final_usage = usage
        yield f"data: {json.dumps({'done': True, 'usage': final_usage.model_dump() if final_usage else None})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── Curriculum indexing (RAG ingestion) ────────────────────────────────
class IndexPoint(BaseModel):
    id: int
    topic: str
    type: str = "explainer"
    body: str


class IndexRequest(BaseModel):
    points: list[IndexPoint]


@app.post("/ai/embed/index")
async def embed_index(req: IndexRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    n = await rag.index([p.model_dump() for p in req.points])
    return {"indexed": n, "rag_enabled": bool(settings.qdrant_url)}


@app.post("/ai/embed/ensure")
async def embed_ensure(authorization: str | None = Header(None)):
    _auth(authorization)
    await rag.ensure_collection()
    return {"ok": True, "rag_enabled": bool(settings.qdrant_url)}


class DeleteTopicRequest(BaseModel):
    topic: str


@app.post("/ai/embed/delete-topic")
async def embed_delete_topic(req: DeleteTopicRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    await rag.delete_topic(req.topic)
    return {"ok": True}


# ── OCR (snap-a-doubt): photo -> text -> the normal tutor pipeline ─────
class OcrRequest(BaseModel):
    image_base64: str               # raw base64 (no data: prefix)
    languages: str = "eng+hin"      # tesseract language pack(s)


def _ocr_image_bytes(raw: bytes, languages: str = "eng+hin") -> str:
    """Tesseract OCR on raw image bytes. Shared by /ai/ocr and /ai/extract."""
    import io
    try:
        from PIL import Image, ImageOps
        import pytesseract
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=501, detail=f"OCR not available: {e}")
    try:
        img = Image.open(io.BytesIO(raw))
        # Light preprocessing: orientation fix + grayscale helps handwriting/photos.
        img = ImageOps.exif_transpose(img).convert("L")
        text = pytesseract.image_to_string(img, lang=languages) or ""
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not read the image: {e}")
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


@app.post("/ai/ocr")
async def ai_ocr(req: OcrRequest, authorization: str | None = Header(None)):
    """Extract text from a problem photo (architecture doc: OCR/vision -> text
    -> same pipeline). Local tesseract: deterministic, free, offline."""
    _auth(authorization)
    import base64
    raw = base64.b64decode(req.image_base64, validate=False)
    text = _ocr_image_bytes(raw, req.languages)
    # OCR is local — no LLM tokens consumed.
    usage = Usage(model="tesseract", mock=False)
    return {"text": text, "usage": usage.model_dump()}


# ── File text extraction (notes upload): pdf/docx/xlsx/txt/image -> text ──
def _extract_kind(filename: str, mime: str | None) -> str:
    name = (filename or "").lower()
    mime = (mime or "").lower()
    if name.endswith(".pdf") or "pdf" in mime:
        return "pdf"
    if name.endswith((".docx", ".doc")) or "word" in mime or "msword" in mime:
        return "doc"
    if name.endswith((".xlsx", ".xls", ".csv")) or "spreadsheet" in mime or "excel" in mime:
        # .csv is plain text, handled in the "sheet" branch via a quick decode.
        return "sheet"
    if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff")) or mime.startswith("image/"):
        return "image"
    return "text"


@app.post("/ai/extract", response_model=ExtractResponse)
async def ai_extract(req: ExtractRequest, authorization: str | None = Header(None)):
    """Pull plain text out of an uploaded study file so the tutor can read it.
    Pure-Python parsers (no system deps); images fall back to tesseract OCR."""
    _auth(authorization)
    import base64
    import io

    raw = base64.b64decode(req.content_base64, validate=False)
    kind = _extract_kind(req.filename, req.mime)
    name = (req.filename or "").lower()
    text = ""
    meta: dict = {}

    try:
        if kind == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            pages = [(p.extract_text() or "") for p in reader.pages]
            text = "\n\n".join(pages).strip()
            meta["pages"] = len(reader.pages)
            if len(text) < 20:
                meta["note"] = "Little text found — this PDF may be scanned images."
        elif kind == "doc":
            if name.endswith(".doc") and not name.endswith(".docx"):
                raise HTTPException(status_code=422,
                                    detail="Old .doc isn't supported — please save as .docx and re-upload.")
            import docx  # python-docx
            d = docx.Document(io.BytesIO(raw))
            parts = [p.text for p in d.paragraphs if p.text and p.text.strip()]
            for table in d.tables:
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
            text = "\n".join(parts).strip()
            meta["paragraphs"] = len(parts)
        elif kind == "sheet":
            if name.endswith(".csv"):
                text = raw.decode("utf-8", errors="replace").strip()
            elif name.endswith(".xls") and not name.endswith(".xlsx"):
                raise HTTPException(status_code=422,
                                    detail="Old .xls isn't supported — please save as .xlsx and re-upload.")
            else:
                from openpyxl import load_workbook
                wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
                lines: list[str] = []
                for ws in wb.worksheets:
                    lines.append(f"# Sheet: {ws.title}")
                    for row in ws.iter_rows(values_only=True):
                        cells = ["" if c is None else str(c) for c in row]
                        if any(cells):
                            lines.append(" | ".join(cells))
                text = "\n".join(lines).strip()
                meta["sheets"] = len(wb.worksheets)
        elif kind == "image":
            text = _ocr_image_bytes(raw, req.languages)
            if len(text) < 3:
                meta["note"] = "No readable text found in the image."
        else:  # text | md | csv | unknown -> best-effort decode
            text = raw.decode("utf-8", errors="replace").strip()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not read {req.filename}: {e}")

    meta["chars"] = len(text)
    # Extraction is local — no LLM tokens consumed.
    usage = Usage(model="local", mock=False)
    return ExtractResponse(text=text, kind=kind, meta=meta, usage=usage)


@app.get("/ai/rag/status")
async def rag_status(authorization: str | None = Header(None)):
    """Vector-store health: is RAG live and how many chunks are indexed?"""
    _auth(authorization)
    return await rag.status()


# ── Knowledge graph (GraphRAG "AI mind") ────────────────────────────────
class CurriculumTopicNode(BaseModel):
    stage_id: int
    stage: str
    track_id: int
    track: str
    level_id: int
    level: str
    subject_id: int
    subject: str
    chapter_id: int
    chapter: str
    topic_id: int
    topic: str
    position: int = 0


class CurriculumUpsertRequest(BaseModel):
    topics: list[CurriculumTopicNode] = []
    next_pairs: list[list[str]] = []      # [[prev_topic_name, topic_name], ...]
    concepts: list[dict] = []             # [{topic, name}, ...]


@app.post("/ai/graph/curriculum/upsert")
async def graph_curriculum_upsert(req: CurriculumUpsertRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    n = await graph.upsert_curriculum([t.model_dump() for t in req.topics], req.next_pairs, req.concepts)
    return {"upserted": n, "graph_enabled": graph.enabled()}


class GraphEventRequest(BaseModel):
    user_id: int
    type: str
    text: str = ""
    topic: str | None = None
    concepts: list[str] = []
    meta: dict = {}
    embed: bool = True       # false for high-frequency timing/engagement pings
    ts: str | None = None


@app.post("/ai/graph/event")
async def graph_event(req: GraphEventRequest, authorization: str | None = Header(None)):
    """Record one tracked user action. Meaningful actions are embedded into
    Qdrant `events` for semantic recall; high-frequency timing/engagement pings
    (`embed=false`) skip the vector and only create the graph :Event node."""
    _auth(authorization)
    qid = await rag.index_event(req.user_id, req.type, req.topic, req.text) if req.embed else None
    eid = qid or str(uuid.uuid4())
    await graph.record_event(eid, req.user_id, req.type, req.text, req.topic,
                             req.concepts, qid, req.ts, req.meta)
    return {"id": eid, "qdrant_id": qid, "graph_enabled": graph.enabled()}


class MasteryItem(BaseModel):
    topic: str
    concept: str
    score: float = 0
    confidence: int = 0


class MisconceptionItem(BaseModel):
    topic: str
    description: str
    status: str = "open"


class FocusItem(BaseModel):
    topic: str | None = None
    concept: str | None = None
    reason: str | None = None


class GraphStateRequest(BaseModel):
    user_id: int
    name: str | None = None
    mastery: list[MasteryItem] = []
    misconceptions: list[MisconceptionItem] = []
    focus: FocusItem | None = None


@app.post("/ai/graph/state")
async def graph_state(req: GraphStateRequest, authorization: str | None = Header(None)):
    """Mirror MindService state (mastery, misconceptions, next focus) into the graph."""
    _auth(authorization)
    await graph.set_state(
        req.user_id, req.name,
        [m.model_dump() for m in req.mastery],
        [m.model_dump() for m in req.misconceptions],
        req.focus.model_dump() if req.focus else None,
    )
    return {"ok": True, "graph_enabled": graph.enabled()}


@app.get("/ai/graph/focus")
async def graph_focus(student_id: int, authorization: str | None = Header(None)):
    """The student's single cross-topic next focused area."""
    _auth(authorization)
    return {"focus": await graph.next_focus(student_id)}


@app.get("/ai/graph/status")
async def graph_status_ep(authorization: str | None = Header(None)):
    _auth(authorization)
    return await graph.status()


@app.post("/ai/chat/turn", response_model=ChatTurnResponse)
async def chat_turn(req: ChatTurnRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    chunks = await rag.retrieve(req.message, topic=req.topic, student_id=req.student_id)
    system, user = prompts.chat_turn(req, rag.as_context(chunks))
    reply, usage = await llm.text(system, user, action="chat")

    # Second, cheap call for structured signals (skipped in mock to save a hop).
    tags, misconception, delta, render, nxt = [], None, 0, "text", None
    if not settings.is_mock and reply:
        ms, mu = prompts.chat_metadata(req, reply)
        meta, meta_usage = await llm.json(ms, mu, {}, action="grade")
        if isinstance(meta, dict):
            tags = meta.get("concept_tags", []) or []
            misconception = meta.get("detected_misconception")
            delta = int(meta.get("difficulty_delta", 0) or 0)
            render = meta.get("suggested_render", "text") or "text"
            nxt = meta.get("next_step")
        usage = _merge_usage(usage, meta_usage)

    return ChatTurnResponse(
        reply=reply, concept_tags=tags, detected_misconception=misconception,
        difficulty_delta=delta, suggested_render=render, next_step=nxt, usage=usage,
    )


@app.post("/ai/chat/stream")
async def chat_stream(req: ChatTurnRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    chunks = await rag.retrieve(req.message, topic=req.topic, student_id=req.student_id)
    system, user = prompts.chat_turn(req, rag.as_context(chunks))

    async def gen():
        final_usage: Usage | None = None
        async for delta, usage in llm.stream(system, user, action="chat"):
            if delta:
                yield f"data: {json.dumps({'delta': delta})}\n\n"
            if usage is not None:
                final_usage = usage
        payload = {"done": True, "usage": (final_usage.model_dump() if final_usage else None)}
        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/ai/assessment/generate", response_model=AssessmentGenerateResponse)
async def assessment_generate(req: AssessmentGenerateRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.assessment_generate(req.student, req.topic, req.count)
    data, usage = await llm.json(system, user, {"questions": []}, action="structured")
    questions = [Question(**_q) for _q in _safe_list(data, "questions")]
    return AssessmentGenerateResponse(questions=questions, usage=usage)


class AssessmentValidateRequest(BaseModel):
    topic: str
    questions: list[dict] = []   # [{question, options, correct_index, concept}]


@app.post("/ai/assessment/validate")
async def assessment_validate(req: AssessmentValidateRequest, authorization: str | None = Header(None)):
    """Post-hoc curriculum validation: given the topic's curriculum (RAG) and a
    set of generated questions, return the indices that are on-syllabus AND
    correctly keyed. Falls back to keeping all if there's nothing to validate
    against, so it never empties a quiz on a flaky check."""
    _auth(authorization)
    n = len(req.questions)
    if n == 0:
        return {"keep": [], "usage": Usage(model="none", mock=settings.is_mock).model_dump()}

    chunks = await rag.retrieve(req.topic, topic=req.topic)
    if not chunks:  # no curriculum indexed for this topic — can't validate
        return {"keep": list(range(n)), "usage": Usage(model="none", mock=settings.is_mock).model_dump()}

    lines = []
    for i, q in enumerate(req.questions):
        opts = q.get("options") or []
        ci = q.get("correct_index", 0)
        correct = opts[ci] if isinstance(ci, int) and 0 <= ci < len(opts) else ""
        lines.append(f'{i}. Q: {q.get("question", "")} | Marked correct: {correct}')

    system = (
        "You are a strict exam moderator. You are given CURRICULUM and a numbered list of quiz "
        "questions. Return ONLY JSON {\"keep\":[indices]} — the indices of questions that are "
        "(a) on-syllabus for this curriculum AND (b) have a correct marked answer. Drop anything "
        "off-syllabus, ambiguous, or wrongly keyed."
    )
    user = rag.as_context(chunks) + "\n\nQuestions:\n" + "\n".join(lines) + "\n\nReturn {\"keep\":[...]}."
    data, usage = await llm.json(system, user, {"keep": list(range(n))}, action="grade")
    keep = [i for i in (data.get("keep", []) if isinstance(data, dict) else []) if isinstance(i, int) and 0 <= i < n]
    if not keep:  # never nuke the whole quiz if the moderator returns nothing
        keep = list(range(n))
    return {"keep": keep, "usage": usage.model_dump()}


@app.post("/ai/assessment/grade", response_model=AssessmentGradeResponse)
async def assessment_grade(req: AssessmentGradeRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    # Deterministic grading for exact-match types; LLM only for open answers.
    open_items = [it for it in req.items if it.type not in ("mcq", "truefalse", "numeric", "fill")]
    graded: list[GradedItem] = []
    for it in req.items:
        if it.type in ("mcq", "truefalse", "numeric", "fill"):
            ok = it.student_answer.strip().lower() == it.correct_answer.strip().lower()
            graded.append(GradedItem(concept=it.concept, is_correct=ok,
                                     partial_score=1.0 if ok else 0.0,
                                     feedback="Correct" if ok else "Not quite"))
    usage = Usage(model=settings.model_for("grade"), mock=settings.is_mock)
    if open_items:
        system, user = prompts.assessment_grade(req.topic, open_items)
        data, usage = await llm.json(system, user, {"graded": []}, action="grade")
        for g in _safe_list(data, "graded"):
            graded.append(GradedItem(**g))
    return AssessmentGradeResponse(graded=graded, usage=usage)


@app.post("/ai/gap/analyze", response_model=GapAnalyzeResponse)
async def gap_analyze(req: GapAnalyzeRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.gap_analyze(req.topic, req.results)
    data, usage = await llm.json(system, user, {"gaps": [], "summary": ""}, action="structured")
    gaps = [Gap(**g) for g in _safe_list(data, "gaps")]
    summary = data.get("summary", "") if isinstance(data, dict) else ""
    return GapAnalyzeResponse(gaps=gaps, summary=summary, usage=usage)


@app.post("/ai/plan/build", response_model=PlanBuildResponse)
async def plan_build(req: PlanBuildRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.plan_build(req.topic, req.gaps)
    data, usage = await llm.json(system, user, {"title": "Your next steps", "items": []}, action="structured")
    items = [PlanItem(**i) for i in _safe_list(data, "items")]
    title = data.get("title", "Your next steps") if isinstance(data, dict) else "Your next steps"
    return PlanBuildResponse(title=title, items=items, usage=usage)


@app.post("/ai/study/schedule", response_model=StudyScheduleResponse)
async def study_schedule(req: StudyScheduleRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.study_schedule(
        req.topic, req.horizon, req.days_remaining, req.exam_date,
        req.notes_summary, req.gaps, req.mastery,
    )
    data, usage = await llm.json(system, user, {"title": "Your study plan", "summary": "", "tasks": []},
                                 action="structured")
    tasks = [ScheduleTask(**t) for t in _safe_list(data, "tasks")]
    title = data.get("title", "Your study plan") if isinstance(data, dict) else "Your study plan"
    summary = data.get("summary", "") if isinstance(data, dict) else ""
    return StudyScheduleResponse(title=title, summary=summary, tasks=tasks, usage=usage)


@app.post("/ai/notes/ingest", response_model=NotesIngestResponse)
async def notes_ingest(req: NotesIngestRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.notes_ingest(req.text, req.topic)
    data, usage = await llm.json(system, user, {"summary": "", "flashcards": []}, action="structured")
    summary = data.get("summary", "") if isinstance(data, dict) else ""
    flashcards = _safe_list(data, "flashcards")

    # Chunk + index the note text so the tutor can later retrieve the student's
    # OWN material (Qdrant `documents`), and link the note in the graph.
    chunks_indexed = 0
    if req.note_id is not None:
        qids = await rag.index_documents(req.student_id, req.note_id, req.topic, _chunk_text(req.text))
        await graph.link_note(req.note_id, req.title or "Note", req.topic, req.student_id, qids)
        chunks_indexed = len(qids)

    return NotesIngestResponse(summary=summary, flashcards=flashcards,
                               chunks_indexed=chunks_indexed, usage=usage)


# ── helpers ────────────────────────────────────────────────────────────
def _chunk_text(text: str, size: int = 800, overlap: int = 100, max_chunks: int = 40) -> list[str]:
    """Split note text into overlapping chunks for embedding. Splits on
    paragraph/sentence boundaries where possible, hard-wrapping long runs."""
    text = (text or "").strip()
    if not text:
        return []
    paras = [p.strip() for p in text.split("\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 1 <= size:
            buf = f"{buf}\n{p}".strip()
        else:
            if buf:
                chunks.append(buf)
            # hard-wrap a paragraph longer than `size`
            while len(p) > size:
                chunks.append(p[:size])
                p = p[max(0, size - overlap):]
            buf = p
    if buf:
        chunks.append(buf)
    return chunks[:max_chunks]


def _safe_list(data, key: str) -> list:
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    if isinstance(data, list) and key in ("questions", "items", "graded", "gaps", "flashcards", "tasks"):
        return data
    return []


def _merge_usage(a: Usage, b: Usage) -> Usage:
    return Usage(
        model=a.model,
        prompt_tokens=a.prompt_tokens + b.prompt_tokens,
        completion_tokens=a.completion_tokens + b.completion_tokens,
        total_tokens=a.total_tokens + b.total_tokens,
        mock=a.mock or b.mock,
    )
