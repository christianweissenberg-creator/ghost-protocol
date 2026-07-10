"""Ghost Protocol — Publish Tools.

Standalone-Funktionen fuer Content-Veroeffentlichung und Distribution.
Genutzt von: PublisherAgent, BroadcasterAgent, AmplifierAgent

Module:
- Gumroad: Produkte listen, Sales abrufen
- MailerLite: Subscriber-Stats (volle Integration in execution/mailerlite.py)
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None

logger: logging.Logger = logging.getLogger(__name__)


# ── Gumroad API ──────────────────────────────────

GUMROAD_API = "https://api.gumroad.com/v2"


def _gumroad_request(path: str, params: dict | None = None) -> dict[str, Any]:
    """Generischer Gumroad API Request."""
    if httpx is None:
        logger.warning("httpx nicht installiert — Gumroad-Calls deaktiviert")
        return {}

    token = os.environ.get("GUMROAD_ACCESS_TOKEN", "")
    if not token:
        logger.warning("GUMROAD_ACCESS_TOKEN nicht gesetzt")
        return {}

    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                f"{GUMROAD_API}{path}",
                params={"access_token": token, **(params or {})},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Gumroad API Fehler: %s", e)
        return {}


def list_gumroad_products() -> list[dict[str, Any]]:
    """Listet alle Gumroad-Produkte auf.

    Returns:
        Liste von {id, name, price, sales_count, revenue, url}
    """
    data = _gumroad_request("/products")
    products = data.get("products", [])
    return [
        {
            "id": p.get("id", ""),
            "name": p.get("name", ""),
            "price": p.get("price", 0) / 100,  # Cents -> EUR
            "sales_count": p.get("sales_count", 0),
            "revenue": p.get("revenue", 0) / 100,
            "url": p.get("short_url", ""),
            "published": p.get("published", False),
        }
        for p in products
    ]


def get_gumroad_sales(product_id: str | None = None) -> list[dict[str, Any]]:
    """Holt die letzten Sales von Gumroad.

    Args:
        product_id: Filtern nach Produkt (optional)

    Returns:
        Liste von {id, product_name, price, email, created_at}
    """
    params = {}
    if product_id:
        params["product_id"] = product_id

    data = _gumroad_request("/sales", params)
    sales = data.get("sales", [])
    return [
        {
            "id": s.get("id", ""),
            "product_name": s.get("product_name", ""),
            "price": s.get("price", 0) / 100,
            "email": s.get("email", ""),
            "created_at": s.get("created_at", ""),
        }
        for s in sales
    ]


def get_gumroad_revenue_summary() -> dict[str, Any]:
    """Berechnet Revenue-Summary ueber alle Produkte.

    Returns:
        {"total_products": int, "total_sales": int, "total_revenue_eur": float, "products": [...]}
    """
    products = list_gumroad_products()
    return {
        "total_products": len(products),
        "total_sales": sum(p["sales_count"] for p in products),
        "total_revenue_eur": sum(p["revenue"] for p in products),
        "products": products,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Content File Management ──────────────────────

def save_content(content: str, filename: str, subdir: str = "outputs") -> Path:
    """Speichert generierten Content in eine Datei.

    Args:
        content: Der zu speichernde Content
        filename: Dateiname (z.B. "briefing_2026-04-11.md")
        subdir: Unterverzeichnis (default: "outputs")

    Returns:
        Path zur gespeicherten Datei
    """
    output_dir = Path(subdir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_text(content, encoding="utf-8")
    logger.info("Content gespeichert: %s", output_path)
    return output_path


def load_content_queue(queue_file: str = "data/content_queue.json") -> list[dict]:
    """Laedt die Content-Queue aus dem JSON-File."""
    path = Path(queue_file)
    if not path.exists():
        return []
    return json.loads(path.read_text())


def save_content_queue(queue: list[dict], queue_file: str = "data/content_queue.json") -> None:
    """Speichert die Content-Queue."""
    path = Path(queue_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(queue, indent=2, ensure_ascii=False))


def get_pending_content(content_type: str | None = None) -> list[dict]:
    """Holt alle noch nicht veroeffentlichten Content-Items.

    Args:
        content_type: Filtern nach Typ (z.B. "newsletter", "social_post")

    Returns:
        Liste von pending Content-Items
    """
    queue = load_content_queue()
    pending = [q for q in queue if q.get("status") in ("ready", "awaiting_approval")]
    if content_type:
        pending = [q for q in pending if q.get("type") == content_type]
    return pending
