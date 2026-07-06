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
import os

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "google": "gemini-2.5-flash",   # google-genai SDK (ADC or key; supports Vertex)
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-5",
}

# Action groups used by the router. Role endpoints map onto these.
ACTIONS = ("chat", "structured", "grade")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Provider selection ─────────────────────────────────────────────
    ai_provider: str = "auto"          # auto | gemini | google | openai | anthropic
    ai_model: str | None = None        # SINGLE-MODEL switch (overrides routing)

    # ── Per-action model routing (ignored when AI_MODEL is set) ───────
    ai_model_chat: str | None = None
    ai_model_structured: str | None = None
    ai_model_grade: str | None = None
    # Vision-language model (OpenAI-compatible / OpenRouter) for reading
    # uploaded diagrams, figures and handwriting. Falls back to tesseract OCR.
    ai_model_vision: str | None = None

    # ── Gemini (legacy REST, API key) ──────────────────────────────────
    gemini_api_key: str | None = None
    gemini_model: str | None = None    # legacy alias for AI_MODEL on gemini
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout: int = 45

    # ── Google Gen AI SDK (AI_PROVIDER=google) ─────────────────────────
    # Uses the `google-genai` client, which auto-detects auth from the env:
    # GEMINI_API_KEY/GOOGLE_API_KEY, or ADC (GOOGLE_APPLICATION_CREDENTIALS),
    # and Vertex AI when GOOGLE_GENAI_USE_VERTEXAI=true (+ project/location).
    google_api_key: str | None = None
    google_genai_use_vertexai: bool = False
    google_cloud_project: str | None = None
    google_cloud_location: str | None = None
    gemini_vision_model: str | None = None   # VLM model for reading images
    # Gemini IMAGE model for the "idealised render" (redraws a student's isolated
    # hand-drawing into a clean, labelled textbook illustration). Overridable via
    # GEMINI_IMAGE_MODEL if Google renames the image model.
    gemini_image_model: str = "gemini-2.5-flash-image"
    # Force the image-reading backend: 'gemini' | 'openai' | None (auto).
    # Auto prefers Gemini whenever a Google/Gemini key is configured, since the
    # small OpenRouter free vision models can't emit valid structured UVSS.
    vision_backend: str | None = None
    # Max output tokens for a vision call. Must be VERY generous: Gemini 2.5 is a
    # thinking model whose reasoning tokens share this budget, and a full UVSS
    # reconstruction (many SVG stroke_path strings + labels + hotspots) is large.
    # A low cap let thinking eat the budget and truncated the JSON mid-object, so
    # no sketch was produced. This must fit BOTH the thinking AND the full JSON.
    vision_max_tokens: int = 32768

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

    # ── Shared upload volume (textbook ingest) ────────────────────────
    # Same path the Laravel container mounts its storage/app at, so this
    # service can read uploaded PDFs in place (no 200 MB HTTP transfer) and
    # write rendered page images back where Laravel can serve them.
    upload_root: str = "/app/storage/app"
    # Page rasterisation DPI for the vision model (higher = sharper, bigger).
    pdf_render_dpi: int = 150
    # Polite pause (seconds) between per-page VLM calls so a free-tier model
    # isn't hammered into rate limits during an 800-page ingest.
    pdf_page_pause: float = 1.2

    # ── Multimodal diagram ingest (OpenCV → PaddleOCR → Gemini → UVSS) ──
    # Dockerized PaddleOCR microservice for label OCR (blank = OCR disabled,
    # the pipeline falls back to tesseract / the VLM's own text reading).
    paddle_ocr_url: str | None = None        # e.g. http://paddleocr:8002
    paddle_ocr_lang: str = "en"
    # Most diagrams to parse out of a single uploaded note (guards cost/time).
    diagram_max_regions: int = 6
    # Below this VLM-reported confidence we DROP the UVSS schema and keep the
    # node as an image-only fallback (plan §4.4); still fully retrievable. Kept
    # deliberately low: hand-drawn figures rarely score high, and the Visual
    # Context Viewer offers a "Your drawing" toggle, so a simplified rebuilt
    # sketch at moderate confidence is preferable to no reconstruction at all.
    diagram_min_confidence: float = 0.4
    # Smallest region (fraction of page area) accepted as a diagram candidate.
    diagram_min_area_frac: float = 0.015
    # Polygon isolation (Diagram Isolation upgrade): trace the diagram's true
    # contour (VLM segmentation → OpenCV fallback), render the transparent
    # `…_isolated.png` asset and OCR the page-minus-diagram remainder into the
    # anchor text. Disable to fall back to rectangular crops only.
    diagram_isolation_enabled: bool = True
    # Idealised render: after isolation, use a Gemini IMAGE model to redraw the
    # diagram as a clean, labelled textbook illustration (the plan's "normalized
    # render"). This is a generative image call (extra credits per diagram), so
    # it's gated — set false to skip and rely on the UVSS vector sketch only.
    diagram_illustrate_enabled: bool = True
    # UVSS interactive reconstruction. OFF by default: the interactive vector
    # sketch requires a large (16k+ token) structured VLM call per diagram, and
    # the illustration render is the preferred output. Leave off to save tokens
    # (only a cheap classify/label call runs); set true to also build the
    # interactive stroke-by-stroke sketch.
    diagram_reconstruct_enabled: bool = False

    # ------------------------------------------------------------------
    def key_for(self, provider: str) -> str | None:
        return {
            "gemini": self.gemini_api_key,
            "google": self.gemini_api_key or self.google_api_key,
            "openai": self.openai_api_key,
            "anthropic": self.anthropic_api_key,
        }.get(provider)

    @property
    def google_configured(self) -> bool:
        """The google-genai SDK has usable auth (API key, ADC file, or Vertex)."""
        return bool(self.gemini_api_key or self.google_api_key
                    or self.google_genai_use_vertexai
                    or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))

    @property
    def resolved_provider(self) -> str:
        if self.ai_provider in ("gemini", "google", "openai", "anthropic"):
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
        if self.ai_mock:
            return True
        if self.resolved_provider == "google":
            return not self.google_configured   # ADC has no "key" but is live
        return not self.key_for(self.resolved_provider)

    # ── Vision (image reading) ─────────────────────────────────────────
    @property
    def vision_model(self) -> str:
        """The VLM used to read uploaded images/diagrams (OpenRouter default)."""
        return self.ai_model_vision or "nvidia/nemotron-nano-12b-v2-vl:free"

    @property
    def vision_provider(self) -> str:
        """Which backend reads images: 'gemini' (google-genai SDK) or 'openai'
        (OpenAI-compatible / OpenRouter).

        Prefer the Gemini VLM (gemini-2.5-flash) for vision whenever a Google/
        Gemini key or ADC is configured — it reads handwriting AND emits valid
        structured UVSS far better than the small free OpenRouter vision models,
        which is exactly what diagram reconstruction needs. We deliberately do
        NOT treat AI_MODEL_VISION as an opt-out here, because docker-compose ships
        a non-empty default for it; to force the OpenAI-compatible VLM even with a
        Google key present, set VISION_BACKEND=openai."""
        if (self.vision_backend or "").lower() == "openai":
            return "openai"
        if (self.vision_backend or "").lower() == "gemini":
            return "gemini"
        if self.resolved_provider == "google" or self.google_configured:
            return "gemini"
        return "openai"

    @property
    def google_vision_model(self) -> str:
        return self.gemini_vision_model or "gemini-2.5-flash"

    @property
    def vision_enabled(self) -> bool:
        """Can we read images with a VLM at all? Else -> tesseract OCR."""
        if self.ai_mock:
            return False
        if self.vision_provider == "gemini":
            return self.google_configured
        return bool(self.openai_api_key) and bool(self.vision_model)


settings = Settings()
