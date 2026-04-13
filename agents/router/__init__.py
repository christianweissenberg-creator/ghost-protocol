"""Ghost Protocol — Multi-Model Router.

Routes LLM requests to the optimal provider (Claude, Perplexity, Gemini, Qwen)
based on task category. Handles fallback when providers are unavailable.

Usage:
    from agents.router import get_router, TaskCategory

    router = get_router()
    response = await router.complete(
        system="You are ORACLE...",
        user_message="Analyse BTC...",
        category=TaskCategory.RESEARCH,
    )
    print(response.text, response.provider, response.cost_usd)
"""

from agents.router.router import ModelRouter, get_router
from agents.router.types import (
    DEFAULT_ROUTING,
    LLMResponse,
    Provider,
    RoutingRule,
    TaskCategory,
)

__all__ = [
    "ModelRouter",
    "get_router",
    "LLMResponse",
    "Provider",
    "RoutingRule",
    "TaskCategory",
    "DEFAULT_ROUTING",
]
