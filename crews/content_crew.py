"""Ghost Protocol — Content Crew.

Täglicher Zyklus: Oracle scannt Märkte → Publisher erstellt Content
→ Broadcaster versendet Newsletter → Amplifier postet auf Social Media.

Status: Sprint 1 — Oracle implementiert, weitere Agenten folgen.
"""

import logging

from crewai import Crew, Process

from agents.oracle import create_daily_briefing_task, oracle

logger: logging.Logger = logging.getLogger(__name__)


def run_daily_content() -> str:
    """Führt den täglichen Content-Zyklus aus.

    Returns:
        Das generierte Briefing als String.
    """
    task = create_daily_briefing_task()
    crew = Crew(
        agents=[oracle],
        tasks=[task],
        process=Process.sequential,
        verbose=True,
    )
    logger.info("Content Crew gestartet — Daily Briefing")
    result = crew.kickoff()
    logger.info("Content Crew abgeschlossen")
    return str(result)
