from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import anyio
from dotenv import load_dotenv

# Make project root importable so we can reuse db_helper logic
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

# Load repo-level .env for Supabase credentials (falls back to default search)
root_env = REPO_ROOT / ".env"
if root_env.exists():
    load_dotenv(root_env)
else:
    load_dotenv()

from db_helper.endpoints.query import get_holdings_for_user


async def get_holdings(email: str) -> str:
    """
    Return the holdings for a Wealthsimple user by email as JSON.
    """
    if not email:
        raise ValueError("email is required")

    def _fetch() -> List[Dict[str, Any]]:
        return get_holdings_for_user(email) or []

    holdings = await anyio.to_thread.run_sync(_fetch)
    return json.dumps(holdings, default=str)
