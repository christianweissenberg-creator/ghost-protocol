"""Ghost Protocol — Search Tools (Deprecated).

Such-Tools wurden aufgeteilt in:
- tools/market_tools.py — Krypto-News, Marktdaten, DACH-News
- tools/research_tools.py — Gumroad, Etsy, Reddit, DACH Market Gaps

Dieses Modul re-exportiert fuer Backward-Compatibility.
"""

from tools.market_tools import search_crypto_news, get_market_data, search_dach_news, search_web
from tools.research_tools import search_gumroad_trends, search_etsy_trends, search_reddit_painpoints

__all__ = [
    "search_crypto_news",
    "get_market_data",
    "search_dach_news",
    "search_web",
    "search_gumroad_trends",
    "search_etsy_trends",
    "search_reddit_painpoints",
]
