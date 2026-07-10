"""Ghost Protocol — Tools.

Standalone-Funktionen fuer externe API-Calls.
Kein CrewAI-Dependency — direkte HTTP-Requests via httpx.

Module:
- market_tools: Serper News, CoinGecko Preise, DACH News
- research_tools: Gumroad, Etsy, Reddit, DACH Market Gaps
- monitor_tools: Telegram Alerts
"""

from tools.market_tools import (
    format_market_data,
    format_news,
    get_market_data,
    search_crypto_news,
    search_dach_news,
    search_web,
)
from tools.research_tools import (
    format_research_data,
    gather_product_research,
    search_dach_market_gaps,
    search_etsy_trends,
    search_gumroad_trends,
    search_reddit_painpoints,
)
from tools.monitor_tools import send_telegram_alert
from tools.publish_tools import (
    get_gumroad_revenue_summary,
    get_gumroad_sales,
    get_pending_content,
    list_gumroad_products,
    save_content,
)
from tools.social_tools import (
    get_tweet_metrics,
    get_user_metrics,
    post_thread,
    post_tweet,
)

__all__ = [
    # Market
    "search_crypto_news",
    "get_market_data",
    "search_dach_news",
    "search_web",
    "format_market_data",
    "format_news",
    # Research
    "search_gumroad_trends",
    "search_etsy_trends",
    "search_reddit_painpoints",
    "search_dach_market_gaps",
    "gather_product_research",
    "format_research_data",
    # Monitor
    "send_telegram_alert",
    # Publish (Gumroad)
    "list_gumroad_products",
    "get_gumroad_sales",
    "get_gumroad_revenue_summary",
    "save_content",
    "get_pending_content",
    # Social (X/Twitter)
    "post_tweet",
    "post_thread",
    "get_tweet_metrics",
    "get_user_metrics",
]
