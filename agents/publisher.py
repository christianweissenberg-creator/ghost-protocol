"""Ghost Protocol — Publisher Agent (THE PUBLISHER).

CMO / Chief Marketing Officer.
Content-Strategie, Distribution, Conversion-Optimierung.
Recycelt 1 Intelligence Report in 30+ Micro-Content-Pieces.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class PublisherAgent(BaseAgent):
    """THE PUBLISHER — Chief Marketing Officer."""

    def __init__(self):
        config = AgentConfig(
            name="publisher",
            role="Chief Marketing Officer — Content/SEO/Social, Distribution-Strategie",
            tier=AgentTier.C_SUITE,
            llm_model="claude-sonnet-4-20250514",
            max_tokens=4096,
            temperature=0.4,
            channels=["#boardroom", "#content", "#growth"],
            tools=["mailerlite"],
            knowledge_tags=["marketing", "content", "seo", "social"],
        )
        super().__init__(config)

    async def execute(self, task: str = "content_strategy", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "content_strategy":
            prompt = (
                "Erstelle einen Content-Plan fuer diese Woche:\n"
                "1. **Newsletter** — Thema, Hook, CTA\n"
                "2. **X Posts** (3-5) — Hooks, Threads, Engagement-Taktik\n"
                "3. **LinkedIn** (1-2) — Authority-Content fuer DACH\n"
                "4. **SEO Blog** — Keyword-Fokus, Struktur\n"
                "5. **Content Recycling** — Welcher alte Content kann wiederverwendet werden?\n\n"
                "Zielgruppe: DACH Krypto-Investoren, 25-45, technikaffin."
            )
        elif task == "review_content":
            prompt = (
                "Bewerte den folgenden Content:\n"
                "1. Hook-Staerke (1-10)\n"
                "2. Engagement-Potenzial (1-10)\n"
                "3. CTA-Klarheit (1-10)\n"
                "4. DACH-Relevanz (1-10)\n"
                "5. Verbesserungsvorschlaege\n"
                "6. Disclaimer vorhanden? Pflicht fuer alle Finanz-Inhalte."
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#content"],
            content={"plan": response, "task": task},
            message_type=MessageType.CONTENT_DRAFT,
            priority=MessagePriority.NORMAL,
        )

        return {"status": "success", "output": response, "cost_usd": self._total_cost_usd}
