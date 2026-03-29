"""Ghost Protocol â Product Research Agent (THE SCOUT).

Scannt Gumroad, Etsy, Reddit und Krypto-Communities um zu identifizieren
welche Produkte DACH-Krypto-Nutzer tatsÃ¤chlich kaufen wollen.
Liefert priorisierte Produkt-Ideen mit Revenue-SchÃ¤tzungen.

AusfÃ¼hrung: python -m agents.researcher
Output: outputs/product_research_report.md
"""

import json
import logging
import os
from pathlib import Path

import httpx
from crewai import Agent, Crew, Process, Task
from crewai.tools import tool

from agents.config import (
    DISCLAIMER_DE,
    LLM_COMPLEX,
    SERPER_API_KEY,
    TIMEOUT_SECONDS,
)

logger: logging.Logger = logging.getLogger(__name__)


# === Custom Tools ===

@tool("Search Gumroad trending products")
def search_gumroad_trends(query: str) -> str:
    """Search for trending digital products on Gumroad in a specific niche.

    Use this to understand what people actually BUY â real demand signals.
    """
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {"q": f"site:gumroad.com {query}", "num": 10}
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("organic", [])
        return json.dumps([
            {"title": item.get("title", ""), "snippet": item.get("snippet", ""),
             "link": item.get("link", "")}
            for item in results[:8]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei Gumroad Search: %s", query)
        return "Error: Gumroad search timeout."
    except Exception as e:
        logger.error("Fehler bei Gumroad Search: %s", e)
        return f"Error searching Gumroad: {e}"


@tool("Search Etsy digital products")
def search_etsy_trends(query: str) -> str:
    """Search for trending digital product listings on Etsy.

    Use this to find high-demand templates and digital downloads.
    """
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {"q": f"site:etsy.com digital download {query}", "num": 10}
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("organic", [])
        return json.dumps([
            {"title": item.get("title", ""), "snippet": item.get("snippet", ""),
             "link": item.get("link", "")}
            for item in results[:8]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei Etsy Search: %s", query)
        return "Error: Etsy search timeout."
    except Exception as e:
        logger.error("Fehler bei Etsy Search: %s", e)
        return f"Error searching Etsy: {e}"


@tool("Search Reddit pain points")
def search_reddit_painpoints(query: str) -> str:
    """Search Reddit for pain points and problems people describe in crypto/finance communities.

    These are product opportunities â real problems people would pay to solve.
    """
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {
        "q": f"site:reddit.com {query} (need OR looking for OR wish OR help OR frustrated)",
        "num": 10,
    }
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("organic", [])
        return json.dumps([
            {"title": item.get("title", ""), "snippet": item.get("snippet", ""),
             "link": item.get("link", "")}
            for item in results[:8]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei Reddit Search: %s", query)
        return "Error: Reddit search timeout."
    except Exception as e:
        logger.error("Fehler bei Reddit Search: %s", e)
        return f"Error searching Reddit: {e}"


@tool("Search crypto DACH market gaps")
def search_dach_gaps(query: str) -> str:
    """Search for underserved needs in the German-speaking crypto market.

    Focus on German-language results to find DACH-specific opportunities.
    """
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    payload = {"q": query, "gl": "de", "hl": "de", "num": 10}
    try:
        r = httpx.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        results = r.json().get("organic", [])
        return json.dumps([
            {"title": item.get("title", ""), "snippet": item.get("snippet", ""),
             "link": item.get("link", "")}
            for item in results[:8]
        ], ensure_ascii=False, indent=2)
    except httpx.TimeoutException:
        logger.error("Timeout bei DACH Search: %s", query)
        return "Error: DACH search timeout."
    except Exception as e:
        logger.error("Fehler bei DACH Search: %s", e)
        return f"Error searching DACH: {e}"


# === Agent Definition ===

researcher: Agent = Agent(
    role="Product Research Analyst",
    goal=(
        "Identify the top 5 most profitable digital products we can create "
        "for the DACH crypto/finance market within 1 week, with realistic "
        "revenue estimates. Focus on products with HIGH demand and LOW competition "
        "that can be sold on Gumroad/Etsy without an existing audience."
    ),
    backstory=(
        "Du bist ein erfahrener Marktforscher mit Spezialisierung auf digitale "
        "Produkte im DACH-Kryptomarkt. Du denkst in Kundenproblemen, nicht in "
        "LÃ¶sungen. Du weiÃt: Ein Produkt das niemand sucht, verkauft sich nicht â "
        "egal wie gut es ist. Du bist brutal ehrlich Ã¼ber Marktpotenziale und "
        "unterscheidest klar zwischen 'nice to have' und 'must have' Produkten."
    ),
    tools=[
        search_gumroad_trends,
        search_etsy_trends,
        search_reddit_painpoints,
        search_dach_gaps,
    ],
    verbose=True,
    max_iter=8,
    llm=LLM_COMPLEX,
    allow_delegation=False,
)

# === Task Definition ===

research_task: Task = Task(
    description="""
    FÃ¼hre eine vollstÃ¤ndige Marktanalyse durch:

    1. DEMAND SCAN: Suche auf Gumroad nach "crypto trading template",
       "krypto steuer", "bitcoin portfolio tracker", "crypto journal"
    2. PAIN POINT MINING: Suche Reddit nach Problemen in Krypto-Steuer,
       DeFi-Tracking, Trading-Journaling
    3. COMPETITION GAP: Suche auf dem deutschen Markt nach existierenden
       Produkten und deren QualitÃ¤t
    4. ETSY OPPORTUNITY: Suche nach High-Review Templates und Planern
    5. SYNTHESE: Priorisierte Liste von exakt 5 Produkten mit Name,
       Beschreibung, Zielgruppe, Preis, geschÃ¤tzte Sales, Erstellungszeit,
       MarktbegrÃ¼ndung und Wettbewerbsvorteil

    Sei BRUTAL ehrlich. Nur Produkte mit nachweisbarer Nachfrage.
    """,
    expected_output=(
        "Strukturierter Report: Executive Summary, Top 5 Produkte "
        "(priorisiert nach Revenue-Potenzial), Gesamtes monatliches "
        "Revenue-Potenzial, Empfohlene Erstellungsreihenfolge, "
        "Red Flags pro Produkt."
    ),
    agent=researcher,
)


# === Crew ===

research_crew: Crew = Crew(
    agents=[researcher],
    tasks=[research_task],
    process=Process.sequential,
    verbose=True,
)


# === Runner ===

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    logger.info("GHOST PROTOCOL â Product Research Agent gestartet")
    logger.info("Scanning markets for DACH crypto product opportunities...")

    try:
        result = research_crew.kickoff()

        output_dir = Path("outputs")
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / "product_research_report.md"
        output_path.write_text(
            f"# Product Research Report\n"
            f"## Generated by Ghost Protocol Research Agent\n\n"
            f"{result}",
            encoding="utf-8",
        )
        logger.info("Report gespeichert: %s", output_path)

    except Exception as e:
        logger.error("Research Crew fehlgeschlagen: %s", e)
        # Telegram-Alert wÃ¤re hier ideal (wird in Sprint 2 integriert)
        raise
