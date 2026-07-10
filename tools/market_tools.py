"""Ghost Protocol — Market Intelligence Tools.

Standalone-Funktionen für Marktdaten und News-Suche.
Kein CrewAI-Dependency — direkte HTTP-Calls via httpx.

Genutzt von: OracleAgent, PublisherAgent, TraderAgent
"""

import json
import logging
from typing import Any

import httpx

from agents.config import SERPER_API_KEY, TIMEOUT_SECONDS

logger: logging.Logger = logging.getLogger(__name__)


def search_crypto_news(query: str, num_results: int = 6) -> list[dict[str, str]]:
    """Sucht aktuelle Krypto-News via Serper API (letzte 24h).

    Args:
        query: Suchbegriff (z.B. "crypto market news today")
        num_results: Anzahl Ergebnisse (max 10)

    Returns:
        Liste von {title, snippet, source, date}
    """
    url = "https://google.serper.dev/news"
    headers = {"X-API-KEY": SERPER_API_KEY or "", "Content-Type": "application/json"}
    payload = {"q": query, "num": min(num_results, 10), "tbs": "qdr:d"}

    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return [
            {
                "title": n.get("title", ""),
                "snippet": n.get("snippet", ""),
                "source": n.get("source", ""),
                "date": n.get("date", ""),
            }
            for n in r.json().get("news", [])[:num_results]
        ]
    except httpx.TimeoutException:
        logger.error("Timeout: Serper crypto news search '%s'", query)
        return []
    except Exception as e:
        logger.error("Fehler bei crypto news search: %s", e)
        return []


def get_market_data(symbols: str) -> dict[str, Any]:
    """Holt aktuelle Preisdaten von CoinGecko (EUR + USD).

    Args:
        symbols: Komma-getrennte CoinGecko-IDs (z.B. "bitcoin,ethereum,solana")

    Returns:
        Dict mit Preis, 24h-Change und Market Cap pro Symbol
    """
    url = (
        f"https://api.coingecko.com/api/v3/simple/price"
        f"?ids={symbols}&vs_currencies=eur,usd"
        f"&include_24hr_change=true&include_market_cap=true"
    )
    try:
        r = httpx.get(url, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return r.json()
    except httpx.TimeoutException:
        logger.error("Timeout: CoinGecko market data")
        return {}
    except Exception as e:
        logger.error("Fehler bei market data: %s", e)
        return {}


def search_dach_news(query: str, num_results: int = 6) -> list[dict[str, str]]:
    """Sucht deutschsprachige Krypto-News im DACH-Raum.

    Args:
        query: Suchbegriff auf Deutsch
        num_results: Anzahl Ergebnisse

    Returns:
        Liste von {title, snippet, source}
    """
    url = "https://google.serper.dev/news"
    headers = {"X-API-KEY": SERPER_API_KEY or "", "Content-Type": "application/json"}
    payload = {"q": query, "gl": "de", "hl": "de", "num": min(num_results, 10)}

    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return [
            {
                "title": n.get("title", ""),
                "snippet": n.get("snippet", ""),
                "source": n.get("source", ""),
            }
            for n in r.json().get("news", [])[:num_results]
        ]
    except httpx.TimeoutException:
        logger.error("Timeout: Serper DACH news search '%s'", query)
        return []
    except Exception as e:
        logger.error("Fehler bei DACH news search: %s", e)
        return []


def search_web(query: str, num_results: int = 8, lang: str = "de") -> list[dict[str, str]]:
    """Allgemeine Websuche via Serper API.

    Args:
        query: Suchbegriff
        num_results: Anzahl Ergebnisse
        lang: Sprache ("de" oder "en")

    Returns:
        Liste von {title, snippet, link}
    """
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY or "", "Content-Type": "application/json"}
    payload: dict[str, Any] = {"q": query, "num": min(num_results, 10)}
    if lang == "de":
        payload.update({"gl": "de", "hl": "de"})

    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        return [
            {
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "link": item.get("link", ""),
            }
            for item in r.json().get("organic", [])[:num_results]
        ]
    except httpx.TimeoutException:
        logger.error("Timeout: Serper web search '%s'", query)
        return []
    except Exception as e:
        logger.error("Fehler bei web search: %s", e)
        return []


def format_market_data(data: dict[str, Any]) -> str:
    """Formatiert CoinGecko-Daten als lesbaren Text für Agent-Context.

    Args:
        data: Output von get_market_data()

    Returns:
        Formatierter Markdown-String
    """
    if not data:
        return "Keine Marktdaten verfuegbar."

    lines = ["## Aktuelle Marktdaten\n"]
    for symbol, info in data.items():
        eur = info.get("eur", "N/A")
        usd = info.get("usd", "N/A")
        change_24h = info.get("eur_24h_change", 0)
        mcap = info.get("eur_market_cap", 0)

        direction = "+" if change_24h >= 0 else ""
        lines.append(
            f"- **{symbol.upper()}**: {eur:,.2f} EUR / {usd:,.2f} USD "
            f"({direction}{change_24h:.1f}% 24h) | MCap: {mcap/1e9:,.1f} Mrd EUR"
        )
    return "\n".join(lines)


def format_news(news: list[dict[str, str]], header: str = "News") -> str:
    """Formatiert News-Ergebnisse als lesbaren Text fuer Agent-Context."""
    if not news:
        return f"Keine {header} verfuegbar."

    lines = [f"## {header}\n"]
    for i, item in enumerate(news, 1):
        title = item.get("title", "Ohne Titel")
        snippet = item.get("snippet", "")
        source = item.get("source", "")
        lines.append(f"{i}. **{title}** ({source})\n   {snippet}\n")
    return "\n".join(lines)
