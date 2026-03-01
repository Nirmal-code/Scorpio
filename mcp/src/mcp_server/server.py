"""
Entrypoint for the MCP server.

- Supports stdio transport (for local MCP clients that spawn the server).
- Supports Streamable HTTP transport at /mcp (for remote clients).

Key fix: FastMCP tools are registered with explicit function signatures
(ticker/email/etc.) so the tool schemas are correct (no more `kwargs`).
"""
from __future__ import annotations

import inspect

import anyio
import typer
from mcp.server import Server
from mcp.server.fastmcp import FastMCP
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from mcp_server import market_tools as market
from mcp_server import news_tools as news
from mcp_server import portfolio_tools as portfolio

app = typer.Typer(help="Run the MCP server")

# --- STDIO server (optional) ---
server = Server("scorpio-mcp")

# Simple tool registry: name -> metadata + callable
REGISTERED_TOOLS = {
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
    "portfolio_set_preference": {
        "fn": portfolio.set_preference,
        "description": (portfolio.set_preference.__doc__ or "").strip()
        or "Upsert a preference for a Wealthsimple user by email",
        "input_schema": {
            "type": "object",
            "properties": {
                "email": {
                    "type": "string",
                    "description": "Wealthsimple account email",
                },
                "preference": {
                    "type": "string",
                    "description": "Preference payload (JSON string or text)",
                },
            },
            "required": ["email", "preference"],
        },
    },
    "portfolio_post_holdings": {
        "fn": portfolio.post_holdings_for_user,
        "description": (portfolio.post_holdings_for_user.__doc__ or "").strip()
        or "Fetch holdings from Wealthsimple and upsert to Supabase by email",
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
    "portfolio_get_preference": {
        "fn": portfolio.get_preference,
        "description": (portfolio.get_preference.__doc__ or "").strip()
        or "Get the preference entry for a Wealthsimple user by email",
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
    """Advertise available tools to MCP clients (stdio transport)."""
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
    """Dispatch tool calls from MCP clients (stdio transport)."""
    resolved_name = name if name in REGISTERED_TOOLS else name.replace(".", "_")

    if resolved_name not in REGISTERED_TOOLS:
        raise ValueError(f"Unknown tool: {name}")

    # Normalize the legacy/incorrect "kwargs" wrapper pattern if it shows up
    if (
        isinstance(arguments, dict)
        and set(arguments.keys()) == {"kwargs"}
        and isinstance(arguments.get("kwargs"), dict)
    ):
        arguments = arguments["kwargs"]

    fn = REGISTERED_TOOLS[resolved_name]["fn"]
    result = await fn(**arguments)
    return [TextContent(type="text", text=str(result))]


@app.command()
def stdio() -> None:
    """Start the server over stdin/stdout (stdio transport)."""

    async def _run() -> None:
        async with stdio_server() as (read, write):
            sig = inspect.signature(server.run)
            if "initialization_options" in sig.parameters:
                init_opts = server.create_initialization_options()
                await server.run(read, write, initialization_options=init_opts)
            else:
                await server.run(read, write)

    anyio.run(_run)


# --- Streamable HTTP server (FastMCP) ---
mcp = FastMCP(
    name="scorpio-mcp",
    host="0.0.0.0",
    port=8000,
)

# Register tools on FastMCP with explicit signatures (NO **kwargs)
@mcp.tool(description=REGISTERED_TOOLS["market_get_snapshot"]["description"])
async def market_get_snapshot(ticker: str):
    return await market.get_snapshot(ticker=ticker)


@mcp.tool(description=REGISTERED_TOOLS["news_search"]["description"])
async def news_search(ticker: str, since_iso: str | None = None, limit: int = 50):
    return await news.search(ticker=ticker, since_iso=since_iso, limit=limit)


@mcp.tool(description=REGISTERED_TOOLS["news_get_full_text"]["description"])
async def news_get_full_text(id: str):
    return await news.get_full_text(id=id)


@mcp.tool(description=REGISTERED_TOOLS["portfolio_get_holdings"]["description"])
async def portfolio_get_holdings(email: str):
    return await portfolio.get_holdings(email=email)


@mcp.tool(description=REGISTERED_TOOLS["portfolio_set_preference"]["description"])
async def portfolio_set_preference(email: str, preference: str):
    return await portfolio.set_preference(email=email, preference=preference)


@mcp.tool(description=REGISTERED_TOOLS["portfolio_post_holdings"]["description"])
async def portfolio_post_holdings(email: str):
    return await portfolio.post_holdings_for_user(email=email)


@mcp.tool(description=REGISTERED_TOOLS["portfolio_get_preference"]["description"])
async def portfolio_get_preference(email: str):
    return await portfolio.get_preference(email=email)


@app.command("list-tools")
def list_registered_tools() -> None:
    """Print the tools currently registered in the registry."""
    for name, meta in REGISTERED_TOOLS.items():
        typer.echo(f"- {name}: {meta['description']}")


if __name__ == "__main__":
    # Default behavior for your Docker entrypoint: run HTTP MCP server
    mcp.run(
        transport="streamable-http",
        mount_path="/mcp",
    )