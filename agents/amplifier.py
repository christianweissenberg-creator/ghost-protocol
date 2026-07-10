"""Ghost Protocol — Amplifier Agent (THE AMPLIFIER).

Head of Growth — Viral Engineering, Community Building, Funnel-Optimierung.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class AmplifierAgent(BaseAgent):
    """THE AMPLIFIER — Head of Growth."""

    def __init__(self):
        config = AgentConfig(
            name="amplifier",
            role="Head of Growth — Viral Loops, Community, Funnel-Optimierung",
            tier=AgentTier.DIRECTOR,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.5,
            channels=["#growth", "#content"],
            tools=[],
            knowledge_tags=["growth", "social", "community", "funnel"],
        )
        super().__init__(config)

    async def execute(self, task: str = "growth_plan", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "growth_plan":
            prompt = (
                "Erstelle einen Growth-Plan:\n"
                "1. **Viral Loops** — Welche Mechanismen treiben organisches Wachstum?\n"
                "2. **Community** — Telegram/X Engagement-Strategie\n"
                "3. **Funnel** — Stranger→Follower→Subscriber→Customer Conversion\n"
                "4. **A/B Tests** — Was testen wir diese Woche?\n"
                "5. **Metriken** — Ziel-KPIs fuer naechste 7 Tage\n\n"
                "Fokus: DACH Krypto-Community, organisch, €0 Ad-Budget."
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#growth"],
            content={"plan": response, "task": task},
            message_type=MessageType.TASK_RESULT,
            priority=MessagePriority.NORMAL,
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
