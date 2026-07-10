"""Ghost Protocol — Product Research Tools.

Standalone-Funktionen fuer Markt- und Produktrecherche.
Scannt Gumroad, Etsy, Reddit und DACH-Maerkte nach Opportunities.

Genutzt von: ResearcherAgent, MerchantAgent
"""

import json
import logging
from typing import Any

import httpx

from agents.config import SERPER_API_KEY, TIMEOUT_SECONDS

logger: logging.Logger = logging.getLogger(__name__)


def _serper_search(query: str, num: int = 8, lang: str | None = None) -> list[dict[str, str]]:
    """Interne Hilfsfunktion fuer Serper-Websuche."""
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY or "", "Content-Type": "application/json"}
    payload: dict[str, Any] = {"q": query, "num": min(num, 10)}
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
            for item in r.json().get("organic", [])[:num]
        ]
    except httpx.TimeoutException:
        logger.error("Timeout: Serper search '%s'", query)
        return []
    except Exception as e:
        logger.error("Fehler bei Serper search: %s", e)
        return []


def search_gumroad_trends(query: str) -> list[dict[str, str]]:
    """Sucht trending Digital Products auf Gumroad.

    Args:
        query: Nische/Thema (z.B. "crypto trading template")

    Returns:
        Liste von {title, snippet, link}
    """
    return _serper_search(f"site:gumroad.com {query}", num=8)


def search_etsy_trends(query: str) -> list[dict[str, str]]:
    """Sucht Digital Downloads auf Etsy.

    Args:
        query: Produkt-Typ (z.B. "portfolio tracker template")

    Returns:
        Liste von {title, snippet, link}
    """
    return _serper_search(f"site:etsy.com digital download {query}", num=8)


def search_reddit_painpoints(query: str) -> list[dict[str, str]]:
    """Sucht Pain Points und Probleme auf Reddit.

    Findet Posts wo Leute Hilfe suchen oder frustriert sind
    = Produkt-Opportunities.

    Args:
        query: Thema (z.B. "crypto tax germany")

    Returns:
        Liste von {title, snippet, link}
    """
    return _serper_search(
        f"site:reddit.com {query} (need OR looking for OR wish OR help OR frustrated)",
        num=8,
    )


def search_dach_market_gaps(query: str) -> list[dict[str, str]]:
    """Sucht unterversorgte Nischen im DACH-Kryptomarkt.

    Args:
        query: Thema auf Deutsch

    Returns:
        Liste von {title, snippet, link}
    """
    return _serper_search(query, num=8, lang="de")


def gather_product_research(niche: str = "krypto") -> dict[str, Any]:
    """Fuehrt eine vollstaendige Produktrecherche fuer eine Nische durch.

    Kombiniert alle Research-Tools in einem Call:
    - Gumroad Trends
    - Etsy Trends
    - Reddit Pain Points
    - DACH Marktluecken

    Args:
        niche: Die zu untersuchende Nische

    Returns:
        Dict mit allen Recherche-Ergebnissen
    """
    queries = {
        "gumroad": f"{niche} template trading journal",
        "etsy": f"{niche} portfolio tracker planner",
        "reddit": f"{niche} tax germany tracking",
        "dach": f"{niche} steuer tool vorlage kaufen",
    }

    return {
        "gumroad_trends": search_gumroad_trends(queries["gumroad"]),
        "etsy_trends": search_etsy_trends(queries["etsy"]),
        "reddit_painpoints": search_reddit_painpoints(queries["reddit"]),
        "dach_gaps": search_dach_market_gaps(queries["dach"]),
    }


def format_research_data(data: dict[str, Any]) -> str:
    """Formatiert Research-Daten als lesbaren Kontext fuer den Agent."""
    sections = []

    for key, results in data.items():
        label = key.replace("_", " ").title()
        if not results:
            sections.append(f"## {label}\nKeine Ergebnisse.\n")
            continue

        items = []
        for i, r in enumerate(results, 1):
            title = r.get("title", "N/A")
            snippet = r.get("snippet", "")
            items.append(f"{i}. **{title}**\n   {snippet}")

        sections.append(f"## {label}\n" + "\n".join(items) + "\n")

    return "\n---\n\n".join(sections)
