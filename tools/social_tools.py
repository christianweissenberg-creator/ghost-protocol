"""Ghost Protocol — Social Media Tools.

Standalone-Funktionen fuer X (Twitter) API v2.
Genutzt von: PublisherAgent, AmplifierAgent, ScribeAgent

Features:
- Post Tweet
- Post Thread (mehrere Tweets)
- Get Engagement-Metriken
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None

logger: logging.Logger = logging.getLogger(__name__)

X_API_BASE = "https://api.x.com/2"


def _x_headers() -> dict[str, str]:
    """Erstellt Authorization Headers fuer X API v2 (OAuth 2.0 Bearer)."""
    token = os.environ.get("X_BEARER_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _x_oauth_headers() -> dict[str, str]:
    """Erstellt OAuth 1.0a Headers fuer X API v2 (User Context — zum Posten).

    Nutzt die 4 OAuth Keys: API Key, API Secret, Access Token, Access Secret.
    Fuer MVP verwenden wir httpx mit OAuth1Auth.
    """
    # OAuth 1.0a wird fuer POST-Requests benoetigt
    # Die Implementierung nutzt httpx-oauth oder manuelles Signing
    return {
        "Content-Type": "application/json",
    }


def post_tweet(text: str, reply_to_id: str | None = None) -> dict[str, Any]:
    """Postet einen Tweet via X API v2.

    Args:
        text: Tweet-Text (max 280 Zeichen)
        reply_to_id: Tweet-ID fuer Reply (Thread-Aufbau)

    Returns:
        {"id": str, "text": str} oder {} bei Fehler
    """
    if httpx is None:
        logger.warning("httpx nicht installiert — X API deaktiviert")
        return {}

    api_key = os.environ.get("X_API_KEY", "")
    api_secret = os.environ.get("X_API_SECRET", "")
    access_token = os.environ.get("X_ACCESS_TOKEN", "")
    access_secret = os.environ.get("X_ACCESS_SECRET", "")

    if not all([api_key, api_secret, access_token, access_secret]):
        logger.warning("X API Credentials nicht vollstaendig gesetzt")
        return {}

    # Truncate to 280 chars
    if len(text) > 280:
        text = text[:277] + "..."
        logger.warning("Tweet auf 280 Zeichen gekuerzt")

    payload: dict[str, Any] = {"text": text}
    if reply_to_id:
        payload["reply"] = {"in_reply_to_tweet_id": reply_to_id}

    try:
        # OAuth 1.0a via httpx
        from httpx import _auth as httpx_auth  # noqa: F401
        import hmac
        import hashlib
        import base64
        import time
        import urllib.parse
        import uuid

        # OAuth 1.0a Signing
        oauth_params = {
            "oauth_consumer_key": api_key,
            "oauth_nonce": uuid.uuid4().hex,
            "oauth_signature_method": "HMAC-SHA256",
            "oauth_timestamp": str(int(time.time())),
            "oauth_token": access_token,
            "oauth_version": "1.0",
        }

        # Create signature base string
        method = "POST"
        url = f"{X_API_BASE}/tweets"
        params_str = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
            for k, v in sorted(oauth_params.items())
        )
        base_string = f"{method}&{urllib.parse.quote(url, safe='')}&{urllib.parse.quote(params_str, safe='')}"

        signing_key = f"{urllib.parse.quote(api_secret, safe='')}&{urllib.parse.quote(access_secret, safe='')}"
        signature = base64.b64encode(
            hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha256).digest()
        ).decode()

        oauth_params["oauth_signature"] = signature
        auth_header = "OAuth " + ", ".join(
            f'{k}="{urllib.parse.quote(v, safe="")}"'
            for k, v in sorted(oauth_params.items())
        )

        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                url,
                json=payload,
                headers={
                    "Authorization": auth_header,
                    "Content-Type": "application/json",
                },
            )
            r.raise_for_status()
            data = r.json().get("data", {})
            logger.info("Tweet gepostet: %s", data.get("id", ""))
            return data

    except Exception as e:
        logger.error("X API Fehler: %s", e)
        return {}


def post_thread(tweets: list[str]) -> list[dict[str, Any]]:
    """Postet einen Thread (mehrere Tweets als Kette).

    Args:
        tweets: Liste von Tweet-Texten (je max 280 Zeichen)

    Returns:
        Liste von {"id": str, "text": str} pro Tweet
    """
    if not tweets:
        return []

    results = []
    reply_to = None

    for tweet_text in tweets:
        result = post_tweet(tweet_text, reply_to_id=reply_to)
        if result:
            results.append(result)
            reply_to = result.get("id")
        else:
            logger.error("Thread abgebrochen bei Tweet %d", len(results) + 1)
            break

    logger.info("Thread gepostet: %d/%d Tweets", len(results), len(tweets))
    return results


def get_tweet_metrics(tweet_id: str) -> dict[str, Any]:
    """Holt Engagement-Metriken fuer einen Tweet.

    Args:
        tweet_id: Die Tweet-ID

    Returns:
        {"retweet_count": int, "reply_count": int, "like_count": int, "impression_count": int}
    """
    if httpx is None:
        return {}

    bearer = os.environ.get("X_BEARER_TOKEN", "")
    if not bearer:
        logger.warning("X_BEARER_TOKEN nicht gesetzt")
        return {}

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                f"{X_API_BASE}/tweets/{tweet_id}",
                params={"tweet.fields": "public_metrics"},
                headers=_x_headers(),
            )
            r.raise_for_status()
            metrics = r.json().get("data", {}).get("public_metrics", {})
            return metrics
    except Exception as e:
        logger.error("X Metrics Fehler: %s", e)
        return {}


def get_user_metrics(username: str = "WhitePulseAI") -> dict[str, Any]:
    """Holt Account-Metriken fuer einen X User.

    Returns:
        {"followers_count": int, "following_count": int, "tweet_count": int}
    """
    if httpx is None:
        return {}

    bearer = os.environ.get("X_BEARER_TOKEN", "")
    if not bearer:
        return {}

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                f"{X_API_BASE}/users/by/username/{username}",
                params={"user.fields": "public_metrics"},
                headers=_x_headers(),
            )
            r.raise_for_status()
            metrics = r.json().get("data", {}).get("public_metrics", {})
            return metrics
    except Exception as e:
        logger.error("X User Metrics Fehler: %s", e)
        return {}
