"""Single LLM client facade with per-action model routing.

This is the ONLY entry point the rest of the service uses to talk to a model.
The vendor (Gemini / OpenAI / Anthropic) comes from AI_PROVIDER; the model per
call comes from the routing table:

    AI_MODEL              -> single-model switch: used for EVERYTHING when set
    AI_MODEL_CHAT         -> action "chat"        (tutor turns + streaming)
    AI_MODEL_STRUCTURED   -> action "structured"  (assessments, gaps, plans, notes)
    AI_MODEL_GRADE        -> action "grade"       (cheap grading)
    (unset)               -> provider default

Every call returns (output, Usage) — Usage.model reflects the ROUTED model, so
metering and cost accounting stay accurate per action. Mock mode (no key, or
AI_MOCK=true) short-circuits before any provider.
"""
import json as _json
import asyncio
import logging

from .config import settings
from .providers import PROVIDERS
from .schemas import Usage
from . import mock

log = logging.getLogger("ai.llm")


def _estimate_usage(system: str, user: str, output: str, model: str) -> Usage:
    """Rough token estimate for mock mode (≈4 chars/token)."""
    p = (len(system) + len(user)) // 4
    c = len(output) // 4
    return Usage(model=model, prompt_tokens=p, completion_tokens=c,
                 total_tokens=p + c, mock=True)


class LLM:
    def __init__(self) -> None:
        self.mock = settings.is_mock
        self.provider_name = settings.resolved_provider
        self.model = settings.resolved_model          # default-route model
        self._providers: dict[str, object] = {}       # model name -> provider

    def _provider_for(self, action: str):
        """One cached provider instance per routed model."""
        model = settings.model_for(action)
        if model not in self._providers:
            self._providers[model] = PROVIDERS[self.provider_name](model)
        return self._providers[model]

    async def text(self, system: str, user: str, action: str = "chat") -> tuple[str, Usage]:
        if self.mock:
            out = mock.text(system, user)
            return out, _estimate_usage(system, user, out, settings.model_for(action))
        return await self._provider_for(action).text(system, user)

    async def json(self, system: str, user: str, fallback: dict,
                   action: str = "structured", schema=None) -> tuple[dict, Usage]:
        if self.mock:
            out = mock.json(system, user, fallback)
            return out, _estimate_usage(system, user, _json.dumps(out),
                                        settings.model_for(action))
        provider = self._provider_for(action)
        try:
            return await provider.json(system, user, fallback, schema=schema)
        except TypeError:
            # Older provider signature without `schema` — degrade gracefully.
            return await provider.json(system, user, fallback)

    async def stream(self, system: str, user: str, action: str = "chat"):
        """Async generator yielding (delta, final_usage_or_None)."""
        if self.mock:
            out = mock.text(system, user)
            for i, ch in enumerate(out):
                yield ch, None
                if i % 3 == 0:
                    await asyncio.sleep(0.006)
            yield "", _estimate_usage(system, user, out, settings.model_for(action))
            return
        async for delta, usage in self._provider_for(action).stream(system, user):
            yield delta, usage


llm = LLM()
