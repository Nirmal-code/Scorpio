"""
Entrypoint for the MCP server.

This uses the Model Context Protocol (MCP) Python SDK. By default it exposes
stdout/stdin transport so the server can be launched as a child process by an
MCP-compatible client. Add more transports (e.g., websockets) as needed.
"""
from __future__ import annotations



import inspect

import anyio
import typer
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from mcp_server import tools
from mcp_server import market_tools as market
from mcp_server import news_tools as news
from mcp_server import portfolio_tools as portfolio
app = typer.Typer(help="Run the MCP server")
server = Server("scorpio-mcp")

# Simple tool registry: name -> metadata + callable
REGISTERED_TOOLS = {
    "ping": {
        "fn": tools.ping,
        "description": (tools.ping.__doc__ or "").strip() or "Ping the server",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    "echo": {
        "fn": tools.echo,
        "description": (tools.echo.__doc__ or "").strip() or "Echo a message",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Message to echo back",
                }
            },
            "required": ["message"],
        },
    },
    "market_get_snapshot": {
        "fn": market.get_snapshot,
        "description": (market.get_snapshot.__doc__ or "").strip()
        or "Return price, volume, and key technicals for a ticker",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {
                    "type": "string",
                    "description": "Ticker symbol (e.g., AAPL)",
                }
            },
            "required": ["ticker"],
        },
    },
    "news_search": {
        "fn": news.search,
        "description": (news.search.__doc__ or "").strip()
        or "Search recent news for a ticker",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "since_iso": {
                    "type": "string",
                    "description": "ISO timestamp filter (published_utc.gt). Defaults to last 12h",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "required": ["ticker"],
        },
    },
    "news_get_full_text": {
        "fn": news.get_full_text,
        "description": (news.get_full_text.__doc__ or "").strip()
        or "Fetch full text/summary for a news article by ID",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "Article ID returned by news_search"},
            },
            "required": ["id"],
        },
    },
    "portfolio_get_holdings": {
        "fn": portfolio.get_holdings,
        "description": (portfolio.get_holdings.__doc__ or "").strip()
        or "Return holdings for a Wealthsimple user by email",
        "input_schema": {
            "type": "object",
            "properties": {
                "email": {
                    "type": "string",
                    "description": "Wealthsimple account email",
                }
            },
            "required": ["email"],
        },
    },
}


@server.list_tools()
async def list_tools() -> list[Tool]:
    """Advertise available tools to MCP clients."""
    return [
        Tool(
            name=name,
            description=meta["description"],
            inputSchema=meta["input_schema"],
        )
        for name, meta in REGISTERED_TOOLS.items()
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, object]):
    """Dispatch tool calls from MCP clients."""
    # Accept legacy/dotted names by normalizing dots to underscores
    resolved_name = name if name in REGISTERED_TOOLS else name.replace(".", "_")

    if resolved_name not in REGISTERED_TOOLS:
        raise ValueError(f"Unknown tool: {name}")

    fn = REGISTERED_TOOLS[resolved_name]["fn"]
    result = await fn(**arguments)

    # Return a simple text content block; callers can evolve this to structured
    # outputs if needed.
    return [TextContent(type="text", text=str(result))]


@app.command()
def stdio() -> None:
    """Start the server over stdin/stdout (default transport)."""

    async def _run() -> None:
        async with stdio_server() as (read, write):
            # The MCP Python SDK changed the `Server.run` signature to require
            # `initialization_options`. Keep compatibility with older versions
            # by inspecting the bound method signature at runtime.
            sig = inspect.signature(server.run)
            if "initialization_options" in sig.parameters:
                # Newer MCP SDK versions require InitializationOptions with
                # server metadata and capabilities. The helper constructs a
                # valid object for us.
                init_opts = server.create_initialization_options()
                await server.run(read, write, initialization_options=init_opts)
            else:
                await server.run(read, write)

    anyio.run(_run)


@app.command("list-tools")
def list_registered_tools() -> None:
    """Print the tools currently registered on the server."""
    for name, meta in REGISTERED_TOOLS.items():
        typer.echo(f"- {name}: {meta['description']}")


if __name__ == "__main__":
    app()
