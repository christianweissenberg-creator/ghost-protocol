"""Ghost Protocol — Trader Agent (THE TRADER).

Market Analyst & Quantitative Strategist.
Elliott Wave, Position Sizing, Risk Management, Trade Journal.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class TraderAgent(BaseAgent):
    """THE TRADER — Market Analyst."""

    def __init__(self):
        config = AgentConfig(
            name="trader",
            role="Market Analyst — Elliott Wave, Risk Management, Trade Execution",
            tier=AgentTier.OPERATOR,
            llm_model="claude-sonnet-5",
            max_tokens=4096,
            temperature=0.2,
            channels=["#market-intel", "#trading"],
            tools=["coingecko"],
            knowledge_tags=["trading", "technical_analysis", "risk_management"],
        )
        super().__init__(config)

    async def execute(self, task: str = "market_analysis", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        asset = kwargs.get("asset", "bitcoin")

        rag_context = await self.retrieve_knowledge(f"{task} {asset}")
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "market_analysis":
            prompt = (
                f"Erstelle eine technische Analyse fuer {asset.upper()}:\n\n"
                "1. **Trend** — Bullish/Bearish/Neutral + Begruendung\n"
                "2. **Support/Resistance** — Key Levels\n"
                "3. **Indikatoren** — RSI, MACD, Volume\n"
                "4. **Risk/Reward** — CRV fuer Long und Short Szenario\n"
                "5. **Empfehlung** — Warten/Kaufen/Verkaufen + Confidence (0-1)\n\n"
                "INTERN: Ehrliche Analyse. Keine oeffentliche Anlageberatung."
            )
        elif task == "validate_signal":
            prompt = (
                f"Validiere das folgende Signal fuer {asset}:\n\n"
                "Pruefe gegen:\n"
                "- Elliott Wave Count\n"
                "- Fibonacci Levels\n"
                "- Volume-Profil\n"
                "- Walk-Forward-Ergebnisse\n\n"
                "Ergebnis: CONFIRMED / REJECTED / NEUTRAL + Confidence"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#market-intel"],
            content={"analysis": response, "asset": asset, "task": task},
            message_type=MessageType.INTELLIGENCE_BRIEFING,
            priority=MessagePriority.NORMAL,
        )

        return {"status": "success", "output": response, "asset": asset, "cost_usd": self._total_cost_usd}
