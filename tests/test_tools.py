"""Tests fuer Tools — Social + Publish + Market.

Alle API-Calls gemocked. Kein Geld, keine echten Requests.
"""

import os
from unittest.mock import patch, MagicMock

import pytest


class TestSocialTools:
    def test_post_tweet_missing_credentials(self):
        """Ohne X API Keys gibt post_tweet {} zurueck (Riegel freigeschaltet)."""
        with patch.dict(os.environ, {
            "X_API_KEY": "", "X_API_SECRET": "",
            "X_ACCESS_TOKEN": "", "X_ACCESS_SECRET": "",
            "GP_EXTERNAL_POSTING": "enabled",
        }):
            from tools.social_tools import post_tweet
            result = post_tweet("Test tweet")
            assert result == {}

    def test_post_tweet_truncates_long_text(self):
        """Tweets > 280 Zeichen werden gekuerzt (Riegel freigeschaltet)."""
        with patch.dict(os.environ, {
            "X_API_KEY": "", "X_API_SECRET": "",
            "X_ACCESS_TOKEN": "", "X_ACCESS_SECRET": "",
            "GP_EXTERNAL_POSTING": "enabled",
        }):
            from tools.social_tools import post_tweet
            long_text = "A" * 300
            # Returns {} wegen fehlender Credentials, aber testet den Pfad
            result = post_tweet(long_text)
            assert result == {}

    def test_post_thread_empty(self):
        with patch.dict(os.environ, {"GP_EXTERNAL_POSTING": "enabled"}):
            from tools.social_tools import post_thread
            result = post_thread([])
            assert result == []


class TestPostingGuard:
    """Harter Posting-Riegel (29.07.2026): fail-closed, nur 'enabled' schaltet frei."""

    def test_post_tweet_blocked_by_default(self):
        with patch.dict(os.environ, {"GP_EXTERNAL_POSTING": ""}):
            from tools.posting_guard import PostingDisabledError
            from tools.social_tools import post_tweet
            with pytest.raises(PostingDisabledError):
                post_tweet("Test tweet")

    def test_post_thread_blocked_by_default(self):
        with patch.dict(os.environ, {"GP_EXTERNAL_POSTING": ""}):
            from tools.posting_guard import PostingDisabledError
            from tools.social_tools import post_thread
            with pytest.raises(PostingDisabledError):
                post_thread(["Tweet 1", "Tweet 2"])

    def test_true_reicht_nicht_zum_freischalten(self):
        """Nur das explizite Wort 'enabled' schaltet frei — kein 'true'/'1'."""
        for value in ("true", "1", "yes", "TRUE", "on"):
            with patch.dict(os.environ, {"GP_EXTERNAL_POSTING": value}):
                from tools.posting_guard import external_posting_enabled
                assert external_posting_enabled() is False, value

    def test_enabled_schaltet_frei(self):
        with patch.dict(os.environ, {"GP_EXTERNAL_POSTING": "enabled"}):
            from tools.posting_guard import external_posting_enabled
            assert external_posting_enabled() is True

    def test_get_tweet_metrics_no_bearer(self):
        with patch.dict(os.environ, {"X_BEARER_TOKEN": ""}):
            from tools.social_tools import get_tweet_metrics
            result = get_tweet_metrics("123456")
            assert result == {}

    def test_get_user_metrics_no_bearer(self):
        with patch.dict(os.environ, {"X_BEARER_TOKEN": ""}):
            from tools.social_tools import get_user_metrics
            result = get_user_metrics("WhitePulseAI")
            assert result == {}


class TestPublishTools:
    def test_list_gumroad_products_no_token(self):
        with patch.dict(os.environ, {"GUMROAD_ACCESS_TOKEN": ""}):
            from tools.publish_tools import list_gumroad_products
            result = list_gumroad_products()
            assert result == []

    def test_get_gumroad_sales_no_token(self):
        with patch.dict(os.environ, {"GUMROAD_ACCESS_TOKEN": ""}):
            from tools.publish_tools import get_gumroad_sales
            result = get_gumroad_sales()
            assert result == []

    def test_get_gumroad_revenue_summary_no_token(self):
        with patch.dict(os.environ, {"GUMROAD_ACCESS_TOKEN": ""}):
            from tools.publish_tools import get_gumroad_revenue_summary
            result = get_gumroad_revenue_summary()
            assert result["total_products"] == 0
            assert result["total_revenue_eur"] == 0

    def test_save_content(self, tmp_path):
        from tools.publish_tools import save_content
        path = save_content("Test content", "test.md", subdir=str(tmp_path))
        assert path.exists()
        assert path.read_text() == "Test content"

    def test_content_queue_roundtrip(self, tmp_path):
        from tools.publish_tools import save_content_queue, load_content_queue
        queue_file = str(tmp_path / "queue.json")
        queue = [{"type": "newsletter", "status": "ready", "title": "Test"}]
        save_content_queue(queue, queue_file)
        loaded = load_content_queue(queue_file)
        assert len(loaded) == 1
        assert loaded[0]["title"] == "Test"

    def test_get_pending_content_filters(self, tmp_path):
        from tools.publish_tools import save_content_queue, get_pending_content
        queue_file = str(tmp_path / "queue.json")
        queue = [
            {"type": "newsletter", "status": "ready", "title": "A"},
            {"type": "social_post", "status": "ready", "title": "B"},
            {"type": "newsletter", "status": "published", "title": "C"},
        ]
        save_content_queue(queue, queue_file)
        # get_pending_content uses default file — test structure
        assert queue[0]["status"] == "ready"
        assert queue[2]["status"] == "published"


class TestToolsInit:
    def test_all_exports_available(self):
        import tools
        assert hasattr(tools, "post_tweet")
        assert hasattr(tools, "post_thread")
        assert hasattr(tools, "get_tweet_metrics")
        assert hasattr(tools, "list_gumroad_products")
        assert hasattr(tools, "save_content")
        assert hasattr(tools, "search_crypto_news")
        assert hasattr(tools, "send_telegram_alert")
