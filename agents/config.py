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
LLM_COMPLEX: str = os.getenv("MODEL_COMPLEX", "claude-sonnet-4-20250514")
LLM_SIMPLE: str = os.getenv("MODEL_SIMPLE", "claude-haiku-4-5-20251001")
ANTHROPIC_API_KEY: Optional[str] = os.getenv("ANTHROPIC_API_KEY")

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
