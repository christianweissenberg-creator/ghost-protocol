"""Ghost Protocol — Concierge Agent (THE CONCIERGE).

Community Support — Happiness Delivery, Churn Prevention, Community Flywheel.
Beantwortet Telegram/Email Fragen, identifiziert VIP-Kunden.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
Laeuft auf Haiku (schnell + guenstig fuer Support-Anfragen).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class ConciergeAgent(BaseAgent):
    """THE CONCIERGE — Community Support."""

    def __init__(self):
        config = AgentConfig(
            name="concierge",
            role="Community Support — Happiness, Churn Prevention, VIP Identification",
            tier=AgentTier.OPERATOR,
            llm_model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            temperature=0.4,
            channels=["#growth"],
            tools=["telegram"],
            knowledge_tags=["support", "community", "faq", "dach"],
        )
        super().__init__(config)

    async def execute(self, task: str = "answer_question", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        question = kwargs.get("question", "")
        if question:
            context = f"## Kundenfrage\n{question}\n\n{context}"

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "answer_question":
            prompt = (
                "Beantworte die Kundenfrage:\n"
                "- Freundlich, hilfreich, auf Deutsch\n"
                "- Max 200 Woerter\n"
                "- Bei Steuer/Rechts-Fragen: An COUNSEL eskalieren\n"
                "- Bei technischen Problemen: An ARCHITECT eskalieren\n"
                "- NIEMALS Anlageberatung geben\n"
                "- Pflicht-Disclaimer bei Krypto-Themen"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        needs_escalation = any(kw in response.lower() for kw in [
            "eskalier", "counsel", "architect", "nicht beantworten",
        ])

        await self.send_message(
            channels=["#growth"],
            content={"response": response, "escalated": needs_escalation},
            message_type=MessageType.TASK_RESULT,
            priority=MessagePriority.NORMAL,
        )

        return {
            "status": "success",
            "output": response,
            "escalated": needs_escalation,
            "cost_usd": self._total_cost_usd,
        }
