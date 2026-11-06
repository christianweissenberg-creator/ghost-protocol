"""Ghost Protocol — Test Configuration & Fixtures.

Stellt Mocks fuer Anthropic API und Supabase bereit,
damit Tests OHNE echte API-Calls und OHNE Kosten laufen.
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

# Projekt-Root in sys.path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Env-Variablen fuer Tests setzen (vor allen Imports)
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")
os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_KEY", "")
os.environ.setdefault("SERPER_API_KEY", "test-serper-key")


# ── Mock Anthropic Response ──────────────────────


@dataclass
class MockUsage:
    input_tokens: int = 150
    output_tokens: int = 300


@dataclass
class MockContentBlock:
    text: str = "Mock LLM response for testing."
    type: str = "text"


@dataclass
class MockAnthropicResponse:
    content: list = None
    usage: MockUsage = None

    def __post_init__(self):
        if self.content is None:
            self.content = [MockContentBlock()]
        if self.usage is None:
            self.usage = MockUsage()


def make_mock_response(text: str = "Mock LLM response for testing.") -> MockAnthropicResponse:
    """Erstellt eine konfigurierbare Mock-Response."""
    return MockAnthropicResponse(
        content=[MockContentBlock(text=text)],
        usage=MockUsage(),
    )


# ── Fixtures ─────────────────────────────────────


@pytest.fixture
def mock_anthropic():
    """Mockt den Anthropic Client — kein API-Call, kein Geld."""
    mock_client = MagicMock()
    mock_client.messages.create.return_value = make_mock_response()
    with patch("anthropic.Anthropic", return_value=mock_client):
        yield mock_client


@pytest.fixture
def mock_supabase():
    """Mockt den Supabase Client — kein DB-Call."""
    mock_client = MagicMock()
    # Insert returns itself for chaining
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value = MagicMock(data=[])
    mock_table.select.return_value.contains.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    mock_client.table.return_value = mock_table
    mock_client.rpc.return_value.execute.return_value = MagicMock(data=[])
    return mock_client


@pytest.fixture
def no_supabase():
    """Patcht Supabase weg — Agenten laufen ohne DB."""
    with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_KEY": ""}):
        with patch("agents.base_agent.create_client", side_effect=Exception("No Supabase in tests")):
            yield


@pytest.fixture
def mock_env():
    """Setzt alle noetigen Env-Variablen fuer Tests."""
    env = {
        "ANTHROPIC_API_KEY": "test-key-not-real",
        "SERPER_API_KEY": "test-serper-key",
        "SUPABASE_URL": "",
        "SUPABASE_KEY": "",
    }
    with patch.dict(os.environ, env):
        yield env


@pytest.fixture
def mock_serper_response():
    """Mock-Response fuer Serper API (News Search)."""
    return {
        "news": [
            {
                "title": "Bitcoin erreicht neues Hoch",
                "snippet": "BTC durchbricht die 100k Marke.",
                "link": "https://example.com/btc",
                "date": "2026-04-11",
                "source": "CoinDesk",
            },
            {
                "title": "EU MiCA tritt in Kraft",
                "snippet": "Neue Krypto-Regulierung ab Juni.",
                "link": "https://example.com/mica",
                "date": "2026-04-10",
                "source": "BTC-Echo",
            },
        ]
    }


@pytest.fixture
def mock_coingecko_response():
    """Mock-Response fuer CoinGecko API."""
    return {
        "bitcoin": {
            "usd": 105000,
            "usd_24h_change": 2.5,
            "usd_market_cap": 2100000000000,
        },
        "ethereum": {
            "usd": 3200,
            "usd_24h_change": -1.2,
            "usd_market_cap": 385000000000,
        },
    }
