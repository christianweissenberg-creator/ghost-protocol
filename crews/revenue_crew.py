"""Ghost Protocol — Revenue Crew.

Woechentlicher Zyklus: Researcher identifiziert Produkte -> Merchant
erstellt/listet auf Gumroad -> Outreach verteilt in Communities
-> Optimizer verbessert Conversions.

Architecture: BaseAgent-basiert (kein CrewAI).
"""

import asyncio
import logging
from pathlib import Path
from datetime import datetime

from agents.researcher import ResearcherAgent

logger: logging.Logger = logging.getLogger(__name__)


async def run_product_research(niche: str = "krypto") -> dict:
    """Fuehrt die woechentliche Product Research aus.

    Pipeline:
    1. Researcher scannt Gumroad, Etsy, Reddit, DACH (HTTP-Calls)
    2. Researcher analysiert Daten + generiert Report (1 LLM-Call)
    3. Output wird gespeichert + an MerchantAgent gebroadcastet

    Args:
        niche: Zu untersuchende Nische

    Returns:
        {"status": str, "output": str, "cost_usd": float}
    """
    logger.info("Revenue Crew gestartet — Product Research '%s'", niche)

    researcher = ResearcherAgent()
    result = await researcher.execute("product_research", niche=niche)

    # Output speichern
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    output_path = output_dir / f"product_research_{today}.md"
    output_path.write_text(
        f"# Product Research Report — {today}\n## Nische: {niche}\n\n{result['output']}",
        encoding="utf-8",
    )

    logger.info("Revenue Crew abgeschlossen — %s", output_path)
    logger.info("API-Kosten: $%.4f", result["cost_usd"])

    return result


async def run_revenue_pipeline(niche: str = "krypto") -> list[dict]:
    """Fuehrt die volle Revenue-Pipeline aus.

    Pipeline:
    1. Researcher -> Product Research Report
    2. Merchant -> Produkt-Erstellung (TODO: Sprint 2)
    3. Outreach -> Community-Distribution (TODO: Sprint 3)

    Returns:
        Liste aller Pipeline-Ergebnisse
    """
    results = []

    # Step 1: Research
    research = await run_product_research(niche)
    results.append({"agent": "researcher", **research})

    # Step 2-3: Noch nicht implementiert
    # TODO Sprint 2: Merchant, Outreach integrieren

    return results


def run_research_sync(niche: str = "krypto") -> str:
    """Synchroner Wrapper fuer Cron-Jobs und CLI.

    Returns:
        Der Research-Report als String.
    """
    result = asyncio.run(run_product_research(niche))
    return result["output"]
