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


def pydantic_to_gemini_schema(model) -> dict:
    """Converts a Pydantic model into the OpenAPI schema structure expected by
    Gemini's REST API (uppercase type names, no $defs)."""
    if not model:
        return {}
    schema = model.model_json_schema()

    type_mapping = {
        "string": "STRING", "integer": "INTEGER", "number": "NUMBER",
        "boolean": "BOOLEAN", "array": "ARRAY", "object": "OBJECT",
    }

    def convert_prop(prop_schema: dict) -> dict:
        t = prop_schema.get("type", "string")
        gemini_type = type_mapping.get(t, "STRING")
        out = {"type": gemini_type}
        if gemini_type == "ARRAY" and "items" in prop_schema:
            out["items"] = convert_prop(prop_schema["items"])
        elif gemini_type == "OBJECT" and "properties" in prop_schema:
            out["properties"] = {k: convert_prop(v) for k, v in prop_schema["properties"].items()}
            if "required" in prop_schema:
                out["required"] = prop_schema["required"]
        elif "anyOf" in prop_schema:
            types = [x.get("type") for x in prop_schema["anyOf"] if x.get("type") != "null"]
            if types:
                out["type"] = type_mapping.get(types[0], "STRING")
        return out

    return convert_prop(schema)


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


def _parse_ok_body(r: httpx.Response) -> dict | None:
    """Parse a 200 response body into the provider's JSON envelope.

    Free OpenRouter endpoints often return 200 with a body that is NOT clean
    JSON: leading ``: OPENROUTER PROCESSING`` keep-alive comments (sent to dodge
    proxy timeouts while the model warms up) followed by the real object, or an
    SSE ``data:`` stream. Plain ``r.json()`` raises JSONDecodeError on those and
    — since it isn't an httpx error — escapes the retry loop and 500s the
    endpoint. Returns the envelope dict, or None if the body isn't usable yet
    (so the caller can retry).
    """
    # Fast path: a clean JSON body.
    try:
        return r.json()
    except (json.JSONDecodeError, ValueError):
        pass

    text = (r.text or "").strip()
    if not text:
        return None

    # SSE stream: aggregate the last complete chat-completion object from the
    # data: frames (ignores ': ...' comment pings and the [DONE] sentinel).
    salvaged = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            body = line[5:].strip()
            if body and body != "[DONE]":
                try:
                    salvaged = json.loads(body)
                except (json.JSONDecodeError, ValueError):
                    continue
    if isinstance(salvaged, dict):
        return salvaged

    # Comment-prefixed single object (": OPENROUTER PROCESSING\n\n{...}"):
    # grab the first {...}/[...] block. Never raises.
    extracted = decode_json(text)
    return extracted if isinstance(extracted, dict) else None


