"""Ghost Protocol — LLM Provider Clients.

Each provider implements the same interface: complete() → LLMResponse.
Graceful degradation: if a provider SDK is missing or key not set, it's marked unavailable.
"""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from typing import Any

import httpx

from agents.router.types import LLMResponse, Provider

logger = logging.getLogger(__name__)

# Provider pricing per 1M tokens (USD)
PRICING: dict[str, dict[str, float]] = {
    # Anthropic
    "claude-sonnet-5": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.25, "output": 1.25},
    # Perplexity
    "sonar-pro": {"input": 3.0, "output": 15.0},
    "sonar": {"input": 1.0, "output": 1.0},
    # Gemini
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.0},
    # Qwen (DashScope Frankfurt, ≤32K context)
    "qwen-max": {"input": 0.36, "output": 1.43},
    "qwen-plus": {"input": 0.14, "output": 0.57},
}


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost in USD for a single API call."""
    costs = PRICING.get(model, {"input": 3.0, "output": 15.0})
    return (input_tokens * costs["input"] + output_tokens * costs["output"]) / 1_000_000


class BaseLLMProvider(ABC):
    """Base class for LLM provider clients."""

    provider: Provider
    available: bool = False

    @abstractmethod
    async def complete(
        self,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        """Send a completion request and return unified response."""
        ...

    def _elapsed_ms(self, start: float) -> int:
        return int((time.monotonic() - start) * 1000)


class AnthropicProvider(BaseLLMProvider):
    """Claude via Anthropic API."""

    provider = Provider.ANTHROPIC

    def __init__(self) -> None:
        self.api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        self.available = bool(self.api_key)
        self._client = None
        if self.available:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=self.api_key)
            except ImportError:
                self.available = False
                logger.warning("anthropic SDK not installed")

    async def complete(
        self,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        start = time.monotonic()
        # temperature bewusst NICHT übergeben — bei Claude-4.5+/5-Modellen deprecated (API 400)
        response = self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
        return LLMResponse(
            text=response.content[0].text,
            provider=self.provider,
            model=model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cost_usd=calculate_cost(model, response.usage.input_tokens, response.usage.output_tokens),
            duration_ms=self._elapsed_ms(start),
        )


class PerplexityProvider(BaseLLMProvider):
    """Perplexity Sonar via OpenAI-compatible API."""

    provider = Provider.PERPLEXITY

    def __init__(self) -> None:
        self.api_key = os.environ.get("PERPLEXITY_API_KEY", "")
        self.available = bool(self.api_key)
        self.base_url = "https://api.perplexity.ai"

    async def complete(
        self,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_message},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]["message"]
        usage = data.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        return LLMResponse(
            text=choice["content"],
            provider=self.provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=calculate_cost(model, input_tokens, output_tokens),
            duration_ms=self._elapsed_ms(start),
            metadata={"citations": data.get("citations", [])},
        )


class GeminiProvider(BaseLLMProvider):
    """Google Gemini via REST API."""

    provider = Provider.GEMINI

    def __init__(self) -> None:
        self.api_key = os.environ.get("GOOGLE_AI_API_KEY", "")
        self.available = bool(self.api_key)
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    async def complete(
        self,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        start = time.monotonic()
        url = f"{self.base_url}/models/{model}:generateContent?key={self.api_key}"

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                json={
                    "system_instruction": {"parts": [{"text": system}]},
                    "contents": [{"parts": [{"text": user_message}]}],
                    "generationConfig": {
                        "maxOutputTokens": max_tokens,
                        "temperature": temperature,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        usage = data.get("usageMetadata", {})
        input_tokens = usage.get("promptTokenCount", 0)
        output_tokens = usage.get("candidatesTokenCount", 0)

        return LLMResponse(
            text=text,
            provider=self.provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=calculate_cost(model, input_tokens, output_tokens),
            duration_ms=self._elapsed_ms(start),
        )


class QwenProvider(BaseLLMProvider):
    """Alibaba Qwen via DashScope API (Frankfurt endpoint, DSGVO-compliant)."""

    provider = Provider.QWEN

    def __init__(self) -> None:
        self.api_key = os.environ.get("DASHSCOPE_API_KEY", "")
        self.available = bool(self.api_key)
        # Frankfurt endpoint for EU data residency
        self.base_url = os.environ.get(
            "DASHSCOPE_BASE_URL",
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )

    async def complete(
        self,
        model: str,
        system: str,
        user_message: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_message},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]["message"]
        usage = data.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        return LLMResponse(
            text=choice["content"],
            provider=self.provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=calculate_cost(model, input_tokens, output_tokens),
            duration_ms=self._elapsed_ms(start),
        )
