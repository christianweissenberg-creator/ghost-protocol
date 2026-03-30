"""Ghost Protocol — Oracle Agent (THE ORACLE).

Scannt Krypto-Märkte, News, On-Chain-Daten und Social Sentiment.
Liefert tägliches Intelligence Briefing als Feed für alle anderen Agenten.

Wird täglich via GitHub Actions oder Cron getriggert.
Output: outputs/briefing_{YYYY-MM-DD}.md
"""

import json
import logging
from datetime import datetime

import httpx
from crewai import Agent, Task
from crewai.tools import tool

from agents.config import (
    DISCLAIMER_DE,
    LLM_COMPLEX,
    SERPER_API_KEY,
    TIMEOUT_SECONDS,
)

logger: logging.Logger = logging.getLogger(__name__)


@tool("Search crypto news")
def search_crypto_news(query: str) -> str:
    """Search for latest crypto and blockchain news. Returns top results from last 24h."""
    url = "https://google.serper.dev/news"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {"q": query, "num": 8, "tbs": "qdr:d"}
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("news", [])
        return json.dumps([
            {"title": n.get("title", ""), "snippet": n.get("snippet", ""),
             "source": n.get("source", ""), "date": n.get("date", "")}
            for n in results[:6]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei Crypto News Search: %s", query)
        return "Error: Request timeout — Serper API nicht erreichbar."
    except httpx.HTTPStatusError as e:
        logger.error("HTTP-Fehler bei News Search: %s", e)
        return f"Error: HTTP {e.response.status_code}"
    except Exception as e:
        logger.error("Unerwarteter Fehler bei News Search: %s", e)
        return f"Error: {e}"


@tool("Get crypto market data")
def get_market_data(symbols: str) -> str:
    """Get current price data for crypto assets.

    Input: comma-separated symbols like 'bitcoin,ethereum,solana'.
    Returns EUR/USD prices, 24h change, and market cap.
    """
    url = (
        f"https://api.coingecko.com/api/v3/simple/price"
        f"?ids={symbols}&vs_currencies=eur,usd"
        f"&include_24hr_change=true&include_market_cap=true"
    )
    try:
        r = httpx.get(url, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return json.dumps(r.json(), indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei CoinGecko Market Data")
        return "Error: CoinGecko timeout."
    except httpx.HTTPStatusError as e:
        logger.error("HTTP-Fehler bei Market Data: %s", e)
        return f"Error: HTTP {e.response.status_code}"
    except Exception as e:
        logger.error("Unerwarteter Fehler bei Market Data: %s", e)
        return f"Error fetching market data: {e}"


@tool("Search DACH crypto news")
def search_dach_news(query: str) -> str:
    """Search for German-language crypto news in the DACH region (DE/AT/CH)."""
    url = "https://google.serper.dev/news"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {"q": query, "gl": "de", "hl": "de", "num": 6}
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("news", [])
        return json.dumps([
            {"title": n.get("title", ""), "snippet": n.get("snippet", ""),
             "source": n.get("source", "")}
            for n in results[:6]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei DACH News Search: %s", query)
        return "Error: Request timeout."
    except httpx.HTTPStatusError as e:
        logger.error("HTTP-Fehler bei DACH News: %s", e)
        return f"Error: HTTP {e.response.status_code}"
    except Exception as e:
        logger.error("Unerwarteter Fehler bei DACH News: %s", e)
        return f"Error: {e}"


oracle: Agent = Agent(
    role="Chief Market Intelligence Analyst",
    goal=(
        "Erstelle ein tägliches Intelligence Briefing das die wichtigsten "
        "Marktbewegungen, regulatorischen Entwicklungen und Opportunities "
        "im Kryptomarkt zusammenfasst — mit Fokus auf den DACH-Raum. "
        "Das Briefing muss in 3 Minuten lesbar sein und konkrete "
        "Handlungsimpulse liefern."
    ),
    backstory=(
        "Du bist ein erfahrener Krypto-Analyst mit 8 Jahren Markterfahrung. "
        "Du kombinierst On-Chain-Daten, Fundamentalanalyse, Makroanalyse und "
        "Sentiment-Analyse zu einem ganzheitlichen Bild. Du bist bekannt für "
        "präzise, nüchterne Analysen ohne Hype. Dein Markenzeichen: Du "
        "identifizierst Risiken bevor sie eintreten und Chancen bevor der "
        "Mainstream sie erkennt. Du schreibst auf Deutsch, prägnant und "
        "datengestützt."
    ),
    tools=[search_crypto_news, get_market_data, search_dach_news],
    verbose=True,
    max_iter=6,
    llm=LLM_COMPLEX,
    allow_delegation=False,
)


def create_daily_briefing_task() -> Task:
    """Erstellt den täglichen Intelligence Briefing Task."""
    today: str = datetime.now().strftime("%d.%m.%Y")
    return Task(
        description=f"""
        Erstelle das Daily Intelligence Briefing für {today}.

        1. MARKTDATEN: Hole aktuelle Preise für bitcoin, ethereum, solana, bnb
        2. TOP NEWS GLOBAL: Suche "crypto market news today"
        3. DACH NEWS: Suche "Krypto Nachrichten Deutschland" und "Bitcoin Regulierung EU"
        4. REGULATORIK: Suche "crypto regulation EU MiCA 2026"

        Erstelle ein Briefing mit:
        - 📊 Marktüberblick (3-4 Sätze, mit exakten Zahlen)
        - 🔥 Top 3 Nachrichten (je 2-3 Sätze, Relevanz-Bewertung)
        - 🇩🇪 DACH-Relevanz (Was bedeutet das für deutsche Investoren?)
        - ⚠️ Risiken / Red Flags (falls vorhanden)
        - 💡 Opportunity der Woche (1 konkreter, recherchierter Insight)

        Schreibe auf Deutsch. Faktenbasiert. Keine Spekulation als Fakt framen.
        Am Ende: {DISCLAIMER_DE}
        """,
        expected_output=(
            "Ein vollständiges Daily Intelligence Briefing auf Deutsch, "
            "~400-600 Wörter, strukturiert mit Emoji-Headern."
        ),
        agent=oracle,
    )
