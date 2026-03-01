"""
Module entrypoint for running MCP server over HTTP with uvicorn.
Used by Docker CMD.
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("mcp_server.http_server:app", host="0.0.0.0", port=8000)
