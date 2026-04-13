"""Ghost Protocol — Intelligence Flywheel Pipeline.

SENTINEL → ORACLE → TRADER

Orchestriert den kompletten Intelligence-Zyklus:
1. SENTINEL scannt Märkte + News, klassifiziert Events
2. Bei Impact ≥ 7: ORACLE generiert Deep-Analysis Briefing
3. Bei Trading-Signal: TRADER bewertet und generiert Signal

Designed für Cron-Jobs: alle 30 Minuten ein Scan-Zyklus.
Gesamtkosten pro Zyklus (ohne Oracle-Trigger): ~$0.003
Gesamtkosten pro Zyklus (mit Oracle): ~$0.05-0.10

Usage:
    python -m execution.intelligence_flywheel          # Single run
    python -m execution.intelligence_flywheel --loop    # Continuous (30 min)
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Project root auf sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.sentinel import SentinelAgent
from agents.oracle import OracleAgent
from execution.agent_runner import AgentRunner

logger = logging.getLogger("flywheel")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)


async def run_flywheel(force_oracle: bool = False) -> dict[str, Any]:
    """Führt einen kompletten Intelligence Flywheel Zyklus aus.

    Args:
        force_oracle: True = ORACLE immer triggern (für Tests/manuelle Runs)

    Returns:
        {
            "sentinel": {...},
            "oracle": {...} or None,
            "trader_signal": {...} or None,
            "total_cost_usd": float,
            "cycle_timestamp": str,
        }
    """
    cycle_start = datetime.now(timezone.utc)
    result: dict[str, Any] = {
        "sentinel": None,
        "oracle": None,
        "trader_signal": None,
        "total_cost_usd": 0.0,
        "cycle_timestamp": cycle_start.isoformat(),
    }

    # ── Phase 1: SENTINEL Scan ──────────────────────────
    logger.info("Phase 1: SENTINEL scan starting...")
    sentinel = SentinelAgent()
    sentinel_result = await sentinel.execute("scan", force_oracle=force_oracle)
    result["sentinel"] = {
        "market_status": sentinel_result["assessment"].get("market_status", "UNKNOWN"),
        "events_count": len(sentinel_result["assessment"].get("events", [])),
        "price_alerts": len(sentinel_result["assessment"].get("price_alerts", [])),
        "oracle_triggered": sentinel_result["oracle_triggered"],
        "cost_usd": sentinel_result["cost_usd"],
    }
    result["total_cost_usd"] += sentinel_result["cost_usd"]

    logger.info(
        "SENTINEL: status=%s, events=%d, alerts=%d, oracle_triggered=%s, cost=$%.4f",
        result["sentinel"]["market_status"],
        result["sentinel"]["events_count"],
        result["sentinel"]["price_alerts"],
        result["sentinel"]["oracle_triggered"],
        result["sentinel"]["cost_usd"],
    )

    # ── Phase 2: ORACLE (nur wenn getriggert) ───────────
    if sentinel_result["oracle_triggered"]:
        logger.info("Phase 2: ORACLE deep analysis starting...")
        oracle = OracleAgent()

        # SENTINEL-Daten als Intel für ORACLE weiterreichen
        # Oracle nutzt die gleichen Rohdaten + macht eigene Recherche
        oracle_result = await oracle.execute("daily_briefing")
        result["oracle"] = {
            "briefing_length": len(oracle_result.get("output", "")),
            "cost_usd": oracle_result.get("cost_usd", 0),
        }
        result["total_cost_usd"] += oracle_result.get("cost_usd", 0)

        logger.info(
            "ORACLE: briefing=%d chars, cost=$%.4f",
            result["oracle"]["briefing_length"],
            result["oracle"]["cost_usd"],
        )

        # ── Phase 3: TRADER Bewertung (nur wenn ORACLE Signal liefert) ──
        # Prüfe ob ORACLE-Briefing Trading-relevante Events enthält
        high_impact_events = [
            e for e in sentinel_result["assessment"].get("events", [])
            if e.get("impact_score", 0) >= 8
        ]

        if high_impact_events:
            logger.info("Phase 3: TRADER signal evaluation for %d high-impact events...",
                        len(high_impact_events))
            runner = AgentRunner()
            trader_result = runner.run(
                "TRADER",
                task=(
                    "Bewerte die folgenden High-Impact Events und generiere "
                    "ein Trading-Signal falls relevant. Antworte mit JSON: "
                    '{"signal": true/false, "asset": "...", "direction": "LONG/SHORT/NEUTRAL", '
                    '"confidence": 0.0-1.0, "reasoning": "..."}'
                ),
                context={
                    "oracle_briefing": oracle_result.get("output", "")[:2000],
                    "high_impact_events": high_impact_events,
                    "market_status": sentinel_result["assessment"].get("market_status"),
                },
                category="scoring_critical",
            )
            result["trader_signal"] = {
                "output_preview": trader_result["output"][:500],
                "provider": trader_result.get("provider", "anthropic"),
                "cost_usd": trader_result["cost_usd"],
            }
            result["total_cost_usd"] += trader_result["cost_usd"]

            logger.info(
                "TRADER: provider=%s, cost=$%.4f",
                result["trader_signal"]["provider"],
                result["trader_signal"]["cost_usd"],
            )
    else:
        logger.info("Phase 2 skipped: market calm, no ORACLE needed.")

    # ── Summary ─────────────────────────────────────────
    elapsed = (datetime.now(timezone.utc) - cycle_start).total_seconds()
    logger.info(
        "Flywheel cycle complete: %.1fs, total_cost=$%.4f, oracle=%s",
        elapsed, result["total_cost_usd"],
        "YES" if result["oracle"] else "NO",
    )

    return result


async def run_loop(interval_minutes: int = 30) -> None:
    """Continuous loop für Cron-Ersatz / Docker."""
    logger.info("Intelligence Flywheel starting continuous loop (every %d min)...", interval_minutes)
    while True:
        try:
            await run_flywheel()
        except Exception as e:
            logger.error("Flywheel cycle failed: %s", e, exc_info=True)
        await asyncio.sleep(interval_minutes * 60)


if __name__ == "__main__":
    if "--loop" in sys.argv:
        asyncio.run(run_loop())
    elif "--force" in sys.argv:
        asyncio.run(run_flywheel(force_oracle=True))
    else:
        asyncio.run(run_flywheel())
