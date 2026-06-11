"""AI service — owns ALL LLM calls (architecture doc §2: Laravel never talks
to a model directly). One service, prompt-specialized roles (master prompt B5):

    POST /ai/chat/turn             tutor reply (+ structured meta, streams via SSE)
    POST /ai/assessment/generate   diagnostic questions
    POST /ai/assessment/grade      LLM-rubric grading for free-text answers
    POST /ai/gap/analyze           gaps + root cause
    POST /ai/plan/build            next-step learning plan
    POST /ai/report/parent         plain-language parent report
    GET  /health

Every response carries `usage` {prompt_tokens, completion_tokens, model} so
Laravel can meter cost and write the token ledger (token spec §9).
"""
import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from . import config, llm, prompts
from .schemas import (AssessmentGenerateRequest, AssessmentGradeRequest,
                      ChatTurnMeta, ChatTurnRequest, ChatTurnResponse,
                      GapAnalyzeRequest, ParentReportRequest, PlanBuildRequest,
                      Usage)

app = FastAPI(title="AI Tutor — AI Service", version="1.0.0")


@app.get("/health")
async def health():
    return {"ok": True, "mock": config.MOCK, "model": "mock" if config.MOCK else config.GEMINI_MODEL}


# ---------------------------------------------------------------- chat turn

def _split_meta(text: str) -> tuple[str, ChatTurnMeta]:
    """Strip the hidden META trailer from a full reply."""
    meta = ChatTurnMeta()
    if prompts.META_MARKER in text:
        body, _, trailer = text.partition(prompts.META_MARKER)
        try:
            meta = ChatTurnMeta(**llm.parse_json(trailer))
        except Exception:
            pass
        return body.rstrip(), meta
    return text, meta


@app.post("/ai/chat/turn")
async def chat_turn(req: ChatTurnRequest):
    system, user = prompts.chat_turn(req)

    if not req.stream:
        result = await llm.generate(system, user)
        body, meta = _split_meta(result.text)
        return ChatTurnResponse(reply=body, meta=meta, usage=result.usage)

    async def sse():
        """Stream deltas; hold back anything after the META marker, then emit
        a final `meta` + `done` event. SSE protocol matches what the Laravel
        proxy re-emits to the browser."""
        full, sent = "", 0
        usage = Usage()
        try:
            async for chunk in llm.generate_stream(system, user):
                if "usage" in chunk:
                    usage = chunk["usage"]
                    continue
                full += chunk["delta"]
                # Never emit past a (possibly partial) META marker at the tail.
                cut = full.find(prompts.META_MARKER)
                if cut == -1:
                    safe = len(full)
                    for k in range(1, len(prompts.META_MARKER)):
                        if full.endswith(prompts.META_MARKER[:k]):
                            safe = len(full) - k
                            break
                else:
                    safe = cut
                if safe > sent:
                    yield ("event: delta\ndata: "
                           + json.dumps({"text": full[sent:safe]}) + "\n\n")
                    sent = safe
        except Exception as e:  # surface upstream failure as an SSE error
            yield ("event: error\ndata: "
                   + json.dumps({"message": f"AI service error: {e}"}) + "\n\n")
            return

        body, meta = _split_meta(full)
        done = {"reply": body, "meta": meta.model_dump(), "usage": usage.model_dump()}
        yield "event: done\ndata: " + json.dumps(done) + "\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ------------------------------------------------------------- assessments

@app.post("/ai/assessment/generate")
async def assessment_generate(req: AssessmentGenerateRequest):
    system, user = prompts.assessment_generate(
        req.student, req.topic, req.count, req.concepts, req.difficulty, req.attempt_no)
    result = await llm.generate(system, user, json_mode=True)
    data = llm.parse_json(result.text, {"questions": []})
    return {"questions": data.get("questions", []), "usage": result.usage}


@app.post("/ai/assessment/grade")
async def assessment_grade(req: AssessmentGradeRequest):
    system, user = prompts.assessment_grade(req.student, req.topic, req.items)
    result = await llm.generate(system, user, json_mode=True)
    data = llm.parse_json(result.text, {"results": []})
    return {"results": data.get("results", []), "usage": result.usage}


# ------------------------------------------------------------ gap analysis

@app.post("/ai/gap/analyze")
async def gap_analyze(req: GapAnalyzeRequest):
    if not req.results:
        return {"gaps": [],
                "summary": "No gaps detected — you answered everything correctly. Strong work!",
                "usage": Usage()}
    system, user = prompts.gap_analyze(req.student, req.topic, req.results)
    result = await llm.generate(system, user, json_mode=True)
    data = llm.parse_json(result.text, {"gaps": [], "summary": ""})
    return {"gaps": data.get("gaps", []), "summary": data.get("summary", ""),
            "usage": result.usage}


# ------------------------------------------------------------------- plans

@app.post("/ai/plan/build")
async def plan_build(req: PlanBuildRequest):
    system, user = prompts.plan_build(req.student, req.topic, req.gaps)
    result = await llm.generate(system, user, json_mode=True)
    data = llm.parse_json(result.text, {"title": "Your next steps", "items": []})
    return {"title": data.get("title", "Your next steps"),
            "rationale": data.get("rationale", ""),
            "items": data.get("items", []), "usage": result.usage}


# ----------------------------------------------------------- parent report

@app.post("/ai/report/parent")
async def report_parent(req: ParentReportRequest):
    system, user = prompts.parent_report(req.student, req.period, req.stats)
    result = await llm.generate(system, user, json_mode=True)
    data = llm.parse_json(result.text, {})
    return {"report": data, "usage": result.usage}
