"""
Ghost Protocol — MailerLite API Integration
=============================================
Sendet Newsletter und verwaltet Subscriber über MailerLite API v2.

Account: 2240934 (Free Tier, 1000 Subscriber, EU-Server)
Domain: whitepulse.io (authentifiziert)
Form: F6zemz (Double Opt-In)

API Docs: https://developers.mailerlite.com/docs/

Usage:
    ml = MailerLite(api_key="...")
    ml.send_campaign(subject="...", html="...", segment_id=None)
"""

from __future__ import annotations

import json
import os

from tools.posting_guard import require_external_posting
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    import httpx
except ImportError:
    httpx = None


BASE_URL = "https://connect.mailerlite.com/api"


class MailerLite:
    """MailerLite API v2 Client für Ghost Protocol.

    Funktionen:
    - Subscriber verwalten (list, add, remove)
    - Campaigns erstellen und senden
    - Statistiken abrufen (opens, clicks, unsubscribes)
    """

    def __init__(self, api_key: str | None = None):
        if httpx is None:
            raise ImportError("httpx nicht installiert: pip install httpx")

        self.api_key = api_key or os.environ.get("MAILERLITE_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "MAILERLITE_API_KEY nicht gesetzt. "
                "Hol dir den Key unter: MailerLite → Settings → API → Developer API"
            )

        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers=self.headers,
            timeout=30.0,
        )

    def _request(self, method: str, path: str, data: dict | None = None) -> dict:
        """Generischer API-Request mit Error-Handling."""
        response = self._client.request(method, path, json=data)

        if response.status_code == 429:
            # Rate Limit — 1 Sekunde warten und retry
            time.sleep(1)
            response = self._client.request(method, path, json=data)

        if response.status_code >= 400:
            error_body = response.text[:500]
            raise Exception(
                f"MailerLite API Error {response.status_code}: {error_body}"
            )

        if response.status_code == 204:  # No Content (z.B. DELETE)
            return {"status": "ok"}

        return response.json()

    # ── Subscriber ──────────────────────────────────

    def list_subscribers(self, limit: int = 25, page: int = 1) -> dict:
        """Alle Subscriber auflisten."""
        return self._request("GET", f"/subscribers?limit={limit}&page={page}")

    def get_subscriber(self, email: str) -> dict:
        """Einzelnen Subscriber abrufen."""
        return self._request("GET", f"/subscribers/{email}")

    def add_subscriber(self, email: str, name: str = "", fields: dict | None = None) -> dict:
        """Neuen Subscriber hinzufügen (Double Opt-In via Form)."""
        data: dict[str, Any] = {"email": email}
        if name:
            parts = name.split(" ", 1)
            data["fields"] = {"name": parts[0]}
            if len(parts) > 1:
                data["fields"]["last_name"] = parts[1]
        if fields:
            data.setdefault("fields", {}).update(fields)
        return self._request("POST", "/subscribers", data)

    def subscriber_count(self) -> int:
        """Anzahl aktiver Subscriber."""
        result = self._request("GET", "/subscribers?limit=0")
        return result.get("total", 0)

    # ── Campaigns ──────────────────────────────────

    def create_campaign(
        self,
        name: str,
        subject: str,
        html_content: str,
        from_name: str = "WHITEPULSE",
        from_email: str = "datenschutz@whitepulse.de",
        campaign_type: str = "regular",
    ) -> dict:
        """Campaign erstellen (noch nicht gesendet).

        Returns:
            Campaign-Objekt mit 'id' Feld
        """
        data = {
            "name": name,
            "type": campaign_type,
            "emails": [{
                "subject": subject,
                "from_name": from_name,
                "from": from_email,
                "content": html_content,
            }],
        }
        return self._request("POST", "/campaigns", data)

    def send_campaign(self, campaign_id: str) -> dict:
        """Campaign sofort senden an alle Subscriber.

        Raises:
            PostingDisabledError: solange GP_EXTERNAL_POSTING nicht gesetzt ist.
        """
        require_external_posting(f"MailerLite send_campaign({campaign_id})")
        data = {"delivery": "instant"}
        return self._request("POST", f"/campaigns/{campaign_id}/schedule", data)

    def create_and_send(
        self,
        name: str,
        subject: str,
        html_content: str,
        from_name: str = "WHITEPULSE",
    ) -> dict:
        """Convenience: Campaign erstellen + sofort senden.

        Returns:
            {"campaign_id": str, "status": str, "subscriber_count": int}

        Raises:
            PostingDisabledError: solange GP_EXTERNAL_POSTING nicht gesetzt ist.
        """
        require_external_posting("MailerLite create_and_send")
        # 1. Campaign erstellen
        campaign = self.create_campaign(
            name=name,
            subject=subject,
            html_content=html_content,
            from_name=from_name,
        )
        campaign_id = campaign["data"]["id"]

        # 2. Sofort senden
        send_result = self.send_campaign(campaign_id)

        return {
            "campaign_id": campaign_id,
            "status": "sent",
            "name": name,
            "subject": subject,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def list_campaigns(self, status: str = "sent", limit: int = 10) -> dict:
        """Campaigns auflisten. Status: draft, ready, sent, all."""
        return self._request("GET", f"/campaigns?filter[status]={status}&limit={limit}")

    def get_campaign_stats(self, campaign_id: str) -> dict:
        """Statistiken einer Campaign abrufen."""
        return self._request("GET", f"/campaigns/{campaign_id}")

    # ── Groups (Segmente) ──────────────────────────

    def list_groups(self) -> dict:
        """Alle Subscriber-Gruppen auflisten."""
        return self._request("GET", "/groups")

    def create_group(self, name: str) -> dict:
        """Neue Gruppe erstellen."""
        return self._request("POST", "/groups", {"name": name})

    # ── Automations ────────────────────────────────

    def list_automations(self) -> dict:
        """Alle Automations auflisten."""
        return self._request("GET", "/automations")

    # ── Diagnostics ────────────────────────────────

    def health_check(self) -> dict:
        """API-Konnektivität + Account-Status prüfen."""
        try:
            subs = self.subscriber_count()
            campaigns = self.list_campaigns(status="sent", limit=1)
            sent_count = campaigns.get("meta", {}).get("total", 0)

            return {
                "status": "OK",
                "subscribers": subs,
                "campaigns_sent": sent_count,
                "api_connected": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            return {
                "status": "ERROR",
                "error": str(e),
                "api_connected": False,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
