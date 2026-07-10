"""Ghost Protocol — Content Crew.

Taeglicher Zyklus: Oracle scannt Maerkte -> Publisher erstellt Content
-> Broadcaster versendet Newsletter -> Amplifier postet auf Social Media.

Architecture: BaseAgent-basiert (kein CrewAI).
"""

import asyncio
import logging
from pathlib import Path
from datetime import datetime

from agents.oracle import OracleAgent

logger: logging.Logger = logging.getLogger(__name__)


async def run_daily_briefing() -> dict:
    """Fuehrt das taegliche Oracle Intelligence Briefing aus.

    Pipeline:
    1. Oracle sammelt Marktdaten + News (HTTP-Calls, kein LLM)
    2. Oracle generiert Briefing (1 LLM-Call)
    3. Output wird gespeichert + auf Message Bus gebroadcastet

    Returns:
        {"status": str, "output": str, "cost_usd": float}
    """
    logger.info("Content Crew gestartet — Daily Briefing")

    oracle = OracleAgent()
    result = await oracle.execute("daily_briefing")

    # Output speichern
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    output_path = output_dir / f"briefing_{today}.md"
    output_path.write_text(
        f"# Daily Intelligence Briefing — {today}\n\n{result['output']}",
        encoding="utf-8",
    )

    logger.info("Content Crew abgeschlossen — %s", output_path)
    logger.info("API-Kosten: $%.4f", result["cost_usd"])

    return result


async def run_content_pipeline() -> list[dict]:
    """Fuehrt die volle Content-Pipeline aus.

    Pipeline:
    1. Oracle -> Briefing
    2. Publisher -> Blog-Artikel (TODO: Sprint 2)
    3. Broadcaster -> Newsletter (TODO: Sprint 2)
    4. Amplifier -> Social Posts (TODO: Sprint 2)

    Returns:
        Liste aller Pipeline-Ergebnisse
    """
    results = []

    # Step 1: Oracle Briefing
    briefing = await run_daily_briefing()
    results.append({"agent": "oracle", **briefing})

    # Step 2-4: Noch nicht implementiert
    # TODO Sprint 2: Publisher, Broadcaster, Amplifier integrieren

    return results


def run_daily_content() -> str:
    """Synchroner Wrapper fuer Cron-Jobs und CLI.

    Returns:
        Das generierte Briefing als String.
    """
    result = asyncio.run(run_daily_briefing())
    return result["output"]
