from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import anyio
from dotenv import load_dotenv
from supabase import Client, create_client

from mcp_server.ws import WSApi

# Load nearest .env for Supabase credentials; safe for site-packages installs
for p in Path(__file__).resolve().parents:
    env_file = p / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        break
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


def _get_user_id(email: str) -> Optional[int]:
    client = _get_client()
    resp = (
        client.table("users")
        .select("id")
        .eq("wealthsimple_email", email)
        .limit(1)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        return None
    return rows[0].get("id")


def _upsert_preference(user_id: int, preference: str) -> bool:
    client = _get_client()
    resp = (
        client.table("preferences")
        .upsert({"user_id": user_id, "preference": preference}, on_conflict="user_id")
        .execute()
    )
    # Supabase python client returns status_code on the response object
    return getattr(resp, "status_code", 0) in (200, 201)


def _fetch_preference(email: str) -> Optional[str]:
    client = _get_client()
    resp = (
        client.table("preferences")
        .select("preference, users!inner(wealthsimple_email)")
        .eq("users.wealthsimple_email", email)
        .limit(1)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        return None
    return rows[0].get("preference")


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


async def set_preference(email: str, preference: str) -> str:
    """
    Upsert a user's preference JSON/string into the preferences table by email.
    """
    if not email:
        raise ValueError("email is required")
    if preference is None:
        raise ValueError("preference is required")

    def _wrapped() -> str:
        user_id = _get_user_id(email)
        if user_id is None:
            raise RuntimeError(f"No user found for email {email}")
        ok = _upsert_preference(user_id, preference)

        return "updated"

    return await anyio.to_thread.run_sync(_wrapped)


def _upsert_holdings(user_id: int, holdings: List[Dict[str, Any]]) -> bool:
    client = _get_client()
    try:
        resp = (
            client.table("holdings")
            .upsert(holdings, on_conflict="user_id,ticker")
            .execute()
        )
    except Exception as exc:
        raise RuntimeError(f"Supabase upsert failed: {exc}") from exc
    return True


async def post_holdings_for_user(email: str) -> str:
    """
    Login to Wealthsimple, fetch holdings, and upsert into Supabase for the given email.
    """
    if not email:
        raise ValueError("email is required")

    def _wrapped() -> str:
        user_id = _get_user_id(email)
        if user_id is None:
            raise RuntimeError(f"No user found for email {email}")

        holdings = WSApi().get_holdings()
        if not holdings:
            raise RuntimeError("No holdings returned from Wealthsimple")

        upsert_data = []
        for h in holdings:
            if not all(k in h for k in ("ticker", "quantity", "avg_cost", "market_value", "book_value")):
                continue
            upsert_data.append(
                {
                    "user_id": user_id,
                    "ticker": h["ticker"],
                    "quantity": h["quantity"],
                    "avg_cost": h["avg_cost"],
                    "market_value": h["market_value"],
                    "book_value": h["book_value"],
                }
            )

        if not upsert_data:
            raise RuntimeError("No valid holdings to upsert")

        ok = _upsert_holdings(user_id, upsert_data)
        if not ok:
            raise RuntimeError("Supabase upsert failed")
        return "updated"

    return await anyio.to_thread.run_sync(_wrapped)


async def get_preference(email: str) -> str:
    """Fetch a user's preference string/JSON by email."""
    if not email:
        raise ValueError("email is required")

    def _wrapped() -> Optional[str]:
        try:
            return _fetch_preference(email)
        except Exception as exc:
            raise RuntimeError(f"Failed to fetch preference for {email}: {exc}") from exc

    pref = await anyio.to_thread.run_sync(_wrapped)
    return json.dumps({"preference": pref})

if __name__ == "__main__":
    
    result = asyncio.run(post_holdings_for_user('nirmalc10272003@gmail.com'))
    if result:
        print("Holdings upserted successfully")
    else:
        print("Failed to upsert holdings")
