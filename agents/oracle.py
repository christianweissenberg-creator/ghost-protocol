"""Ghost Protocol — Oracle Agent (THE ORACLE).

CIO / Chief Intelligence Officer.
Scannt Krypto-Maerkte, News, On-Chain-Daten und Social Sentiment.
Liefert taegliches Intelligence Briefing als Feed fuer alle anderen Agenten.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType
from tools.market_tools import (
    format_market_data,
    format_news,
    get_market_data,
    search_crypto_news,
    search_dach_news,
)

logger: logging.Logger = logging.getLogger(__name__)

# Standard-Assets fuer taegliches Monitoring
DEFAULT_SYMBOLS = "bitcoin,ethereum,solana,bnb"

# Standard-Queries fuer taegliches Briefing
BRIEFING_QUERIES = {
    "global_news": "crypto market news today",
    "dach_news": "Krypto Nachrichten Deutschland",
    "regulation": "crypto regulation EU MiCA 2026",
}


class OracleAgent(BaseAgent):
    """THE ORACLE — Chief Intelligence Officer.

    Workflow:
    1. gather_intel() — Holt Marktdaten + News via Tools (kein LLM noetig)
    2. execute() — Gibt Intel als Kontext an LLM, generiert Briefing
    3. Broadcast auf #market-intel fuer andere Agenten
    """

    def __init__(self, symbols: str = DEFAULT_SYMBOLS):
        config = AgentConfig(
            name="oracle",
            role="Chief Intelligence Officer — Markt-Intelligence, Trend-Detection, Opportunity-Scoring",
            tier=AgentTier.C_SUITE,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.2,
            channels=["#market-intel", "#boardroom"],
            tools=["serper", "coingecko"],
            knowledge_tags=["crypto", "markets", "regulation", "dach"],
        )
        super().__init__(config)
        self.symbols = symbols

    def gather_intel(self) -> dict[str, Any]:
        """Sammelt Rohdaten von allen externen Quellen.

        Kein LLM-Call — nur HTTP-Requests. Guenstig.

        Returns:
            Dict mit market_data, global_news, dach_news, regulation_news
        """
        self.logger.info("gathering_intel", {"symbols": self.symbols})

        data: dict[str, Any] = {
            "market_data": get_market_data(self.symbols),
            "global_news": search_crypto_news(BRIEFING_QUERIES["global_news"]),
            "dach_news": search_dach_news(BRIEFING_QUERIES["dach_news"]),
            "regulation_news": search_crypto_news(BRIEFING_QUERIES["regulation"]),
            "timestamp": datetime.now().isoformat(),
        }

        self.logger.info("intel_gathered", {
            "market_symbols": len(data["market_data"]),
            "global_news_count": len(data["global_news"]),
            "dach_news_count": len(data["dach_news"]),
            "regulation_count": len(data["regulation_news"]),
        })

        return data

    def _build_context(self, intel: dict[str, Any]) -> str:
        """Formatiert Rohdaten als lesbaren Kontext fuer den LLM-Call."""
        parts = [
            format_market_data(intel.get("market_data", {})),
            format_news(intel.get("global_news", []), "Globale Krypto-News"),
            format_news(intel.get("dach_news", []), "DACH-News"),
            format_news(intel.get("regulation_news", []), "Regulatorische Entwicklungen"),
        ]
        return "\n\n---\n\n".join(parts)

    async def execute(self, task: str = "daily_briefing", **kwargs) -> dict[str, Any]:
        """Fuehrt Oracle-Task aus.

        Args:
            task: Task-Typ ("daily_briefing" oder freier Task-Text)
            **kwargs:
                intel: Vorab gesammelte Daten (optional, sonst wird gather_intel() aufgerufen)
                symbols: Override fuer Krypto-Symbole

        Returns:
            {"status": "success", "output": str, "intel": dict, "cost_usd": float}
        """
        # 1. Daten sammeln (oder vorhandene nutzen)
        intel = kwargs.get("intel") or self.gather_intel()

        # 2. Kontext aufbauen
        context = self._build_context(intel)

        # 3. RAG-Wissen dazuholen (wenn Supabase verfuegbar)
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        # 4. LLM-Call: Briefing generieren
        if task == "daily_briefing":
            today = datetime.now().strftime("%d.%m.%Y")
            prompt = (
                f"Erstelle das Daily Intelligence Briefing fuer {today}.\n\n"
                "Struktur:\n"
                "- Marktuebersicht (3-4 Saetze, exakte Zahlen aus den Daten)\n"
                "- Top 3 Nachrichten (je 2-3 Saetze, Relevanz-Bewertung 1-10)\n"
                "- DACH-Relevanz (Was bedeutet das fuer deutsche Investoren?)\n"
                "- Risiken / Red Flags (falls vorhanden)\n"
                "- Opportunity der Woche (1 konkreter, recherchierter Insight)\n\n"
                "Schreibe auf Deutsch. Faktenbasiert. Keine Spekulation als Fakt framen.\n"
                "Ziellaenge: 400-600 Woerter."
            )
        else:
            prompt = task

        briefing = await self.think(prompt, context=context)

        # 5. Auf Message Bus broadcasten (wenn verfuegbar)
        await self.send_message(
            channels=["#market-intel", "#boardroom"],
            content={"briefing": briefing, "timestamp": intel["timestamp"]},
            message_type=MessageType.INTELLIGENCE_BRIEFING,
            priority=MessagePriority.HIGH,
            confidence=0.85,
        )

        self.logger.info("briefing_generated", {
            "task": task,
            "output_chars": len(briefing),
            "cost_usd": self._total_cost_usd,
        })

        return {
            "status": "success",
            "output": briefing,
            "intel": intel,
            "cost_usd": self._total_cost_usd,
        }

    async def quick_scan(self, topic: str) -> str:
        """Schneller Scan zu einem spezifischen Thema.

        Fuer Ad-hoc-Anfragen von anderen Agenten.
        Nur 1 News-Search + 1 LLM-Call = guenstig.
        """
        news = search_crypto_news(topic, num_results=4)
        context = format_news(news, f"Ergebnisse: {topic}")
        return await self.think(
            f"Fasse die wichtigsten Erkenntnisse zu '{topic}' zusammen. "
            "Max 150 Woerter, auf Deutsch, faktenbasiert.",
            context=context,
        )
