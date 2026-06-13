"""Runtime configuration for the AI service.

All values come from environment variables so the same image runs in local,
docker-compose, and production.

Provider selection (the multi-provider layer):
  AI_PROVIDER = auto | gemini | openai | anthropic
  - "auto" picks the first provider that has an API key set, in the order
    gemini -> openai -> anthropic.

Model routing (per-action, with a single-model override):
  AI_MODEL             -> SINGLE-MODEL SWITCH: when set, this model is used for
                          EVERYTHING (all per-action settings are ignored).
  AI_MODEL_CHAT        -> tutor chat turns + streaming (conversational quality)
  AI_MODEL_STRUCTURED  -> JSON roles: assessment generation, gap analysis,
                          study plans, notes (structured-output reliability)
  AI_MODEL_GRADE       -> answer grading (cheap + fast)
  Unset routes fall back to the provider's default model.

  Precedence per action:  AI_MODEL  >  AI_MODEL_<ACTION>  >  provider default
"""
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-5",
}

# Action groups used by the router. Role endpoints map onto these.
ACTIONS = ("chat", "structured", "grade")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Provider selection ─────────────────────────────────────────────
    ai_provider: str = "auto"          # auto | gemini | openai | anthropic
    ai_model: str | None = None        # SINGLE-MODEL switch (overrides routing)

    # ── Per-action model routing (ignored when AI_MODEL is set) ───────
    ai_model_chat: str | None = None
    ai_model_structured: str | None = None
    ai_model_grade: str | None = None

    # ── Gemini ─────────────────────────────────────────────────────────
    gemini_api_key: str | None = None
    gemini_model: str | None = None    # legacy alias for AI_MODEL on gemini
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout: int = 45

    # ── OpenAI ─────────────────────────────────────────────────────────
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"

    # ── Anthropic (Claude) ─────────────────────────────────────────────
    anthropic_api_key: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_version: str = "2023-06-01"

    # Shared request timeout for all providers.
    llm_timeout: int = 60

    # When true (or no key for the resolved provider) the service returns
    # deterministic mock output so the whole flow runs with zero external calls.
    ai_mock: bool = False

    # ── Vector DB (Qdrant) for RAG ─────────────────────────────────────
    qdrant_url: str | None = None      # e.g. http://qdrant:6333
    qdrant_collection: str = "curriculum"
    qdrant_doc_collection: str = "documents"   # uploaded study-note chunks
    qdrant_event_collection: str = "events"    # one embedding per tracked action
    rag_top_k: int = 5

    # ── Neo4j knowledge graph (GraphRAG "AI mind"; no vectors stored) ──
    neo4j_uri: str | None = None       # e.g. bolt://neo4j:7687 (blank = graph off)
    neo4j_user: str = "neo4j"
    neo4j_password: str = "tutopass"

    # Embedding backend: auto | local | gemini | openai | mock
    #   "auto" prefers LOCAL fastembed (free, no API key, no external call),
    #   then gemini/openai if a usable key exists, then mock.
    embed_backend: str = "auto"
    embed_local_model: str = "BAAI/bge-small-en-v1.5"  # 384-dim, runs in-process

    # Shared secret so only Laravel can call this service (simple bearer).
    internal_api_key: str | None = None

    # ------------------------------------------------------------------
    def key_for(self, provider: str) -> str | None:
        return {
            "gemini": self.gemini_api_key,
            "openai": self.openai_api_key,
            "anthropic": self.anthropic_api_key,
        }.get(provider)

    @property
    def resolved_provider(self) -> str:
        if self.ai_provider in ("gemini", "openai", "anthropic"):
            return self.ai_provider
        for p in ("gemini", "openai", "anthropic"):  # auto-detect by key
            if self.key_for(p):
                return p
        return "gemini"  # mock default

    @property
    def resolved_model(self) -> str:
        """The default model (used when no per-action route applies)."""
        if self.ai_model:
            return self.ai_model
        if self.resolved_provider == "gemini" and self.gemini_model:
            return self.gemini_model  # legacy env compatibility
        return DEFAULT_MODELS[self.resolved_provider]

    def model_for(self, action: str) -> str:
        """Resolve the model for an action group (chat | structured | grade).

        AI_MODEL (single-model switch) beats everything; otherwise the
        per-action env; otherwise the provider default.
        """
        if self.ai_model:
            return self.ai_model
        per_action = {
            "chat": self.ai_model_chat,
            "structured": self.ai_model_structured,
            "grade": self.ai_model_grade,
        }.get(action)
        return per_action or self.resolved_model

    @property
    def routing_table(self) -> dict:
        return {a: self.model_for(a) for a in ACTIONS}

    @property
    def is_mock(self) -> bool:
        return self.ai_mock or not self.key_for(self.resolved_provider)


settings = Settings()
