"""Ghost Protocol — Revenue Crew.

Wöchentlicher Zyklus: Researcher identifiziert Produkte → Merchant
erstellt/listet auf Gumroad → Outreach verteilt in Communities
→ Optimizer verbessert Conversions.

Status: Sprint 1 — Researcher implementiert, weitere Agenten folgen.
"""

import logging

from crewai import Crew, Process

from agents.researcher import research_crew, research_task, researcher

logger: logging.Logger = logging.getLogger(__name__)


def run_product_research() -> str:
    """Führt die wöchentliche Product Research aus.

    Returns:
        Der Research-Report als String.
    """
    logger.info("Revenue Crew gestartet — Product Research")
    result = research_crew.kickoff()
    logger.info("Revenue Crew abgeschlossen")
    return str(result)
