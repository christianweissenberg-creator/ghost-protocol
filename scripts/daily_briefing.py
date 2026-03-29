"""Ghost Protocol — Daily Briefing Runner.

Wird via GitHub Actions Cron oder manuell getriggert.
Erstellt das tägliche Intelligence Briefing via Oracle Agent.

Usage:
    python scripts/daily_briefing.py
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Pfad-Setup für Imports aus dem Root-Verzeichnis
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from crewai import Crew, Process

from agents.oracle import create_daily_briefing_task, oracle

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger: logging.Logger = logging.getLogger(__name__)


def main() -> None:
    """Führt das Daily Briefing aus und speichert das Ergebnnis."""
    logger.info("Daily Intelligence Briefing gestartet")

    task = create_daily_briefing_task()
    crew = Crew(
        agents=[oracle],
        tasks=[task],
        process=Process.sequential,
        verbose=True,
    )

    try:
        result = crew.kickoff()
    except Exception as e:
        logger.error("Crew Execution fehlgeschlagen: %s", e)
        # TODO: Telegram-Alert hier integrieren (Sprint 2)
        raise

    # Output speichern
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    date_str: str = datetime.now().strftime("%Y-%m-%d")
    output_path = output_dir / f"briefing_{date_str}.md"

    try:
        output_path.write_text(
            f"# Daily Intelligence Briefing — {date_str}\n\n{result}",
            encoding="utf-8",
        )
        logger.info("Briefing gespeichert: %s", output_path)
    except OSError as e:
        logger.error("Fehler beim Speichern des Briefings: %s", e)
        raise


if __name__ == "__main__":
    main()
