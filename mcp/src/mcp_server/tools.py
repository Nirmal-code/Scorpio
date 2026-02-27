"""
Starter tool implementations.

Replace or expand these with real logic. Each tool is a plain async function;
`server.tool()` will turn them into MCP tools with inferred schemas.
"""


async def ping() -> str:
    """Return a short heartbeat string."""
    return "pong"


async def echo(message: str) -> str:
    """Echo back the provided message."""
    return message
