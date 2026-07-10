"""Ghost Protocol — Donna Agent (DONNA).

Chief of Staff — Orchestrierung zwischen CEO und allen 17 Agenten.
Monitort Agent-Status, antizipiert Engpaesse, loest Konflikte,
schuetzt Christians Zeit, pflegt institutionelles Gedaechtnis.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class DonnaAgent(BaseAgent):
    """DONNA — Chief of Staff.

    Workflow:
    1. Empfaengt Inputs von allen Agenten und STRATEGIST
    2. Priorisiert, delegiert, orchestriert
    3. Eskaliert nur wenn noetig an Christian
    """

    def __init__(self):
        config = AgentConfig(
            name="donna",
            role="Chief of Staff — Orchestrierung, Delegation, Konfliktloesung",
            tier=AgentTier.BRAIN,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.3,
            channels=[
                "#boardroom", "#ops", "#market-intel", "#content",
                "#legal-review", "#revenue", "#growth", "#emergency",
            ],
            tools=[],
            knowledge_tags=["operations", "strategy", "agents"],
        )
        super().__init__(config)

    async def execute(self, task: str = "daily_orchestration", **kwargs) -> dict[str, Any]:
        """Fuehrt Orchestrierungs-Task aus.

        Args:
            task: "daily_orchestration", "delegate", "resolve_conflict", oder freier Text
            **kwargs:
                agent_statuses: Dict mit Agent-Health-Daten
                request: Delegations-Anfrage
        """
        context = kwargs.get("context_data", "")
        agent_statuses = kwargs.get("agent_statuses", "")
        if agent_statuses:
            context = f"## Agent-Status\n{agent_statuses}\n\n{context}"

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "daily_orchestration":
            prompt = (
                "Erstelle den taeglichen Orchestrierungs-Plan.\n\n"
                "1. **Agent-Status** — Wer ist online, wer hat Probleme?\n"
                "2. **Heute faellig** — Welche Tasks muessen heute erledigt werden?\n"
                "3. **Delegationen** — Wer macht was?\n"
                "4. **Engpaesse** — Wo koennte es haken?\n"
                "5. **Eskalationen** — Muss Christian informiert werden?\n\n"
                "Sei praezise und actionable."
            )
        elif task == "delegate":
            request = kwargs.get("request", "")
            prompt = (
                f"Delegiere folgende Aufgabe an den richtigen Agenten:\n\n{request}\n\n"
                "Bestimme:\n"
                "1. Welcher Agent ist zustaendig?\n"
                "2. Welche Prioritaet?\n"
                "3. Deadline?\n"
                "4. Abhaengigkeiten?\n"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#ops"],
            content={"plan": response, "task": task},
            message_type=MessageType.TASK_REQUEST,
            priority=MessagePriority.HIGH,
        )

        return {
            "status": "success",
            "output": response,
            "cost_usd": self._total_cost_usd,
        }
