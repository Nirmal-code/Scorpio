from __future__ import annotations

import os
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import anyio
import requests
from dotenv import load_dotenv

# Load repo-level .env if present so VS Code Agent picks up the key
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
if ROOT_ENV.exists():
    load_dotenv(ROOT_ENV)
else:
    load_dotenv()  # fallback to default search

MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY")
BASE_URL = "https://api.massive.com/v2/reference/news"

# In-memory cache so get_full_text can serve IDs returned by search
NEWS_CACHE: Dict[str, Dict[str, Any]] = {}


def _default_since_iso() -> str:
    now = datetime.now(timezone.utc)
    return (now - timedelta(hours=12)).isoformat().replace("+00:00", "Z")


def _extract_article_fields(article: Dict[str, Any]) -> Dict[str, Any]:
    if not article:
        return {}
    # Cache full article for later retrieval
    article_id = str(article.get("id") or article.get("news_id") or "")
    if article_id:
        NEWS_CACHE[article_id] = article

    publisher = ""
    if isinstance(article.get("publisher"), dict):
        publisher = article["publisher"].get("name", "")
    elif article.get("source"):
        publisher = article["source"]

    return {
        "id": article_id,
        "title": article.get("title", ""),
        "source": publisher,
        "published_at": article.get("published_utc") or article.get("published_at") or "",
        "url": article.get("article_url") or article.get("url") or "",
    }


async def search(ticker: str, since_iso: str | None = None, limit: int = 20) -> str:
    """
    Search recent news for a ticker using Massive API.
    Returns a JSON array of {id, title, source, published_at, url}.
    """
    if not MASSIVE_API_KEY:
        raise RuntimeError("MASSIVE_API_KEY is not set in the environment")

    since = since_iso or _default_since_iso()

    def _fetch() -> List[Dict[str, Any]]:
        params = {
            "ticker": ticker,
            "published_utc.gt": since,
            "order": "asc",
            "limit": limit,
            "sort": "published_utc",
            "apiKey": MASSIVE_API_KEY,
        }
        resp = None
        for attempt in range(10):
            resp = requests.get(BASE_URL, params=params, timeout=30)
            if resp.status_code != 429:
                break
            if attempt < 9:
                time.sleep(20)  # backoff before next retry
        resp.raise_for_status()
        payload = resp.json()
        results = payload.get("results") if isinstance(payload, dict) else None
        if not results:
            return []
        return [_extract_article_fields(a) for a in results if isinstance(a, dict)]

    articles = await anyio.to_thread.run_sync(_fetch)
    return json.dumps(articles)


async def get_full_text(id: str) -> str:
    """
    Fetch full text/summary for a news article by ID.
    Falls back to the Massive detail endpoint if not cached.
    """
    if not MASSIVE_API_KEY:
        raise RuntimeError("MASSIVE_API_KEY is not set in the environment")

    cached = NEWS_CACHE.get(id)

    def _fetch_detail() -> Dict[str, Any]:
        url = f"{BASE_URL}/{id}"
        resp = requests.get(url, params={"apiKey": MASSIVE_API_KEY}, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict) and payload.get("results"):
            # API might wrap the object in a list
            res = payload["results"]
            if isinstance(res, list) and res:
                return res[0]
            if isinstance(res, dict):
                return res
        return payload if isinstance(payload, dict) else {}

    article = cached or await anyio.to_thread.run_sync(_fetch_detail)

    publisher = ""
    if isinstance(article.get("publisher"), dict):
        publisher = article["publisher"].get("name", "")
    elif article.get("source"):
        publisher = article["source"]

    text = (
        article.get("article") or
        article.get("content") or
        article.get("summary") or
        article.get("description") or
        ""
    )

    output = {
        "title": article.get("title", ""),
        "published_at": article.get("published_utc") or article.get("published_at") or "",
        "source": publisher,
        "text_or_summary": text,
    }

    return json.dumps(output)
