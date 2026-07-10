"""Ghost Protocol — Localizer Agent (THE LOCALIZER).

Cultural Intelligence & SEO Localization.
DE↔EN Transcreation, DACH SEO Keywords, Regulatorische Terminologie.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
Laeuft auf Haiku (Routine-Lokalisierung, kosteneffizient).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class LocalizerAgent(BaseAgent):
    """THE LOCALIZER — Cultural Intelligence."""

    def __init__(self):
        config = AgentConfig(
            name="localizer",
            role="Cultural Intelligence — DACH-Lokalisierung, SEO, Transcreation",
            tier=AgentTier.OPERATOR,
            llm_model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            temperature=0.3,
            channels=["#content"],
            tools=[],
            knowledge_tags=["localization", "seo", "dach", "glossary"],
        )
        super().__init__(config)

    async def execute(self, task: str = "localize", **kwargs) -> dict[str, Any]:
        context = kwargs.get("context_data", "")
        source_text = kwargs.get("source_text", "")
        target_lang = kwargs.get("target_lang", "de")

        if source_text:
            context = f"## Quelltext\n{source_text}\n\n{context}"

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "localize":
            prompt = (
                f"Lokalisiere den folgenden Text nach {'Deutsch (DACH)' if target_lang == 'de' else 'Englisch'}.\n\n"
                "Regeln:\n"
                "- TRANSCREATION, nicht Uebersetzung (kulturelle Anpassung)\n"
                "- DACH-spezifische Begriffe verwenden (z.B. 'Kryptowährung' statt 'Crypto')\n"
                "- SEO-Keywords fuer den Zielmarkt optimieren\n"
                "- Regulatorische Begriffe korrekt uebersetzen (MiCA, BaFin-Terminologie)\n"
                "- Natuerlicher Ton, keine steifen Uebersetzungen"
            )
        elif task == "seo_keywords":
            prompt = (
                "Erstelle eine DACH-SEO-Keyword-Analyse:\n"
                "1. **Haupt-Keywords** (5-10) mit geschaetztem Suchvolumen\n"
                "2. **Long-Tail Keywords** (10-15)\n"
                "3. **DACH vs EN Unterschiede** — Welche Keywords unterscheiden sich?\n"
                "4. **Empfehlung** — Welche Keywords priorisieren?"
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        await self.send_message(
            channels=["#content"],
            content={"localized": response, "target_lang": target_lang, "task": task},
            message_type=MessageType.TASK_RESULT,
            priority=MessagePriority.LOW,
        )

        return {
            "status": "success",
            "output": response,
            "target_lang": target_lang,
            "cost_usd": self._total_cost_usd,
        }
