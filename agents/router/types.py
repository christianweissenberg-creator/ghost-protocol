"""Ghost Protocol — Model Router Types.

Shared data structures for the multi-model routing system.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Provider(Enum):
    """Supported LLM providers."""
    ANTHROPIC = "anthropic"
    PERPLEXITY = "perplexity"
    GEMINI = "gemini"
    QWEN = "qwen"


class TaskCategory(Enum):
    """Task categories that determine model routing.

    Each category maps to the optimal provider for cost/quality tradeoff.
    """
    RESEARCH = "research"             # Real-time web search + synthesis → Perplexity
    SCORING_CRITICAL = "scoring_critical"  # High-impact analysis → Claude Sonnet
    SCORING_ROUTINE = "scoring_routine"    # Standard scoring runs → Qwen
    ANALYSIS = "analysis"             # Deep strategic analysis → Claude Sonnet
    FORMATTING = "formatting"         # Content formatting, SEO → Gemini Flash
    DRAFTING = "drafting"             # Newsletter/blog drafts → Qwen or Gemini
    TRANSLATION = "translation"       # DACH localization → Qwen or Gemini
    GENERAL = "general"               # Default → follows agent's configured model


@dataclass
class LLMResponse:
    """Unified response from any LLM provider."""
    text: str
    provider: Provider
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    duration_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class RoutingRule:
    """Maps a task category to a provider with fallback."""
    category: TaskCategory
    primary: Provider
    fallback: Provider = Provider.ANTHROPIC
    primary_model: str = ""
    fallback_model: str = "claude-sonnet-5"


# Default routing table — optimized for Ghost Protocol cost/quality
DEFAULT_ROUTING: list[RoutingRule] = [
    RoutingRule(
        category=TaskCategory.RESEARCH,
        primary=Provider.PERPLEXITY,
        primary_model="sonar-pro",
        fallback_model="claude-sonnet-5",
    ),
    RoutingRule(
        category=TaskCategory.SCORING_CRITICAL,
        primary=Provider.ANTHROPIC,
        primary_model="claude-sonnet-5",
    ),
    RoutingRule(
        category=TaskCategory.SCORING_ROUTINE,
        primary=Provider.QWEN,
        primary_model="qwen-max",
        fallback_model="claude-haiku-4-5-20251001",
    ),
    RoutingRule(
        category=TaskCategory.ANALYSIS,
        primary=Provider.ANTHROPIC,
        primary_model="claude-sonnet-5",
    ),
    RoutingRule(
        category=TaskCategory.FORMATTING,
        primary=Provider.GEMINI,
        primary_model="gemini-2.5-flash",
        fallback_model="claude-haiku-4-5-20251001",
    ),
    RoutingRule(
        category=TaskCategory.DRAFTING,
        primary=Provider.GEMINI,
        fallback=Provider.QWEN,
        primary_model="gemini-2.5-flash",
        fallback_model="qwen-max",
    ),
    RoutingRule(
        category=TaskCategory.TRANSLATION,
        primary=Provider.QWEN,
        primary_model="qwen-max",
        fallback_model="claude-haiku-4-5-20251001",
    ),
    RoutingRule(
        category=TaskCategory.GENERAL,
        primary=Provider.ANTHROPIC,
        primary_model="claude-sonnet-5",
    ),
]
