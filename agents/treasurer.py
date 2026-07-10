"""Ghost Protocol — Treasurer Agent (THE TREASURER).

CFO / Chief Financial Officer.
P&L-Tracking, Budget-Kontrolle, Deutsche Steuer-Compliance (§19 UStG),
Revenue-Attribution, ROI-Analyse.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
Laeuft auf Haiku (kostenguenstig fuer Routine-Finance-Tasks).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class TreasurerAgent(BaseAgent):
    """THE TREASURER — Chief Financial Officer."""

    def __init__(self):
        config = AgentConfig(
            name="treasurer",
            role="Chief Financial Officer — P&L/Budget, DE-Steuer, Revenue-Attribution",
            tier=AgentTier.C_SUITE,
            llm_model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            temperature=0.1,
            channels=["#boardroom", "#revenue", "#ops"],
            tools=[],
            knowledge_tags=["finance", "tax", "revenue", "budget"],
        )
        super().__init__(config)

    async def execute(self, task: str = "budget_report", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "budget_report":
            prompt = (
                "Erstelle den Budget-Report:\n"
                "1. **Fixkosten** — VPS €6, Claude API ~€40, Serper €5, Domain €2 = €55/Mo\n"
                "2. **Variable Kosten** — Zusaetzliche API-Calls, Tools\n"
                "3. **Revenue** — Aktueller Stand pro Stream\n"
                "4. **P&L** — Gewinn/Verlust Monat\n"
                "5. **Steuer** — Kleinunternehmer §19 UStG Status (Grenze: €25.000/Jahr)\n"
                "6. **Warnung** — Budget-Ueberschreitung droht? Ja/Nein"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#boardroom", "#revenue"],
            content={"report": response, "task": task},
            message_type=MessageType.REVENUE_UPDATE,
            priority=MessagePriority.NORMAL,
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
