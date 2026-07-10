"""Ghost Protocol — Guardian Agent (THE GUARDIAN).

Data Engineer & SRE — System Health, Incident Response, Observability.
Monitort alle 17 Agenten, alarmiert bei SLA-Verletzungen.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
Laeuft auf Haiku (guenstig fuer haeufige Health Checks).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class GuardianAgent(BaseAgent):
    """THE GUARDIAN — Data Engineer & SRE."""

    def __init__(self):
        config = AgentConfig(
            name="guardian",
            role="Data Engineer & Monitor — System Health, SLA Monitoring, Incident Response",
            tier=AgentTier.OPERATOR,
            llm_model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            temperature=0.1,
            channels=["#ops", "#emergency"],
            tools=["telegram"],
            knowledge_tags=["monitoring", "infrastructure", "sla"],
        )
        super().__init__(config)

    async def execute(self, task: str = "health_report", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        agent_statuses = kwargs.get("agent_statuses", "")
        if agent_statuses:
            context = f"## Agent Health Data\n{agent_statuses}\n\n{context}"

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "health_report":
            prompt = (
                "Erstelle den System Health Report:\n"
                "1. **Agent-Status** — Online/Offline pro Agent\n"
                "2. **SLA-Compliance** — Availability ≥99.5%, Success Rate ≥95%\n"
                "3. **API-Kosten** — Heutiger Verbrauch vs. Tageslimit (€1.30)\n"
                "4. **Incidents** — Offene Issues, letzte Fehler\n"
                "5. **Warnungen** — Was droht auszufallen?\n\n"
                "Knapp und praezise. Nur Fakten."
            )
        elif task == "incident_response":
            prompt = (
                "Incident Response:\n"
                "1. **Was ist passiert?**\n"
                "2. **Impact** — Welche Agenten/Services betroffen?\n"
                "3. **Root Cause** — Vermutete Ursache\n"
                "4. **Mitigation** — Sofort-Massnahmen\n"
                "5. **Eskalation** — Muss ARCHITECT/Christian informiert werden?"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        priority = MessagePriority.CRITICAL if task == "incident_response" else MessagePriority.LOW

        await self.send_message(
            channels=["#ops"],
            content={"report": response, "task": task},
            message_type=MessageType.HEALTH_CHECK,
            priority=priority,
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
