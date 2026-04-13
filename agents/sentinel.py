"""Ghost Protocol — Sentinel Agent (THE SENTINEL).

Market Watch Officer — Frühwarnsystem für das Intelligence Flywheel.
Scannt Märkte und News in kurzen Intervallen, klassifiziert Events nach Impact,
triggert ORACLE nur bei signifikanten Ereignissen (Impact ≥ 7).

Günstigster Agent im System: Haiku + kurze Scans = minimale API-Kosten.
Wenn Perplexity verfügbar: Research-Queries werden automatisch geroutet.

Architecture: BaseAgent + standalone Tools + Multi-Model Router.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from agents.base_agent import (
    AgentConfig,
    AgentTier,
    BaseAgent,
    MessagePriority,
    MessageType,
)
from agents.router import TaskCategory
from tools.market_tools import (
    format_market_data,
    format_news,
    get_market_data,
    search_crypto_news,
    search_dach_news,
)

logger: logging.Logger = logging.getLogger(__name__)

# Assets für kontinuierliches Monitoring
WATCH_SYMBOLS = "bitcoin,ethereum,solana,bnb,ripple"

# Schwellwerte
PRICE_ALERT_THRESHOLD_PCT = 5.0   # 24h-Änderung für Price Alert
ORACLE_TRIGGER_IMPACT = 7         # Minimum Impact für ORACLE-Trigger


class SentinelAgent(BaseAgent):
    """THE SENTINEL — Market Watch Officer.

    Workflow:
    1. scan() — Holt Marktdaten + Top-News (kein LLM, nur HTTP)
    2. classify() — LLM klassifiziert Events nach Impact (Haiku, günstig)
    3. decide() — Triggert ORACLE wenn Impact ≥ 7, sonst nur logging
    4. execute() — Orchestriert den kompletten Scan-Cycle

    Cost Profile:
    - scan(): $0.00 (nur HTTP)
    - classify(): ~$0.001-0.003 (Haiku, kurzer Output)
    - Gesamt pro Scan: ~$0.003
    - Bei 48 Scans/Tag (alle 30 min): ~$0.15/Tag = ~$4.50/Mo
    """

    def __init__(self, symbols: str = WATCH_SYMBOLS):
        config = AgentConfig(
            name="sentinel",
            role="Market Watch Officer — Event Detection, Impact Classification, Early Warning",
            tier=AgentTier.OPERATOR,
            llm_model="claude-haiku-4-5-20251001",  # Günstigstes Modell
            max_tokens=1500,  # Kurze JSON-Antworten reichen
            temperature=0.1,  # Deterministic: gleicher Input = gleiche Klassifizierung
            channels=["#market-intel", "#ops"],
            tools=["serper", "coingecko"],
            knowledge_tags=["crypto", "markets", "regulation"],
        )
        super().__init__(config)
        self.symbols = symbols

    def scan(self) -> dict[str, Any]:
        """Phase 1: Rohdaten sammeln (kein LLM, kein API-Cost).

        Returns:
            Dict mit market_data, news, price_alerts, scan_timestamp
        """
        self.logger.info("scan_started", {"symbols": self.symbols})

        market_data = get_market_data(self.symbols)
        news = search_crypto_news("crypto breaking news today", num_results=5)
        dach_news = search_dach_news("Krypto Regulierung Deutschland EU", num_results=3)

        # Automatische Price Alerts generieren
        price_alerts = []
        for symbol, data in market_data.items():
            change = data.get("eur_24h_change", 0)
            if abs(change) >= PRICE_ALERT_THRESHOLD_PCT:
                price_alerts.append({
                    "asset": symbol.upper(),
                    "price_eur": data.get("eur", 0),
                    "change_24h_pct": round(change, 1),
                    "alert_type": "LARGE_MOVE",
                })

        scan_data = {
            "market_data": market_data,
            "news": news,
            "dach_news": dach_news,
            "price_alerts": price_alerts,
            "scan_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self.logger.info("scan_completed", {
            "news_count": len(news),
            "dach_news_count": len(dach_news),
            "price_alerts": len(price_alerts),
            "symbols": len(market_data),
        })

        return scan_data

    async def classify(self, scan_data: dict[str, Any]) -> dict[str, Any]:
        """Phase 2: Events klassifizieren via LLM (Haiku, günstig).

        Nutzt den Router: wenn Perplexity verfügbar → Research-Route,
        sonst Haiku für schnelle Klassifizierung.

        Args:
            scan_data: Output von scan()

        Returns:
            Strukturiertes Event-Assessment als Dict
        """
        context_parts = [
            format_market_data(scan_data.get("market_data", {})),
            format_news(scan_data.get("news", []), "Breaking Crypto News"),
            format_news(scan_data.get("dach_news", []), "DACH Regulierung"),
        ]

        if scan_data.get("price_alerts"):
            alerts = "\n".join(
                f"- {a['asset']}: {a['change_24h_pct']:+.1f}% ({a['price_eur']:,.0f} EUR)"
                for a in scan_data["price_alerts"]
            )
            context_parts.append(f"## Price Alerts\n{alerts}")

        context = "\n\n---\n\n".join(context_parts)

        prompt = (
            "Analysiere die aktuellen Marktdaten und News.\n"
            "Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt.\n"
            "Kein Fließtext, keine Erklärung — nur JSON.\n\n"
            "Pflichtfelder im JSON:\n"
            '- "market_status": "CALM" | "VOLATILE" | "ALERT" | "CRISIS"\n'
            '- "events": Array von Events mit: headline, impact_score (1-10), '
            'category, assets_affected, dach_relevant, summary, requires_oracle\n'
            '- "recommendation": "TRIGGER_ORACLE" | "LOG_ONLY" | "ESCALATE_STRATEGIST"\n\n'
            "Regeln:\n"
            "- Nur Events mit Impact ≥ 4 listen\n"
            "- requires_oracle=true NUR bei Impact ≥ 7\n"
            "- Lieber weniger Events als False Positives\n"
            "- DACH-Regulierung → automatisch +2 Impact"
        )

        # Route: GENERAL category uses Haiku (agent's default model)
        # When Perplexity is available, research queries would go there
        response_text = await self.think(
            task=prompt,
            context=context,
            category=TaskCategory.GENERAL,
        )

        # Parse JSON from response
        try:
            # Strip markdown code fences if present
            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
                cleaned = cleaned.rsplit("```", 1)[0]
            assessment = json.loads(cleaned)
        except json.JSONDecodeError:
            self.logger.error("json_parse_failed", {"response_preview": response_text[:200]})
            assessment = {
                "market_status": "CALM",
                "events": [],
                "recommendation": "LOG_ONLY",
                "parse_error": True,
            }

        # Inject price alerts from scan
        assessment["price_alerts"] = scan_data.get("price_alerts", [])
        assessment["scan_timestamp"] = scan_data.get("scan_timestamp", "")

        return assessment

    def should_trigger_oracle(self, assessment: dict[str, Any]) -> bool:
        """Entscheidet ob ORACLE aktiviert werden soll.

        Trigger-Bedingungen (eine reicht):
        - recommendation == "TRIGGER_ORACLE" oder "ESCALATE_STRATEGIST"
        - Mindestens ein Event mit impact_score ≥ 7
        - market_status == "ALERT" oder "CRISIS"
        - Price Alert mit Änderung > 10%
        """
        if assessment.get("recommendation") in ("TRIGGER_ORACLE", "ESCALATE_STRATEGIST"):
            return True

        for event in assessment.get("events", []):
            if event.get("impact_score", 0) >= ORACLE_TRIGGER_IMPACT:
                return True

        if assessment.get("market_status") in ("ALERT", "CRISIS"):
            return True

        for alert in assessment.get("price_alerts", []):
            if abs(alert.get("change_24h_pct", 0)) > 10.0:
                return True

        return False

    async def execute(self, task: str = "scan", **kwargs) -> dict[str, Any]:
        """Orchestriert den kompletten Scan-Cycle.

        Args:
            task: "scan" (default) oder freier Task-Text
            **kwargs:
                scan_data: Vorab gesammelte Daten (optional)
                force_oracle: True = ORACLE immer triggern

        Returns:
            {"status": "success", "assessment": dict, "oracle_triggered": bool, "cost_usd": float}
        """
        # Phase 1: Scan (kostenlos)
        scan_data = kwargs.get("scan_data") or self.scan()

        # Phase 2: Classify (Haiku, günstig)
        assessment = await self.classify(scan_data)

        # Phase 3: Decide
        force_oracle = kwargs.get("force_oracle", False)
        trigger_oracle = force_oracle or self.should_trigger_oracle(assessment)

        # Broadcast auf Message Bus
        priority = MessagePriority.HIGH if trigger_oracle else MessagePriority.LOW
        message_type = MessageType.ALERT if trigger_oracle else MessageType.STATUS_UPDATE

        await self.send_message(
            channels=["#market-intel"],
            content={
                "assessment": assessment,
                "oracle_triggered": trigger_oracle,
                "scan_timestamp": assessment.get("scan_timestamp", ""),
            },
            message_type=message_type,
            priority=priority,
            to_agents=["oracle"] if trigger_oracle else [],
            confidence=0.8 if not assessment.get("parse_error") else 0.3,
        )

        action = "ORACLE triggered" if trigger_oracle else "logged only"
        self.logger.info("cycle_completed", {
            "market_status": assessment.get("market_status", "UNKNOWN"),
            "events_found": len(assessment.get("events", [])),
            "price_alerts": len(assessment.get("price_alerts", [])),
            "action": action,
            "cost_usd": self._total_cost_usd,
        })

        return {
            "status": "success",
            "assessment": assessment,
            "oracle_triggered": trigger_oracle,
            "cost_usd": self._total_cost_usd,
        }
