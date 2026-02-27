"""Helpers for fetching user metadata from Supabase."""

from __future__ import annotations

import os
from typing import Optional, List, Dict

from dotenv import load_dotenv
from supabase import Client, create_client

# Import WSApi in both script and package contexts
from pathlib import Path
import sys as _sys

_pkg_root = Path(__file__).resolve().parent
if str(_pkg_root) not in _sys.path:
    _sys.path.append(str(_pkg_root))
from ws import WSApi  # type: ignore



# Support running as package (`python -m db_helper.endpoints.query`)
# or as a direct script (`python db_helper/endpoints/query.py`).

# Load environment variables from the repo's .env if present
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

_client: Optional[Client] = None


def _get_client() -> Client:
    """Lazy-init Supabase client using service role for read access."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to query Supabase."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


def get_user_id_by_email(email: str) -> Optional[int]:
    """
    Return the user id for the given wealthsimple_email.

    Args:
        email: Wealthsimple email address.
    Returns:
        User id as int if found, otherwise None.
    """
    if not email:
        raise ValueError("email is required")

    client = _get_client()
    try:
        resp = (
            client.table("users")
            .select("id")
            .eq("wealthsimple_email", email)
            .limit(1)
            .execute()
        )
    except Exception as e:
        print(f"Error fetching user ID for {email}: {e}")
        return None
    
    rows = getattr(resp, "data", None) or []
    if not rows:
        return None
    return rows[0].get("id")

def get_holdings_for_user(email: str) -> List[Dict]:
    """
    Return all holdings for the given user email by joining users -> holdings.

    Args:
        email: Wealthsimple email address.
    Returns:
        List of holding dicts (empty list if none).
    """
    if not email:
        raise ValueError("email is required")

    client = _get_client()
    try:
        resp = (
            client.table("holdings")
            .select(
                "ticker, quantity, avg_cost, market_value, book_value, "
                "users!inner(wealthsimple_email)"
            )
            .eq("users.wealthsimple_email", email)
            .execute()
        )
    except Exception as e:
        print(f"Error fetching holdings for {email}: {e}")

    return getattr(resp, "data", None) or []

def get_preferences_for_user(email: str) -> Optional[str]:
    """
    Return the preferences JSON string for the given user email.

    Args:
        email: Wealthsimple email address.
    
    Returns:
        Preferences JSON string if found, otherwise None.
    """
    if not email:
        raise ValueError("email is required")

    client = _get_client()
    try:
        resp = (
            client.table("preferences")
            .select("preference, "
                    "users!inner(wealthsimple_email)")
            .eq("users.wealthsimple_email", email)
            .limit(1)
            .execute()
        )
    except Exception as e:
        print(f"Error fetching preferences for {email}: {e}")
        return None

    rows = getattr(resp, "data", None) or []
    if not rows:
        return None
    return rows[0].get("preference") 

def post_holdings_for_user(email: str) -> bool:
    """
    Upsert holdings for the given user email.

    Args:
        email: Wealthsimple email address.
        holdings: List of holding dicts to upsert. Each dict should have keys: ticker, quantity, avg_cost, market_value, book_value.
    Returns:
        True if upsert succeeded, False otherwise.
    """
    holdings = WSApi().get_holdings()
    if not email:
        raise ValueError("email is required")
    if not holdings:
        raise ValueError("holdings list cannot be empty")

    client = _get_client()
    user_id = get_user_id_by_email(email)
    if user_id is None:
        print(f"No user found for email {email}")
        return False

    # Prepare data for upsert, adding user_id to each holding
    upsert_data = []
    for h in holdings:
        if not all(k in h for k in ("ticker", "quantity", "avg_cost", "market_value", "book_value")):
            print(f"Invalid holding data: {h}")
            continue
        upsert_data.append({
            "user_id": user_id,
            "ticker": h["ticker"],
            "quantity": h["quantity"],
            "avg_cost": h["avg_cost"],
            "market_value": h["market_value"],
            "book_value": h["book_value"],
        })

    if not upsert_data:
        print("No valid holdings to upsert")
        return False

    try:
        try: 
            resp = client.table("holdings").upsert(upsert_data, on_conflict="user_id,ticker").execute()
        except Exception as e:
            print(f"Error during upsert: {e}")
            return False
        return True

    except Exception as e:
        print(f"Error upserting holdings for {email}: {e}")
        return False


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python -m db_helper.endpoints.query <email>")
        sys.exit(1) 

    user_email = sys.argv[1]
    holdings = get_holdings_for_user(user_email)
    if holdings:
        for h in holdings:
            print(h)
    else:
        print("not found")

    preferferences = get_preferences_for_user(user_email)
    if preferferences:
        print("Preferences:", preferferences)
    else:
        print("No preferences found")

    result = post_holdings_for_user(user_email)
    if result:
        print("Holdings upserted successfully")
    else:
        print("Failed to upsert holdings")
