"""Ghost Protocol — Researcher Agent (THE RESEARCHER).

Head of Research — Marktanalyse, Trends, Validierung.
Scannt Gumroad, Etsy, Reddit und DACH-Communities um zu identifizieren
welche Produkte Nachfrage haben und Revenue generieren koennen.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType
from tools.research_tools import (
    format_research_data,
    gather_product_research,
    search_dach_market_gaps,
    search_gumroad_trends,
    search_reddit_painpoints,
)

logger: logging.Logger = logging.getLogger(__name__)


class ResearcherAgent(BaseAgent):
    """THE RESEARCHER — Head of Research.

    Workflow:
    1. gather_data() — Scannt Maerkte via Tools (kein LLM)
    2. execute() — Analysiert Daten mit LLM, priorisiert Opportunities
    3. Broadcast auf #revenue fuer MerchantAgent
    """

    def __init__(self):
        config = AgentConfig(
            name="researcher",
            role="Head of Research — Marktanalyse, Trends, Validierung",
            tier=AgentTier.DIRECTOR,
            llm_model="claude-sonnet-5",
            max_tokens=4096,
            temperature=0.3,
            channels=["#revenue", "#boardroom"],
            tools=["serper"],
            knowledge_tags=["products", "markets", "dach", "revenue"],
        )
        super().__init__(config)

    def gather_data(self, niche: str = "krypto") -> dict[str, Any]:
        """Sammelt Markt- und Produktdaten aus allen Quellen.

        Kein LLM-Call — nur HTTP-Requests.

        Args:
            niche: Zu untersuchende Nische

        Returns:
            Dict mit allen Research-Ergebnissen
        """
        self.logger.info("gathering_research_data", {"niche": niche})

        data = gather_product_research(niche)
        data["timestamp"] = datetime.now().isoformat()
        data["niche"] = niche

        total_results = sum(len(v) for k, v in data.items() if isinstance(v, list))
        self.logger.info("research_data_gathered", {
            "niche": niche,
            "total_results": total_results,
        })

        return data

    async def execute(self, task: str = "product_research", **kwargs) -> dict[str, Any]:
        """Fuehrt Research-Task aus.

        Args:
            task: Task-Typ ("product_research" oder freier Text)
            **kwargs:
                niche: Zu untersuchende Nische (default: "krypto")
                data: Vorab gesammelte Daten (optional)

        Returns:
            {"status": "success", "output": str, "data": dict, "cost_usd": float}
        """
        niche = kwargs.get("niche", "krypto")

        # 1. Daten sammeln
        data = kwargs.get("data") or self.gather_data(niche)

        # 2. Kontext aufbauen
        context = format_research_data(data)

        # 3. RAG-Wissen dazuholen
        rag_context = await self.retrieve_knowledge(f"product research {niche}")
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        # 4. LLM-Call: Analyse generieren
        if task == "product_research":
            prompt = (
                f"Analysiere die Marktdaten fuer die Nische '{niche}' und erstelle "
                "einen priorisierten Product Research Report.\n\n"
                "Struktur:\n"
                "1. **Executive Summary** (3 Saetze)\n"
                "2. **Top 5 Produkt-Ideen** (priorisiert nach Revenue-Potenzial):\n"
                "   - Name + Beschreibung\n"
                "   - Zielgruppe\n"
                "   - Preisvorschlag (EUR)\n"
                "   - Geschaetzte monatliche Sales\n"
                "   - Erstellungszeit\n"
                "   - Wettbewerbsvorteil\n"
                "   - Red Flags\n"
                "3. **Gesamtes monatliches Revenue-Potenzial**\n"
                "4. **Empfohlene Erstellungsreihenfolge**\n\n"
                "Sei BRUTAL ehrlich. Nur Produkte mit nachweisbarer Nachfrage.\n"
                "Schreibe auf Deutsch."
            )
        else:
            prompt = task

        report = await self.think(prompt, context=context)

        # 5. Broadcast
        await self.send_message(
            channels=["#revenue"],
            content={"report": report, "niche": niche, "timestamp": data["timestamp"]},
            message_type=MessageType.TASK_RESULT,
            priority=MessagePriority.NORMAL,
            to_agents=["merchant"],
        )

        self.logger.info("research_completed", {
            "task": task,
            "niche": niche,
            "output_chars": len(report),
            "cost_usd": self._total_cost_usd,
        })

        return {
            "status": "success",
            "output": report,
            "data": data,
            "cost_usd": self._total_cost_usd,
        }

    async def validate_idea(self, product_idea: str) -> str:
        """Validiert eine spezifische Produktidee gegen Marktdaten.

        Fuer Ad-hoc-Anfragen von MerchantAgent oder DONNA.
        """
        gumroad = search_gumroad_trends(product_idea)
        reddit = search_reddit_painpoints(product_idea)
        dach = search_dach_market_gaps(f"{product_idea} kaufen")

        context_parts = [
            f"## Gumroad-Ergebnisse fuer '{product_idea}'\n" +
            "\n".join(f"- {r['title']}: {r['snippet']}" for r in gumroad[:5]),
            f"## Reddit Pain Points\n" +
            "\n".join(f"- {r['title']}: {r['snippet']}" for r in reddit[:5]),
            f"## DACH-Markt\n" +
            "\n".join(f"- {r['title']}: {r['snippet']}" for r in dach[:5]),
        ]

        return await self.think(
            f"Bewerte die Produktidee '{product_idea}' anhand der Marktdaten.\n"
            "Gib eine Bewertung (1-10) fuer: Nachfrage, Wettbewerb, Machbarkeit, Revenue-Potenzial.\n"
            "Fazit: Umsetzen ja/nein? Warum? Max 200 Woerter.",
            context="\n\n".join(context_parts),
        )
