"""Ghost Protocol — Operator Agent (THE OPERATOR).

COO / Chief Operating Officer.
Operations Excellence, SLA-Management, Pipeline-Optimierung, Bottleneck-Detection.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class OperatorAgent(BaseAgent):
    """THE OPERATOR — Chief Operating Officer."""

    def __init__(self):
        config = AgentConfig(
            name="operator",
            role="Chief Operating Officer — Workflow/SLA/QA, Pipeline-Optimierung",
            tier=AgentTier.C_SUITE,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.2,
            channels=["#boardroom", "#ops", "#emergency"],
            tools=[],
            knowledge_tags=["operations", "sla", "pipeline"],
        )
        super().__init__(config)

    async def execute(self, task: str = "ops_review", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "ops_review":
            prompt = (
                "Erstelle ein Operations Review:\n"
                "1. **SLA-Status** — Welche SLAs werden eingehalten, welche verletzt?\n"
                "2. **Pipeline-Durchsatz** — Content, Revenue, Support Pipelines\n"
                "3. **Bottlenecks** — Wo staut es sich?\n"
                "4. **Optimierungen** — Konkrete Verbesserungsvorschlaege\n"
                "5. **Eskalationen** — Was muss DONNA/ARCHITECT wissen?"
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
