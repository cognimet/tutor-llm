"""LLM provider implementations — Gemini, OpenAI, Anthropic (Claude).

One interface, three providers. Every method returns (output, Usage) with
token counts normalized across providers, so metering and routing upstream
never care which vendor served the request.

    provider.text(system, user)        -> (str, Usage)
    provider.json(system, user, fb)    -> (dict, Usage)
    provider.stream(system, user)      -> async iterator of (delta, Usage|None)
                                          (final yield carries the Usage)
"""
import asyncio
import json
import logging
import re

import httpx

from .config import settings
from .schemas import Usage

log = logging.getLogger("ai.providers")

_TRANSIENT = {429, 500, 502, 503, 529}
_MAX_ATTEMPTS = 5
# 429s on free-tier gateways (OpenRouter) are per-minute limits — quick
# sub-second retries just burn attempts. Back off properly and honor
# Retry-After when the server sends one.
_BACKOFF_429 = [2, 5, 10, 15]
_BACKOFF_5XX = [1, 2, 4, 8]
_MAX_TOKENS = 2048


def decode_json(text: str):
    """Tolerant JSON extraction (strips fences, grabs first {...}/[...] block)."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                return None
    return None


async def _post_with_retry(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                r = await client.post(url, json=payload, headers=headers)
                if r.status_code == 200:
                    return r.json()
                if r.status_code in _TRANSIENT and attempt < _MAX_ATTEMPTS:
                    if r.status_code == 429:
                        retry_after = r.headers.get("retry-after")
                        try:
                            wait = min(20.0, float(retry_after)) if retry_after else _BACKOFF_429[attempt - 1]
                        except ValueError:
                            wait = _BACKOFF_429[attempt - 1]
                    else:
                        wait = _BACKOFF_5XX[attempt - 1]
                    log.warning("LLM %s (attempt %s/%s) — retrying in %.1fs",
                                r.status_code, attempt, _MAX_ATTEMPTS, wait)
                    await asyncio.sleep(wait)
                    continue
                log.warning("LLM error %s: %s", r.status_code, r.text[:300])
                return {}
            except httpx.HTTPError as e:
                if attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(_BACKOFF_5XX[attempt - 1])
                    continue
                log.error("LLM request failed: %s", e)
                return {}
    return {}


# ════════════════════════════════ Gemini ═══════════════════════════════
class GeminiProvider:
    name = "gemini"

    def __init__(self, model: str):
        self.model = model
        self.base = settings.gemini_base_url.rstrip("/")
        self.key = settings.gemini_api_key
        self.timeout = settings.llm_timeout

    def _usage(self, data: dict) -> Usage:
        um = data.get("usageMetadata", {}) if isinstance(data, dict) else {}
        p = int(um.get("promptTokenCount", 0))
        c = int(um.get("candidatesTokenCount", 0))
        return Usage(model=self.model, prompt_tokens=p, completion_tokens=c,
                     total_tokens=int(um.get("totalTokenCount", p + c)))

    @staticmethod
    def _text_of(data: dict) -> str:
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError):
            return ""

    def _payload(self, system: str, user: str, json_mode: bool) -> dict:
        gen = {"temperature": 0.4 if json_mode else 0.7, "maxOutputTokens": _MAX_TOKENS}
        if json_mode:
            gen["responseMimeType"] = "application/json"
        return {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": gen,
        }

    async def text(self, system: str, user: str) -> tuple[str, Usage]:
        data = await _post_with_retry(
            f"{self.base}/models/{self.model}:generateContent",
            self._payload(system, user, False),
            {"x-goog-api-key": self.key}, self.timeout)
        return self._text_of(data), self._usage(data)

    async def json(self, system: str, user: str, fallback) -> tuple[dict, Usage]:
        data = await _post_with_retry(
            f"{self.base}/models/{self.model}:generateContent",
            self._payload(system, user, True),
            {"x-goog-api-key": self.key}, self.timeout)
        decoded = decode_json(self._text_of(data))
        return (decoded if isinstance(decoded, (dict, list)) else fallback), self._usage(data)

    async def stream(self, system: str, user: str):
        url = f"{self.base}/models/{self.model}:streamGenerateContent?alt=sse"
        last: dict = {}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, json=self._payload(system, user, False),
                                         headers={"x-goog-api-key": self.key}) as r:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        body = line[5:].strip()
                        if not body or body == "[DONE]":
                            continue
                        try:
                            data = json.loads(body)
                        except json.JSONDecodeError:
                            continue
                        last = data
                        delta = self._text_of(data)
                        if delta:
                            yield delta, None
        except httpx.HTTPError as e:
            log.error("gemini stream failed: %s", e)
        yield "", self._usage(last)


# ════════════════════════════════ OpenAI ═══════════════════════════════
class OpenAIProvider:
    name = "openai"

    def __init__(self, model: str):
        self.model = model
        self.base = settings.openai_base_url.rstrip("/")
        self.key = settings.openai_api_key
        self.timeout = settings.llm_timeout

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.key}"}

    def _usage(self, data: dict) -> Usage:
        u = data.get("usage", {}) if isinstance(data, dict) else {}
        p = int(u.get("prompt_tokens", 0))
        c = int(u.get("completion_tokens", 0))
        return Usage(model=self.model, prompt_tokens=p, completion_tokens=c,
                     total_tokens=int(u.get("total_tokens", p + c)))

    def _payload(self, system: str, user: str, json_mode: bool) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "temperature": 0.4 if json_mode else 0.7,
            "max_tokens": _MAX_TOKENS,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    @staticmethod
    def _text_of(data: dict) -> str:
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return ""

    async def text(self, system: str, user: str) -> tuple[str, Usage]:
        data = await _post_with_retry(f"{self.base}/chat/completions",
                                      self._payload(system, user, False),
                                      self._headers(), self.timeout)
        return self._text_of(data), self._usage(data)

    async def json(self, system: str, user: str, fallback) -> tuple[dict, Usage]:
        data = await _post_with_retry(f"{self.base}/chat/completions",
                                      self._payload(system, user, True),
                                      self._headers(), self.timeout)
        decoded = decode_json(self._text_of(data))
        return (decoded if isinstance(decoded, (dict, list)) else fallback), self._usage(data)

    async def stream(self, system: str, user: str):
        payload = self._payload(system, user, False)
        payload["stream"] = True
        payload["stream_options"] = {"include_usage": True}
        final = Usage(model=self.model)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", f"{self.base}/chat/completions",
                                         json=payload, headers=self._headers()) as r:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        body = line[5:].strip()
                        if not body or body == "[DONE]":
                            continue
                        try:
                            data = json.loads(body)
                        except json.JSONDecodeError:
                            continue
                        if data.get("usage"):
                            final = self._usage(data)
                        try:
                            delta = data["choices"][0]["delta"].get("content") or ""
                        except (KeyError, IndexError, TypeError):
                            delta = ""
                        if delta:
                            yield delta, None
        except httpx.HTTPError as e:
            log.error("openai stream failed: %s", e)
        yield "", final


# ═══════════════════════════ Anthropic (Claude) ════════════════════════
class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str):
        self.model = model
        self.base = settings.anthropic_base_url.rstrip("/")
        self.key = settings.anthropic_api_key
        self.timeout = settings.llm_timeout

    def _headers(self) -> dict:
        return {"x-api-key": self.key, "anthropic-version": settings.anthropic_version}

    def _usage(self, data: dict) -> Usage:
        u = data.get("usage", {}) if isinstance(data, dict) else {}
        p = int(u.get("input_tokens", 0))
        c = int(u.get("output_tokens", 0))
        return Usage(model=self.model, prompt_tokens=p, completion_tokens=c,
                     total_tokens=p + c)

    def _payload(self, system: str, user: str, json_mode: bool) -> dict:
        if json_mode:
            # Claude has no native JSON response mode — instruct firmly and
            # rely on the tolerant decode_json() parser.
            system += "\nRespond with ONLY a single valid JSON object. No prose, no code fences."
        return {
            "model": self.model,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "temperature": 0.4 if json_mode else 0.7,
            "max_tokens": _MAX_TOKENS,
        }

    @staticmethod
    def _text_of(data: dict) -> str:
        try:
            return "".join(b.get("text", "") for b in data.get("content", [])
                           if b.get("type") == "text")
        except (TypeError, AttributeError):
            return ""

    async def text(self, system: str, user: str) -> tuple[str, Usage]:
        data = await _post_with_retry(f"{self.base}/v1/messages",
                                      self._payload(system, user, False),
                                      self._headers(), self.timeout)
        return self._text_of(data), self._usage(data)

    async def json(self, system: str, user: str, fallback) -> tuple[dict, Usage]:
        data = await _post_with_retry(f"{self.base}/v1/messages",
                                      self._payload(system, user, True),
                                      self._headers(), self.timeout)
        decoded = decode_json(self._text_of(data))
        return (decoded if isinstance(decoded, (dict, list)) else fallback), self._usage(data)

    async def stream(self, system: str, user: str):
        payload = self._payload(system, user, False)
        payload["stream"] = True
        prompt_tokens = 0
        completion_tokens = 0
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", f"{self.base}/v1/messages",
                                         json=payload, headers=self._headers()) as r:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        body = line[5:].strip()
                        if not body:
                            continue
                        try:
                            data = json.loads(body)
                        except json.JSONDecodeError:
                            continue
                        etype = data.get("type")
                        if etype == "message_start":
                            prompt_tokens = int(
                                data.get("message", {}).get("usage", {}).get("input_tokens", 0))
                        elif etype == "content_block_delta":
                            delta = data.get("delta", {}).get("text", "")
                            if delta:
                                yield delta, None
                        elif etype == "message_delta":
                            completion_tokens = int(
                                data.get("usage", {}).get("output_tokens", completion_tokens))
        except httpx.HTTPError as e:
            log.error("anthropic stream failed: %s", e)
        yield "", Usage(model=self.model, prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=prompt_tokens + completion_tokens)


PROVIDERS = {
    "gemini": GeminiProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
}


def make_provider():
    name = settings.resolved_provider
    return PROVIDERS[name](settings.resolved_model)
