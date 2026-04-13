"""
Ghost Protocol — Agent Runner
================================
Führt einen Agent-Prompt über den Multi-Model Router aus.
Minimaler API-Verbrauch: Ein Call pro Task.
Routing: Tasks werden basierend auf Kategorie an den optimalen Provider geroutet.

Usage:
    runner = AgentRunner()
    result = runner.run("SCRIBE", task="Schreibe Newsletter #2", context={...})
    result = runner.run("ORACLE", task="BTC-Analyse", category="research")
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from agents.router import get_router, TaskCategory, Provider
from agents.router.providers import calculate_cost


# ── Agent Registry ─────────────────────────────────

AGENT_MODELS = {
    # Tier 0 — Brain (Sonnet für komplexe Orchestrierung)
    "DONNA": "claude-sonnet-4-20250514",
    "STRATEGIST": "claude-sonnet-4-20250514",
    # Tier 1 — C-Suite
    "OPERATOR": "claude-sonnet-4-20250514",
    "ORACLE": "claude-sonnet-4-20250514",
    "ARCHITECT": "claude-sonnet-4-20250514",
    "TREASURER": "claude-haiku-4-5-20251001",
    "PUBLISHER": "claude-sonnet-4-20250514",
    "COUNSEL": "claude-sonnet-4-20250514",
    # Tier 2 — Directors
    "AMPLIFIER": "claude-sonnet-4-20250514",
    "MERCHANT": "claude-sonnet-4-20250514",
    "RESEARCHER": "claude-sonnet-4-20250514",
    # Tier 3 — Operators (Haiku für Kosteneffizienz)
    "SCRIBE": "claude-sonnet-4-20250514",
    "TRADER": "claude-sonnet-4-20250514",
    "GUARDIAN": "claude-haiku-4-5-20251001",
    "CONCIERGE": "claude-haiku-4-5-20251001",
    "LOCALIZER": "claude-haiku-4-5-20251001",
}

# Default task categories per agent (can be overridden per call)
AGENT_DEFAULT_CATEGORY: dict[str, TaskCategory] = {
    "ORACLE": TaskCategory.ANALYSIS,
    "RESEARCHER": TaskCategory.RESEARCH,
    "TRADER": TaskCategory.SCORING_CRITICAL,
    "SCRIBE": TaskCategory.DRAFTING,
    "PUBLISHER": TaskCategory.DRAFTING,
    "AMPLIFIER": TaskCategory.FORMATTING,
    "LOCALIZER": TaskCategory.TRANSLATION,
    "TREASURER": TaskCategory.GENERAL,
    "GUARDIAN": TaskCategory.GENERAL,
    "CONCIERGE": TaskCategory.GENERAL,
}

PROMPTS_DIR = Path(__file__).parent.parent / "agents" / "prompts"


class AgentRunner:
    """Führt Agent-Tasks über den Multi-Model Router aus.

    Prinzipien:
    - Ein API-Call pro Task (kein Chat, kein Multi-Turn)
    - System Prompt = Agent-Persönlichkeit (.md Datei)
    - User Message = konkreter Task + Kontext
    - Routing: Task-Kategorie bestimmt Provider (Claude, Perplexity, Gemini, Qwen)
    - Kostentracking pro Call mit Provider-Info
    """

    def __init__(self, api_key: str | None = None):
        self.router = get_router()
        self.cost_log: list[dict] = []

    def _load_prompt(self, agent_name: str) -> str:
        """Lädt den System-Prompt eines Agenten aus der .md Datei."""
        prompt_file = PROMPTS_DIR / f"{agent_name.lower()}.md"
        if not prompt_file.exists():
            raise FileNotFoundError(f"Agent-Prompt nicht gefunden: {prompt_file}")
        return prompt_file.read_text(encoding="utf-8")

    def _get_model(self, agent_name: str) -> str:
        """Gibt das konfigurierte LLM-Modell für den Agenten zurück."""
        return AGENT_MODELS.get(agent_name.upper(), "claude-haiku-4-5-20251001")

    def _get_category(self, agent_name: str, category: str | None = None) -> TaskCategory:
        """Bestimmt die Task-Kategorie für Routing."""
        if category:
            try:
                return TaskCategory(category)
            except ValueError:
                pass
        return AGENT_DEFAULT_CATEGORY.get(agent_name.upper(), TaskCategory.GENERAL)

    def _track_cost(self, agent: str, model: str, provider: str, input_tokens: int, output_tokens: int) -> float:
        """Trackt API-Kosten pro Call mit Provider-Info."""
        cost_usd = calculate_cost(model, input_tokens, output_tokens)

        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent": agent,
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
        }
        self.cost_log.append(entry)
        return cost_usd

    def run(
        self,
        agent_name: str,
        task: str,
        context: dict[str, Any] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        category: str | None = None,
    ) -> dict[str, Any]:
        """Führt einen Task mit dem angegebenen Agenten aus.

        Args:
            agent_name: Name des Agenten (z.B. "SCRIBE", "COUNSEL")
            task: Konkreter Arbeitsauftrag
            context: Zusätzlicher Kontext (Daten, vorherige Ergebnisse)
            max_tokens: Max Output-Länge
            temperature: Kreativität (0.0=deterministisch, 1.0=kreativ)
            category: Task-Kategorie für Routing (optional, sonst Agent-Default)

        Returns:
            {
                "agent": str,
                "output": str,
                "provider": str,
                "model": str,
                "tokens": {"input": int, "output": int},
                "cost_usd": float,
                "duration_ms": int,
                "timestamp": str,
            }
        """
        agent_upper = agent_name.upper()
        system_prompt = self._load_prompt(agent_upper)
        task_category = self._get_category(agent_upper, category)

        # User Message zusammenbauen
        user_parts = [f"## Dein Task\n{task}"]
        if context:
            user_parts.append(f"\n## Kontext\n```json\n{json.dumps(context, indent=2, ensure_ascii=False)}\n```")

        user_message = "\n".join(user_parts)

        # Routed API Call
        response = self.router.complete_sync(
            system=system_prompt,
            user_message=user_message,
            category=task_category,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        cost = self._track_cost(
            agent_upper, response.model, response.provider.value,
            response.input_tokens, response.output_tokens,
        )

        return {
            "agent": agent_upper,
            "output": response.text,
            "provider": response.provider.value,
            "model": response.model,
            "category": task_category.value,
            "tokens": {"input": response.input_tokens, "output": response.output_tokens},
            "cost_usd": cost,
            "duration_ms": response.duration_ms,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def run_pipeline(
        self,
        steps: list[dict[str, Any]],
        shared_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Führt eine Pipeline von Agent-Tasks sequenziell aus.

        Jeder Step kann auf den Output des vorherigen zugreifen.
        Jeder Step kann eine eigene category für Routing mitgeben.

        Args:
            steps: Liste von {"agent": str, "task": str, "context_key": str, "category": str}
            shared_context: Gemeinsamer Kontext für alle Steps

        Returns:
            Liste aller Step-Ergebnisse
        """
        results = []
        pipeline_context = dict(shared_context or {})

        for i, step in enumerate(steps):
            agent = step["agent"]
            task = step["task"]
            context_key = step.get("context_key", f"step_{i}")
            category = step.get("category")

            # Vorherige Outputs als Kontext hinzufügen
            step_context = dict(pipeline_context)
            if results:
                step_context["previous_outputs"] = {
                    r["_context_key"]: r["output"][:2000]
                    for r in results
                    if "_context_key" in r
                }

            result = self.run(agent, task, context=step_context, category=category)
            result["_context_key"] = context_key
            result["_step"] = i
            results.append(result)

            pipeline_context[context_key] = result["output"][:2000]

        return results

    def get_total_cost(self) -> float:
        """Gesamtkosten aller API-Calls in dieser Session."""
        return sum(entry["cost_usd"] for entry in self.cost_log)

    def get_cost_summary(self) -> dict[str, Any]:
        """Kosten-Zusammenfassung pro Agent und Provider."""
        by_agent: dict[str, float] = {}
        by_provider: dict[str, float] = {}
        for entry in self.cost_log:
            agent = entry["agent"]
            provider = entry.get("provider", "anthropic")
            by_agent[agent] = by_agent.get(agent, 0) + entry["cost_usd"]
            by_provider[provider] = by_provider.get(provider, 0) + entry["cost_usd"]

        return {
            "total_usd": round(self.get_total_cost(), 4),
            "calls": len(self.cost_log),
            "by_agent": {k: round(v, 4) for k, v in sorted(by_agent.items())},
            "by_provider": {k: round(v, 4) for k, v in sorted(by_provider.items())},
        }
