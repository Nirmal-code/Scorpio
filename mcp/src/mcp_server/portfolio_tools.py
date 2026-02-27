from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import anyio
from dotenv import load_dotenv
from supabase import Client, create_client

# Load repo-level .env for Supabase credentials (falls back to default search)
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
if ROOT_ENV.exists():
    load_dotenv(ROOT_ENV)
else:
    load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

_client: Optional[Client] = None


def _get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


def _fetch_holdings(email: str) -> List[Dict[str, Any]]:
    client = _get_client()
    resp = (
        client.table("holdings")
        .select(
            "ticker, quantity, avg_cost, market_value, book_value, "
            "users!inner(wealthsimple_email)"
        )
        .eq("users.wealthsimple_email", email)
        .execute()
    )
    return getattr(resp, "data", None) or []


async def get_holdings(email: str) -> str:
    """Return the holdings for a Wealthsimple user by email as JSON."""
    if not email:
        raise ValueError("email is required")

    def _wrapped() -> List[Dict[str, Any]]:
        try:
            return _fetch_holdings(email)
        except Exception as exc:  # surface upstream errors but keep sync func small
            raise RuntimeError(f"Failed to fetch holdings for {email}: {exc}") from exc

    holdings = await anyio.to_thread.run_sync(_wrapped)
    return json.dumps(holdings, default=str)
