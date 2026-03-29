"""Ghost Protocol — Monitor Tools.

Tools für System-Überwachung und Alerting.

TODO Sprint 2:
- Telegram Alert Tool (aus health_check.py extrahieren)
- Supabase Logging Tool
- API Budget Tracker
- Uptime Monitor Integration
"""

import logging

import httpx

from agents.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TIMEOUT_SECONDS

logger: logging.Logger = logging.getLogger(__name__)


def send_telegram_alert(message: str) -> bool:
    """Sendet eine Alert-Nachricht via Telegram Bot.

    Args:
        message: Die Nachricht (Markdown-Format unterstützt).

    Returns:
        True wenn erfolgreich, False wenn fehlgeschlagen.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("Telegram nicht konfiguriert — Alert nur im Log: %s", message)
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        r = httpx.post(
            url,
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message,
                "parse_mode": "Markdown",
            },
            timeout=TIMEOUT_SECONDS,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        logger.error("Telegram-Alert fehlgeschlagen: %s", e)
        return False
