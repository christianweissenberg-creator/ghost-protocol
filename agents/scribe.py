"""Ghost Protocol — Scribe Agent (THE SCRIBE).

Content Producer — Long-Form Authority, Short-Form Hooks, Conversion Copy.
Produziert Blog Posts, X Threads, Newsletter, Sales Pages.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class ScribeAgent(BaseAgent):
    """THE SCRIBE — Content Producer."""

    def __init__(self):
        config = AgentConfig(
            name="scribe",
            role="Content Producer — Blog, Newsletter, Social, Sales Copy",
            tier=AgentTier.OPERATOR,
            llm_model="claude-sonnet-5",
            max_tokens=4096,
            temperature=0.6,
            channels=["#content"],
            tools=["mailerlite"],
            knowledge_tags=["content", "copywriting", "seo"],
        )
        super().__init__(config)

    async def execute(self, task: str = "write_content", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        content_type = kwargs.get("content_type", "blog_post")
        topic = kwargs.get("topic", "")

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        prompts = {
            "blog_post": (
                f"Schreibe einen SEO-optimierten Blog Post zum Thema: {topic}\n\n"
                "Format: 800-1500 Woerter, Deutsch, DACH-Zielgruppe.\n"
                "Struktur: Hook → Problem → Loesung → CTA\n"
                "WICHTIG: Pflicht-Disclaimer am Ende einfuegen."
            ),
            "newsletter": (
                f"Schreibe Newsletter-Content zum Thema: {topic}\n\n"
                "Format: 500-800 Woerter, persoenlicher Ton, Deutsch.\n"
                "Struktur: Betreff-Vorschlag, Preview-Text, Body, CTA\n"
                "WICHTIG: Pflicht-Disclaimer einfuegen."
            ),
            "x_thread": (
                f"Schreibe einen X Thread (5-10 Tweets) zum Thema: {topic}\n\n"
                "Format: Deutsch, Hook im ersten Tweet, CTA im letzten.\n"
                "Jeder Tweet max 280 Zeichen."
            ),
            "sales_page": (
                f"Schreibe Sales Page Copy fuer: {topic}\n\n"
                "Format: Hormozi-Style — Hook → Pain → Solution → Offer → CTA\n"
                "Deutsch, DACH-Markt, Trust-Building.\n"
                "WICHTIG: Pflicht-Disclaimer einfuegen."
            ),
        }

        prompt = prompts.get(content_type, task if task != "write_content" else prompts["blog_post"])
        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#content"],
            content={"content": response, "type": content_type, "topic": topic},
            message_type=MessageType.CONTENT_DRAFT,
            priority=MessagePriority.NORMAL,
            requires_legal_review=True,
        )

        return {
            "status": "success",
            "output": response,
            "content_type": content_type,
            "cost_usd": self._total_cost_usd,
        }
