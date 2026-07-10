"""Ghost Protocol — Architect Agent (THE ARCHITECT).

CTO / Chief Technology Officer.
Platform-Design, AI-Infrastruktur, Cost-Optimierung, Tech-Entscheidungen.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class ArchitectAgent(BaseAgent):
    """THE ARCHITECT — Chief Technology Officer."""

    def __init__(self):
        config = AgentConfig(
            name="architect",
            role="Chief Technology Officer — Platform/Infra, Cost-Optimierung",
            tier=AgentTier.C_SUITE,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.2,
            channels=["#boardroom", "#ops", "#emergency"],
            tools=[],
            knowledge_tags=["architecture", "infrastructure", "costs"],
        )
        super().__init__(config)

    async def execute(self, task: str = "tech_review", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "tech_review":
            prompt = (
                "Erstelle ein Technical Review:\n"
                "1. **System-Gesundheit** — VPS, Supabase, APIs\n"
                "2. **API-Kosten** — Claude API Verbrauch vs Budget (€40/Mo)\n"
                "3. **Infrastruktur-Risiken** — Single Points of Failure\n"
                "4. **Tech Debt** — Was muss aufgeraeumt werden?\n"
                "5. **Empfehlungen** — Naechste technische Schritte"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#ops"],
            content={"review": response, "task": task},
            message_type=MessageType.STATUS_UPDATE,
            priority=MessagePriority.NORMAL,
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
