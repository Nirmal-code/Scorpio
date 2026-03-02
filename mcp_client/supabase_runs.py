import os
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from supabase import Client, create_client

# Load nearest .env (repo root or this directory)
for p in Path(__file__).resolve().parents:
    env_file = p / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        break
else:
    load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment or .env")

_client: Optional[Client] = None


def _client_once() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


def _get_user_id(email: str) -> int:
    client = _client_once()
    resp = (
        client.table("users")
        .select("id")
        .eq("wealthsimple_email", email)
        .limit(1)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        raise RuntimeError(f"No user found for email {email}")
    return rows[0]["id"]


def log_run(email: str, summary: str) -> str:
    """
    Insert a run summary for the given user email into the runs table.
    Uses a time-based bigint id to avoid schema changes.
    """
    if not email:
        raise ValueError("email is required")
    if summary is None or summary == "":
        raise ValueError("summary is required")

    client = _client_once()
    user_id = _get_user_id(email)

    # Generate a bigint id from current time in microseconds to reduce collision risk
    run_id = int(time.time() * 1_000_000)

    resp = (
        client.table("runs")
        .insert(
            {
                "id": run_id,
                "user_id": user_id,
                "summary": summary,
            }
        )
        .execute()
    )

    status = getattr(resp, "status_code", None)
    if status not in (200, 201):
        raise RuntimeError(f"Failed to insert run (status {status}): {getattr(resp, 'data', resp)}")
    return "ok"


if __name__ == "__main__":
    # quick manual test: python supabase_runs.py user@example.com "test summary"
    import sys

    if len(sys.argv) != 3:
        print("Usage: python supabase_runs.py <email> <summary>")
        sys.exit(1)
    print(log_run(sys.argv[1], sys.argv[2]))
