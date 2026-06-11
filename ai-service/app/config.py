"""Service configuration — all via environment variables."""
import os

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_BASE_URL = os.environ.get(
    "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
).rstrip("/")
GEMINI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT", "60"))

# Mock mode: deterministic responses, zero external calls. Auto-on without a key.
MOCK = os.environ.get("GEMINI_MOCK", "").lower() in ("1", "true", "yes") or not GEMINI_API_KEY
