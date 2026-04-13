"""Ghost Protocol — Model Router.

Routes LLM requests to the optimal provider based on task category.
Handles fallback chains when a provider is unavailable or fails.

Usage:
    router = ModelRouter()
    response = await router.complete(
        system="You are ORACLE...",
        user_message="Analyse BTC market...",
        category=TaskCategory.RESEARCH,
    )
"""

from __future__ import annotations

import logging
from typing import Any

from agents.router.providers import (
    AnthropicProvider,
    BaseLLMProvider,
    GeminiProvider,
    PerplexityProvider,
    QwenProvider,
)
from agents.router.types import (
    DEFAULT_ROUTING,
    LLMResponse,
    Provider,
    RoutingRule,
    TaskCategory,
)

logger = logging.getLogger(__name__)


class ModelRouter:
    """Routes LLM requests to optimal providers with automatic fallback.

    On init, discovers which providers are available (API key set + SDK installed).
    On each request, picks the best provider for the task category and falls back
    if the primary is unavailable or errors out.
    """

    def __init__(self, routing_rules: list[RoutingRule] | None = None) -> None:
        # Initialize all providers
        self._providers: dict[Provider, BaseLLMProvider] = {
            Provider.ANTHROPIC: AnthropicProvider(),
            Provider.PERPLEXITY: PerplexityProvider(),
            Provider.GEMINI: GeminiProvider(),
            Provider.QWEN: QwenProvider(),
        }

        # Build routing lookup
        rules = routing_rules or DEFAULT_ROUTING
        self._routing: dict[TaskCategory, RoutingRule] = {
            rule.category: rule for rule in rules
        }

        # Log provider status on init
        for provider, client in self._providers.items():
            status = "available" if client.available else "unavailable"
            logger.info("Provider %s: %s", provider.value, status)

    @property
    def available_providers(self) -> list[Provider]:
        """List of providers with valid API keys."""
        return [p for p, c in self._providers.items() if c.available]

    def get_provider(self, provider: Provider) -> BaseLLMProvider | None:
        """Get a provider client, or None if unavailable."""
        client = self._providers.get(provider)
        if client and client.available:
            return client
        return None

    def resolve_route(self, category: TaskCategory) -> tuple[BaseLLMProvider, str]:
        """Resolve which provider + model to use for a task category.

        Returns the first available provider from: primary → fallback → anthropic.

        Raises:
            RuntimeError: If no provider is available at all.
        """
        rule = self._routing.get(category, self._routing[TaskCategory.GENERAL])

        # Try primary
        primary = self.get_provider(rule.primary)
        if primary:
            model = rule.primary_model or self._default_model(rule.primary)
            return primary, model

        # Try fallback
        fallback = self.get_provider(rule.fallback)
        if fallback:
            model = rule.fallback_model or self._default_model(rule.fallback)
            logger.info(
                "Fallback: %s → %s for %s",
                rule.primary.value, rule.fallback.value, category.value,
            )
            return fallback, model

        # Last resort: Anthropic (should always be available)
        anthropic = self.get_provider(Provider.ANTHROPIC)
        if anthropic:
            logger.warning("Double fallback to Anthropic for %s", category.value)
            return anthropic, "claude-sonnet-4-20250514"

        raise RuntimeError("No LLM provider available — check API keys")

    async def complete(
        self,
        system: str,
        user_message: str,
        category: TaskCategory = TaskCategory.GENERAL,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        force_provider: Provider | None = None,
        force_model: str | None = None,
    ) -> LLMResponse:
        """Route a completion request to the optimal provider.

        Args:
            system: System prompt
            user_message: User message / task
            category: Task category for routing decision
            max_tokens: Max output tokens
            temperature: Sampling temperature
            force_provider: Override routing, use this specific provider
            force_model: Override model selection

        Returns:
            LLMResponse from whichever provider handled the request
        """
        if force_provider:
            client = self.get_provider(force_provider)
            if not client:
                raise RuntimeError(f"Forced provider {force_provider.value} is not available")
            model = force_model or self._default_model(force_provider)
        else:
            client, model = self.resolve_route(category)
            if force_model:
                model = force_model

        try:
            response = await client.complete(
                model=model,
                system=system,
                user_message=user_message,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            logger.info(
                "Routed %s → %s/%s (%d tokens, $%.4f, %dms)",
                category.value, response.provider.value, response.model,
                response.total_tokens, response.cost_usd, response.duration_ms,
            )
            return response

        except Exception as e:
            logger.error("Provider %s failed: %s", client.provider.value, e)

            # Attempt fallback if not already on Anthropic
            if client.provider != Provider.ANTHROPIC:
                anthropic = self.get_provider(Provider.ANTHROPIC)
                if anthropic:
                    logger.info("Error fallback → Anthropic")
                    return await anthropic.complete(
                        model="claude-sonnet-4-20250514",
                        system=system,
                        user_message=user_message,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )
            raise

    def complete_sync(
        self,
        system: str,
        user_message: str,
        category: TaskCategory = TaskCategory.GENERAL,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        force_provider: Provider | None = None,
        force_model: str | None = None,
    ) -> LLMResponse:
        """Synchronous version for AgentRunner / cron jobs.

        Uses the Anthropic sync client for Anthropic calls,
        or runs async providers via asyncio for others.
        """
        import asyncio

        if force_provider:
            client = self.get_provider(force_provider)
            if not client:
                raise RuntimeError(f"Forced provider {force_provider.value} is not available")
            model = force_model or self._default_model(force_provider)
        else:
            client, model = self.resolve_route(category)
            if force_model:
                model = force_model

        # For Anthropic, use sync client directly (no event loop needed)
        if client.provider == Provider.ANTHROPIC and isinstance(client, AnthropicProvider):
            return self._anthropic_sync(client, model, system, user_message, max_tokens, temperature)

        # For other providers, run async in event loop
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(
                    asyncio.run,
                    client.complete(model, system, user_message, max_tokens, temperature),
                )
                return future.result(timeout=120)
        else:
            return asyncio.run(
                client.complete(model, system, user_message, max_tokens, temperature)
            )

    def _anthropic_sync(
        self,
        client: AnthropicProvider,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int,
        temperature: float,
    ) -> LLMResponse:
        """Direct sync call to Anthropic (avoids asyncio overhead for cron jobs)."""
        import time
        from agents.router.providers import calculate_cost

        start = time.monotonic()
        response = client._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
        elapsed = int((time.monotonic() - start) * 1000)

        return LLMResponse(
            text=response.content[0].text,
            provider=Provider.ANTHROPIC,
            model=model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cost_usd=calculate_cost(model, response.usage.input_tokens, response.usage.output_tokens),
            duration_ms=elapsed,
        )

    @staticmethod
    def _default_model(provider: Provider) -> str:
        """Default model for each provider."""
        return {
            Provider.ANTHROPIC: "claude-sonnet-4-20250514",
            Provider.PERPLEXITY: "sonar-pro",
            Provider.GEMINI: "gemini-2.5-flash",
            Provider.QWEN: "qwen-max",
        }[provider]


# Module-level singleton for shared use across agents
_router: ModelRouter | None = None


def get_router() -> ModelRouter:
    """Get or create the shared ModelRouter singleton."""
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router
