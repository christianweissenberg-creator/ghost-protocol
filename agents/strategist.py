"""Ghost Protocol — Strategist Agent (THE STRATEGIST).

CEO / Chief Executive Officer.
Revenue-fokussierter strategischer Visionaer. Definiert Richtung,
Budget-Allokation, Go/Kill-Entscheidungen, Revenue Staircase.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class StrategistAgent(BaseAgent):
    """THE STRATEGIST — Chief Executive Officer.

    Workflow:
    1. Empfaengt Inputs von DONNA, ORACLE, TREASURER
    2. Analysiert strategische Lage mit LLM
    3. Trifft Go/Kill-Entscheidungen, sendet Direktiven
    """

    def __init__(self):
        config = AgentConfig(
            name="strategist",
            role="Chief Executive Officer — Revenue Staircase, Budget-Allokation, Go/Kill-Decisions",
            tier=AgentTier.BRAIN,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.3,
            channels=["#boardroom", "#ops", "#emergency"],
            tools=[],
            knowledge_tags=["strategy", "revenue", "business"],
        )
        super().__init__(config)

    async def execute(self, task: str = "strategic_review", **kwargs) -> dict[str, Any]:
        """Fuehrt strategischen Task aus.

        Args:
            task: "strategic_review", "budget_decision", "go_kill_decision", oder freier Text
            **kwargs:
                context_data: Zusaetzliche Daten von anderen Agenten
        """
        context = kwargs.get("context_data", "")

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "strategic_review":
            prompt = (
                "Erstelle ein strategisches Review fuer Ghost Protocol.\n\n"
                "Struktur:\n"
                "1. **Revenue Status** — Wo stehen wir auf der Revenue Staircase (€0→€100→€500→€1k→€10k)?\n"
                "2. **Budget** — €55/Mo laufend. Wird das Budget eingehalten?\n"
                "3. **Top 3 Prioritaeten** fuer die naechsten 7 Tage\n"
                "4. **Risiken** — Was koennte schiefgehen?\n"
                "5. **Go/Kill** — Welche Initiativen weiterfuehren, welche stoppen?\n\n"
                "Sei brutal ehrlich. Keine Floskeln. Datenbasiert."
            )
        elif task == "budget_decision":
            prompt = (
                "Bewerte die Budget-Anfrage und entscheide:\n"
                "- Passt das in unser €55/Mo Budget?\n"
                "- ROI-Erwartung (mindestens 3x)?\n"
                "- Go oder Kill? Begruendung.\n\n"
                "Antworte mit einer klaren Entscheidung."
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#boardroom"],
            content={"decision": response, "task": task},
            message_type=MessageType.DECISION,
            priority=MessagePriority.HIGH,
            confidence=0.9,
        )

        return {
            "status": "success",
            "output": response,
            "cost_usd": self._total_cost_usd,
        }
