"""Ghost Protocol — Counsel Agent (THE COUNSEL).

CLO / Chief Legal Officer — DACH-Spezialist.
Prueft JEDEN oeffentlichen Output auf Compliance: MiCA, BaFin, DSGVO,
Steuerrecht. Blockiert illegale Inhalte. Gatekeeper fuer alle Publikationen.

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base_agent import AgentConfig, AgentTier, BaseAgent, MessagePriority, MessageType

logger: logging.Logger = logging.getLogger(__name__)


class CounselAgent(BaseAgent):
    """THE COUNSEL — Chief Legal Officer (DACH)."""

    def __init__(self):
        config = AgentConfig(
            name="counsel",
            role="Chief Legal Officer — MiCA/BaFin/DSGVO Compliance, Content-Gatekeeper",
            tier=AgentTier.C_SUITE,
            llm_model="claude-sonnet-5",
            max_tokens=4096,
            temperature=0.1,
            channels=["#boardroom", "#legal-review", "#content"],
            tools=[],
            knowledge_tags=["legal", "compliance", "mica", "bafin", "dsgvo", "tax"],
        )
        super().__init__(config)

    async def execute(self, task: str = "legal_review", **kwargs) -> dict[str, Any]:
        """Fuehrt Legal Review durch.

        Args:
            task: "legal_review", "disclaimer_check", oder freier Text
            **kwargs:
                content_to_review: Der zu pruefende Content
        """
        context = kwargs.get("context_data", "")
        content_to_review = kwargs.get("content_to_review", "")
        if content_to_review:
            context = f"## Zu pruefender Content\n{content_to_review}\n\n{context}"

        rag_context = await self.retrieve_knowledge(task)
        if rag_context:
            context = f"{rag_context}\n\n---\n\n{context}"

        if task == "legal_review":
            prompt = (
                "Fuehre ein Legal Review durch:\n\n"
                "Pruefe auf:\n"
                "1. **Anlageberatung** — Enthaelt der Text individuelle Empfehlungen? (VERBOTEN)\n"
                "2. **Disclaimer** — Ist der Pflicht-Disclaimer vorhanden?\n"
                "3. **MiCA/BaFin** — Verstoesst etwas gegen EU/DE Krypto-Regulierung?\n"
                "4. **DSGVO** — Werden personenbezogene Daten korrekt behandelt?\n"
                "5. **Affiliate** — Sind Affiliate-Links als Werbung gekennzeichnet?\n"
                "6. **Impressum** — Vollstaendige Angaben vorhanden?\n\n"
                "Ergebnis: APPROVED / CHANGES_REQUIRED / BLOCKED\n"
                "Bei CHANGES_REQUIRED: Exakte Aenderungen auflisten.\n"
                "Bei BLOCKED: Begruendung mit Rechtsgrundlage."
            )
        else:
            prompt = task

        response = await self.think(prompt, context=context)

        # Bestimme Status aus Response
        is_approved = "APPROVED" in response.upper() and "BLOCKED" not in response.upper()

        await self.send_message(
            channels=["#legal-review"],
            content={"review": response, "approved": is_approved, "task": task},
            message_type=MessageType.LEGAL_REVIEW_RESULT,
            priority=MessagePriority.HIGH,
        )

        return {
            "status": "success",
            "output": response,
            "approved": is_approved,
            "cost_usd": self._total_cost_usd,
        }
