import os
import uuid
import asyncio
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, EmailStr

from mcp_client import run_for_email  # import your refactored function

API_KEY = os.getenv("RUNNER_API_KEY")  # set this in env
if not API_KEY:
    raise RuntimeError("Set RUNNER_API_KEY")

app = FastAPI(title="Scorpio Runner API")

class RunRequest(BaseModel):
    email: EmailStr
    deliver_discord: bool = True

# In-memory status (fine for v1). For real: store in Redis/Supabase.
RUNS: dict[str, dict] = {}

@app.post("/run")
async def run(req: RunRequest, authorization: str | None = Header(default=None)):
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    run_id = str(uuid.uuid4())
    RUNS[run_id] = {"status": "queued"}

    async def _job():
        RUNS[run_id]["status"] = "running"
        try:
            result = await run_for_email(req.email)
            RUNS[run_id] = {"status": "done", "result": result}
        except Exception as e:
            RUNS[run_id] = {"status": "error", "error": str(e)}

    # fire-and-forget background task
    asyncio.create_task(_job())

    return {"run_id": run_id, "status": "queued"}

@app.get("/run/{run_id}")
async def get_run(run_id: str, authorization: str | None = Header(default=None)):
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if run_id not in RUNS:
        raise HTTPException(status_code=404, detail="Not found")
    return RUNS[run_id]