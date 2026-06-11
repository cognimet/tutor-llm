"""LLM client — single place every model call goes through.

Keeps the provider behind one interface (master prompt B6) so model routing
(Phase 3) is a config change. Returns real token usage on every call so the
Laravel meter can write the token_ledger (token spec §3.2).

Mock mode (no key / GEMINI_MOCK=true) returns deterministic content so the
whole product runs with zero external calls.
"""
import asyncio
import json
import re
from typing import AsyncIterator, Callable, Optional

import httpx

from . import config
from .schemas import Usage


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class LLMResult:
    def __init__(self, text: str, usage: Usage):
        self.text = text
        self.usage = usage


async def generate(system: str, user: str, json_mode: bool = False,
                   temperature: float = 0.7, max_tokens: int = 2048) -> LLMResult:
    if config.MOCK:
        from . import mock
        text = mock.respond(system, user, json_mode)
        return LLMResult(text, Usage(
            prompt_tokens=_estimate_tokens(system + user),
            completion_tokens=_estimate_tokens(text),
            model="mock",
        ))

    url = f"{config.GEMINI_BASE_URL}/models/{config.GEMINI_MODEL}:generateContent"
    gen_config: dict = {"temperature": 0.4 if json_mode else temperature,
                        "maxOutputTokens": max_tokens}
    if json_mode:
        gen_config["responseMimeType"] = "application/json"

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen_config,
    }

    transient = {429, 500, 502, 503, 504}
    async with httpx.AsyncClient(timeout=config.GEMINI_TIMEOUT) as client:
        for attempt in range(1, 4):
            try:
                r = await client.post(url, json=payload,
                                      headers={"x-goog-api-key": config.GEMINI_API_KEY})
                if r.status_code in transient and attempt < 3:
                    await asyncio.sleep(attempt * 0.8)
                    continue
                r.raise_for_status()
                data = r.json()
                text = (data.get("candidates") or [{}])[0].get("content", {}) \
                    .get("parts", [{}])[0].get("text", "") or ""
                meta = data.get("usageMetadata", {})
                return LLMResult(text, Usage(
                    prompt_tokens=int(meta.get("promptTokenCount", _estimate_tokens(system + user))),
                    completion_tokens=int(meta.get("candidatesTokenCount", _estimate_tokens(text))),
                    model=config.GEMINI_MODEL,
                ))
            except httpx.HTTPError:
                if attempt < 3:
                    await asyncio.sleep(attempt * 0.8)
                    continue
                raise
    return LLMResult("", Usage(model=config.GEMINI_MODEL))


async def generate_stream(system: str, user: str, temperature: float = 0.7,
                          max_tokens: int = 2048) -> AsyncIterator[dict]:
    """Yield {"delta": str} chunks, then a final {"usage": Usage}."""
    if config.MOCK:
        from . import mock
        text = mock.respond(system, user, json_mode=False)
        # Simulate streaming so the UX is identical without an API key.
        for i in range(0, len(text), 12):
            yield {"delta": text[i:i + 12]}
            await asyncio.sleep(0.012)
        yield {"usage": Usage(prompt_tokens=_estimate_tokens(system + user),
                              completion_tokens=_estimate_tokens(text), model="mock")}
        return

    url = f"{config.GEMINI_BASE_URL}/models/{config.GEMINI_MODEL}:streamGenerateContent?alt=sse"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }

    usage = Usage(model=config.GEMINI_MODEL)
    produced = 0
    async with httpx.AsyncClient(timeout=config.GEMINI_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload,
                                 headers={"x-goog-api-key": config.GEMINI_API_KEY}) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                delta = (data.get("candidates") or [{}])[0].get("content", {}) \
                    .get("parts", [{}])[0].get("text", "") or ""
                if delta:
                    produced += len(delta)
                    yield {"delta": delta}
                meta = data.get("usageMetadata")
                if meta:
                    usage.prompt_tokens = int(meta.get("promptTokenCount", 0))
                    usage.completion_tokens = int(meta.get("candidatesTokenCount", 0))
    if not usage.completion_tokens:
        usage.completion_tokens = _estimate_tokens(" " * produced)
    yield {"usage": usage}


def parse_json(text: str, fallback: Optional[dict] = None) -> dict:
    """Decode a JSON object from model output, stripping code fences."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        out = json.loads(text)
        if isinstance(out, dict):
            return out
    except json.JSONDecodeError:
        pass
    m = re.search(r"(\{.*\}|\[.*\])", text, re.S)
    if m:
        try:
            out = json.loads(m.group(1))
            if isinstance(out, dict):
                return out
            if isinstance(out, list):
                return {"items": out}
        except json.JSONDecodeError:
            pass
    return fallback or {}
