"""Ghost Protocol — Zentrale Konfiguration.

Lädt alle Environment-Variablen, definiert LLM-Modelle, API-Budget-Limits,
Revenue-Channel-Prioritäten und rechtlich verpflichtende Disclaimer.
Alle Secrets werden aus .env geladen — NIEMALS hardcoden.
"""

import os
import logging
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger: logging.Logger = logging.getLogger(__name__)

# === LLM Config ===
LLM_COMPLEX: str = os.getenv("MODEL_COMPLEX", "claude-sonnet-5")
LLM_SIMPLE: str = os.getenv("MODEL_SIMPLE", "claude-haiku-4-5-20251001")
ANTHROPIC_API_KEY: Optional[str] = os.getenv("ANTHROPIC_API_KEY")

# === Multi-Model Provider Keys ===
PERPLEXITY_API_KEY: Optional[str] = os.getenv("PERPLEXITY_API_KEY")
GOOGLE_AI_API_KEY: Optional[str] = os.getenv("GOOGLE_AI_API_KEY")
DASHSCOPE_API_KEY: Optional[str] = os.getenv("DASHSCOPE_API_KEY")
DASHSCOPE_BASE_URL: str = os.getenv(
    "DASHSCOPE_BASE_URL",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

# === API Keys ===
SERPER_API_KEY: Optional[str] = os.getenv("SERPER_API_KEY")
TELEGRAM_BOT_TOKEN: Optional[str] = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID: Optional[str] = os.getenv("TELEGRAM_CHAT_ID")
SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
SUPABASE_KEY: Optional[str] = os.getenv("SUPABASE_KEY")

# === Agent Defaults ===
MAX_RETRIES: int = 3
TIMEOUT_SECONDS: int = 120
MAX_TOKENS_PER_TASK: int = 4000
DAILY_API_BUDGET_USD: float = 3.00

# === Revenue Channel Config ===
CHANNELS: dict[str, dict[str, int | str]] = {
    "intelligence_reports": {"priority": 1, "status": "active"},
    "digital_products":     {"priority": 2, "status": "active"},
    "newsletter":           {"priority": 3, "status": "active"},
    "affiliate":            {"priority": 4, "status": "active"},
    "seo_blog":             {"priority": 5, "status": "active"},
    "trading_bot":          {"priority": 6, "status": "standby"},
    "signal_community":     {"priority": 7, "status": "planned"},
}

# === Guard Rails ===
TRADING_MAX_DRAWDOWN_PCT: int = 20
TRADING_MAX_POSITION_PCT: int = 30
CONTENT_REQUIRES_DISCLAIMER: bool = True

DISCLAIMER_DE: str = (
    "⚠️ Keine Anlageberatung | Dieser Inhalt dient ausschließlich "
    "Informationszwecken und stellt keine Anlageberatung, Empfehlung "
    "oder Aufforderung zum Kauf oder Verkauf von Finanzinstrumenten dar. "
    "Kryptowährungen sind hochriskant — investiere nur Kapital, dessen "
    "Totalverlust du verkraften kannst. Affiliate-Links sind gekennzeichnet (*)."
)

DISCLAIMER_EN: str = (
    "⚠️ Not financial advice. This content is for informational "
    "purposes only. Cryptocurrencies are high-risk assets. "
    "Only invest what you can afford to lose."
)

# === Health Check Endpoints ===
HEALTH_CHECK_ENDPOINTS: dict[str, str] = {
    "CoinGecko": "https://api.coingecko.com/api/v3/ping",
    "Serper": "https://google.serper.dev/status",
}


def validate_config() -> list[str]:
    """Prüft ob alle kritischen Konfigurationswerte gesetzt sind.

    Returns:
        Liste fehlender Keys. Leer = alles OK.
    """
    missing: list[str] = []
    if not ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if not SERPER_API_KEY:
        missing.append("SERPER_API_KEY")
    if missing:
        logger.warning("Fehlende Config-Keys: %s", ", ".join(missing))
    return missing


def validate_providers() -> dict[str, bool]:
    """Prüft welche LLM-Provider verfügbar sind.

    Returns:
        Dict mit Provider-Name → verfügbar (True/False)
    """
    status = {
        "anthropic": bool(ANTHROPIC_API_KEY),
        "perplexity": bool(PERPLEXITY_API_KEY),
        "gemini": bool(GOOGLE_AI_API_KEY),
        "qwen": bool(DASHSCOPE_API_KEY),
    }
    available = [k for k, v in status.items() if v]
    unavailable = [k for k, v in status.items() if not v]
    if available:
        logger.info("LLM-Provider verfügbar: %s", ", ".join(available))
    if unavailable:
        logger.info("LLM-Provider fehlen: %s (Fallback auf Anthropic)", ", ".join(unavailable))
    return status
