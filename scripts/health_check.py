"""Ghost Protocol — Guardian Health Check.

Prüft alle externen Services auf Erreichbarkeit und alertet via Telegram
bei Ausfällen. Wird alle 15 Minuten via Cron/GitHub Actions ausgeführt.

Usage:
    python scripts/health_check.py
"""

import logging
import os
import sys
from datetime import datetime

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.config import (
    HEALTH_CHECK_ENDPOINTS,
    SERPER_API_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TIMEOUT_SECONDS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger: logging.Logger = logging.getLogger(__name__)


def send_telegram(message: str) -> None:
    """Sendet Alert-Nachricht via Telegram Bot.

    Falls Telegram-Credentials fehlen, wird auf stdout geloggt.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("[ALERT - kein Telegram] %s", message)
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        httpx.post(
            url,
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message,
                "parse_mode": "Markdown",
            },
            timeout=TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.error("Telegram-Alert fehlgeschlagen: %s", e)


def check_api(name: str, url: str, timeout: int = 10) -> dict[str, str]:
    """Prüft einen externen Service auf Erreichbarkeit.

    Returns:
        Dict mit name, status ('ok'/'error'/'skip'), und status_code.
    """
    try:
        r = httpx.get(url, timeout=timeout)
        status = "ok" if r.status_code < 400 else "error"
        return {"name": name, "status": status, "code": str(r.status_code)}
    except httpx.TimeoutException:
        logger.error("Timeout bei %s", name)
        return {"name": name, "status": "error", "code": "timeout"}
    except Exception as e:
        logger.error("Fehler bei %s: %s", name, e)
        return {"name": name, "status": "error", "code": str(e)}


def main() -> None:
    """Führt alle Health Checks aus und alertet bei Fehlern."""
    checks: list[dict[str, str]] = []

    # CoinGecko — immer prüfen
    checks.append(check_api("CoinGecko", HEALTH_CHECK_ENDPOINTS["CoinGecko"]))

    # Serper — nur wenn API Key vorhanden
    if SERPER_API_KEY:
        checks.append(check_api("Serper", HEALTH_CHECK_ENDPOINTS["Serper"]))
    else:
        checks.append({"name": "Serper", "status": "skip", "code": "no key"})

    errors = [c for c in checks if c["status"] == "error"]
    now: str = datetime.now().strftime("%H:%M %d.%m.%Y")

    if errors:
        msg = f"🚨 *Ghost Protocol Alert* — {now}\n\n"
        for e in errors:
            msg += f"❌ {e['name']}: {e['code']}\n"
        send_telegram(msg)
        logger.error("Health Check FAILED — %d/%d services down", len(errors), len(checks))
    else:
        ok_count = len([c for c in checks if c["status"] == "ok"])
        logger.info("[%s] Health OK — %d/%d services up", now, ok_count, len(checks))


if __name__ == "__main__":
    main()
