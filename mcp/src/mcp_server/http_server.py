"""
Lightweight HTTP wrapper to expose MCP tools over REST.
Intended for containerized deployment behind HTTPS (e.g., Caddy/NGINX/DO App Platform).
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import Body, FastAPI, HTTPException

from mcp_server.server import REGISTERED_TOOLS

app = FastAPI(title="Scorpio MCP Server", version="0.1.0")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/tools")
async def list_tools() -> Dict[str, Any]:
    return {
        "tools": [
            {"name": name, "description": meta["description"], "schema": meta["input_schema"]}
            for name, meta in REGISTERED_TOOLS.items()
        ]
    }


@app.post("/tools/{name}")
async def call_tool(name: str, arguments: Dict[str, Any] = Body(default_factory=dict)):
    resolved_name = name if name in REGISTERED_TOOLS else name.replace(".", "_")
    if resolved_name not in REGISTERED_TOOLS:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {name}")

    # Normalize callers that wrap args as {"kwargs": {...}}
    if isinstance(arguments, dict) and set(arguments.keys()) == {"kwargs"} and isinstance(arguments.get("kwargs"), dict):
        arguments = arguments["kwargs"]

    fn = REGISTERED_TOOLS[resolved_name]["fn"]
    try:
        result = await fn(**arguments)
    except TypeError as exc:
        # likely bad/missing arguments
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"result": result}
