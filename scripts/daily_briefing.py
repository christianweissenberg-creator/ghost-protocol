"""Ghost Protocol — Daily Briefing Runner.

Wird via Cron, GitHub Actions oder manuell getriggert.
Erstellt das taegliche Intelligence Briefing via OracleAgent.

Usage:
    python scripts/daily_briefing.py
    python -m scripts.daily_briefing
"""

import asyncio
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Pfad-Setup fuer Imports aus dem Root-Verzeichnis
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.oracle import OracleAgent
from tools.monitor_tools import send_telegram_alert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger: logging.Logger = logging.getLogger(__name__)


async def run_briefing() -> str:
    """Fuehrt das Daily Briefing aus und speichert das Ergebnis."""
    logger.info("Daily Intelligence Briefing gestartet")

    oracle = OracleAgent()

    try:
        result = await oracle.execute("daily_briefing")
    except Exception as e:
        logger.error("Oracle Briefing fehlgeschlagen: %s", e)
        send_telegram_alert(f"Oracle Briefing FEHLER: {e}")
        raise

    briefing = result["output"]

    # Output speichern
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    output_path = output_dir / f"briefing_{date_str}.md"

    output_path.write_text(
        f"# Daily Intelligence Briefing — {date_str}\n\n{briefing}",
        encoding="utf-8",
    )
    logger.info("Briefing gespeichert: %s", output_path)
    logger.info("API-Kosten: $%.4f", result["cost_usd"])

    # Telegram-Notification
    send_telegram_alert(
        f"Daily Briefing {date_str} erstellt\n"
        f"API-Kosten: ${result['cost_usd']:.4f}"
    )

    return briefing


def main() -> None:
    asyncio.run(run_briefing())


if __name__ == "__main__":
    main()
