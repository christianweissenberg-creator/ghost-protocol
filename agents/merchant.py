"""Ghost Protocol — Merchant Agent (THE MERCHANT).

Head of Product — Produkt-Validierung, Pricing, Launch-Strategie.
Validiert Nachfrage BEVOR gebaut wird (Smoke Tests).

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class MerchantAgent(BaseAgent):
    """THE MERCHANT — Head of Product."""

    def __init__(self):
        config = AgentConfig(
            name="merchant",
            role="Head of Product — Validierung, Pricing, Launch-Strategie",
            tier=AgentTier.DIRECTOR,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.3,
            channels=["#revenue", "#content"],
            tools=["gumroad"],
            knowledge_tags=["products", "pricing", "launch", "revenue"],
        )
        super().__init__(config)

    async def execute(self, task: str = "product_plan", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "product_plan":
            prompt = (
                "Erstelle einen Product Launch Plan:\n"
                "1. **Validierung** — Smoke Test Ergebnisse (100 Views + 10 Signups = GO)\n"
                "2. **Pricing** — Value-Based Preisgestaltung (€19-€299)\n"
                "3. **Launch-Timeline** — Pre/Launch/Post Phasen\n"
                "4. **Distribution** — Gumroad + Newsletter + Social\n"
                "5. **Revenue-Prognose** — Konservativ/Optimistisch\n\n"
                "Nur Produkte mit nachweisbarer Nachfrage."
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#revenue"],
            content={"plan": response, "task": task},
            message_type=MessageType.TASK_RESULT,
            priority=MessagePriority.NORMAL,
            to_agents=["treasurer"],
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