async def _post_with_retry(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                r = await client.post(url, json=payload, headers=headers)
                if r.status_code == 200:
                    parsed = _parse_ok_body(r)
                    if parsed is not None:
                        return parsed
                    # 200 but body not yet usable (keep-alive pings / empty).
                    # Treat as transient: a retry usually returns real JSON.
                    if attempt < _MAX_ATTEMPTS:
                        wait = _BACKOFF_5XX[attempt - 1]
                        log.warning("LLM 200 with unparseable body (attempt %s/%s) — "
                                    "retrying in %.1fs; head=%r",
                                    attempt, _MAX_ATTEMPTS, wait, r.text[:120])
                        await asyncio.sleep(wait)
                        continue
                    log.warning("LLM 200 but body unparseable after %s attempts: %r",
                                _MAX_ATTEMPTS, r.text[:300])
                    return {}
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

    def _payload(self, system: str, user: str, json_mode: bool, schema=None) -> dict:
        gen = {"temperature": 0.4 if json_mode else 0.7, "maxOutputTokens": _MAX_TOKENS}
        if json_mode:
            gen["responseMimeType"] = "application/json"
            if schema is not None:
                gen["responseSchema"] = pydantic_to_gemini_schema(schema)
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

    async def json(self, system: str, user: str, fallback, schema=None) -> tuple[dict, Usage]:
        data = await _post_with_retry(
            f"{self.base}/models/{self.model}:generateContent",
            self._payload(system, user, True, schema),
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

    def _payload(self, system: str, user: str, json_mode: bool, schema=None) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "temperature": 0.4 if json_mode else 0.7,
            "max_tokens": _MAX_TOKENS,
        }
        if json_mode:
            if schema is not None:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema.__name__ if hasattr(schema, "__name__") else "ResponseSchema",
                        "schema": schema.model_json_schema(),
                        "strict": True,
                    },
                }
            else:
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

    async def json(self, system: str, user: str, fallback, schema=None) -> tuple[dict, Usage]:
        data = await _post_with_retry(f"{self.base}/chat/completions",
                                      self._payload(system, user, True, schema),
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

    async def json(self, system: str, user: str, fallback, schema=None) -> tuple[dict, Usage]:
        # Anthropic has no native response_schema; the firm JSON instruction in
        # _payload + tolerant decode_json() handle it. `schema` is accepted for a
        # uniform interface and ignored here.
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


# ═══════════════════ Google Gen AI SDK (Gemini / Vertex) ═══════════════
class GoogleGenAIProvider:
    """Gemini via the official `google-genai` SDK. Auth is auto-detected from
    the environment: GEMINI_API_KEY/GOOGLE_API_KEY, or ADC, or Vertex AI when
    GOOGLE_GENAI_USE_VERTEXAI=true. Selected with AI_PROVIDER=google."""
    name = "google"

    def __init__(self, model: str):
        self.model = model
        self._client = None

    def _client_(self):
        if self._client is None:
            from google import genai  # lazy: only imported when this provider is used
            self._client = genai.Client()
        return self._client

    def _config(self, system: str, json_mode: bool, schema=None):
        from google.genai import types
        kw = {"temperature": 0.4 if json_mode else 0.7, "max_output_tokens": _MAX_TOKENS}
        if system:
            kw["system_instruction"] = system
        if json_mode:
            kw["response_mime_type"] = "application/json"
            if schema is not None:
                kw["response_schema"] = schema
        return types.GenerateContentConfig(**kw)

    def _usage(self, resp) -> Usage:
        um = getattr(resp, "usage_metadata", None)
        p = int(getattr(um, "prompt_token_count", 0) or 0)
        c = int(getattr(um, "candidates_token_count", 0) or 0)
        return Usage(model=self.model, prompt_tokens=p, completion_tokens=c,
                     total_tokens=int(getattr(um, "total_token_count", 0) or (p + c)))

    async def text(self, system: str, user: str) -> tuple[str, Usage]:
        try:
            resp = await self._client_().aio.models.generate_content(
                model=self.model, contents=user, config=self._config(system, False))
            return (resp.text or ""), self._usage(resp)
        except Exception as e:  # noqa: BLE001
            log.error("google text failed: %s", e)
            return "", Usage(model=self.model)

    async def json(self, system: str, user: str, fallback, schema=None) -> tuple[dict, Usage]:
        try:
            resp = await self._client_().aio.models.generate_content(
                model=self.model, contents=user, config=self._config(system, True, schema))
            decoded = decode_json(resp.text or "")
            return (decoded if isinstance(decoded, (dict, list)) else fallback), self._usage(resp)
        except Exception as e:  # noqa: BLE001
            log.error("google json failed: %s", e)
            return fallback, Usage(model=self.model)

    async def stream(self, system: str, user: str):
        try:
            it = await self._client_().aio.models.generate_content_stream(
                model=self.model, contents=user, config=self._config(system, False))
            last = None
            async for chunk in it:
                last = chunk
                delta = getattr(chunk, "text", "") or ""
                if delta:
                    yield delta, None
            yield "", (self._usage(last) if last is not None else Usage(model=self.model))
            return
        except Exception as e:  # noqa: BLE001
            log.warning("google stream failed (%s); falling back to non-stream", e)
        text, usage = await self.text(system, user)
        if text:
            yield text, None
        yield "", usage


async def read_image_genai(image_b64: str, mime: str | None, instruction: str) -> tuple[str, Usage]:
    """Read an image with Gemini via the google-genai SDK (AI_PROVIDER=google).
    Returns (text, Usage); empty text on failure so the caller falls back to OCR."""
    import base64 as _b64
    model = settings.google_vision_model
    try:
        from google import genai
        from google.genai import types
        client = genai.Client()
        img = types.Part.from_bytes(data=_b64.b64decode(image_b64), mime_type=mime or "image/jpeg")
        resp = await client.aio.models.generate_content(
            model=model, contents=[instruction, img],
            config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=1800))
        um = getattr(resp, "usage_metadata", None)
        p = int(getattr(um, "prompt_token_count", 0) or 0)
        c = int(getattr(um, "candidates_token_count", 0) or 0)
        return (resp.text or ""), Usage(model=model, prompt_tokens=p, completion_tokens=c,
                                        total_tokens=int(getattr(um, "total_token_count", 0) or (p + c)))
    except Exception as e:  # noqa: BLE001
        log.warning("gemini vision read failed: %s", e)
        return "", Usage(model="none")


async def read_image(image_b64: str, mime: str | None, instruction: str) -> tuple[str, Usage]:
    """Read an image with a vision-language model via the OpenAI-compatible
    endpoint (OpenRouter). Transcribes text AND describes diagrams/figures.
    Returns (text, Usage); empty text on failure so the caller can fall back to
    tesseract OCR."""
    model = settings.vision_model
    key = settings.openai_api_key
    if not key or not model:
        return "", Usage(model="none")
    base = settings.openai_base_url.rstrip("/")
    data_url = f"data:{mime or 'image/jpeg'};base64,{image_b64}"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": instruction},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}],
        "temperature": 0.2,
        "max_tokens": 1800,
    }
    data = await _post_with_retry(f"{base}/chat/completions", payload,
                                  {"Authorization": f"Bearer {key}"}, settings.llm_timeout)
    text = OpenAIProvider._text_of(data)
    u = data.get("usage", {}) if isinstance(data, dict) else {}
    p, c = int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0))
    return text, Usage(model=model, prompt_tokens=p, completion_tokens=c,
                       total_tokens=int(u.get("total_tokens", p + c)))


PROVIDERS = {
    "gemini": GeminiProvider,
    "google": GoogleGenAIProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
}


def make_provider():
    name = settings.resolved_provider
    return PROVIDERS[name](settings.resolved_model)
