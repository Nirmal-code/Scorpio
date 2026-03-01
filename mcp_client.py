import json
import asyncio
import os
import httpx
import logging
from openai import OpenAI
from dotenv import load_dotenv

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client  # from mcp python-sdk

load_dotenv()  # pulls env vars from .env if present

OPENAI_MODEL = "gpt-4.1-mini"  # pick any tool-calling capable model you use

MCP_URL = os.getenv("MCP_URL")
if not MCP_URL:
    raise RuntimeError("Set MCP_URL in your environment or .env before running mcp_client.py")

_mcp_token = os.getenv("MCP_BEARER_TOKEN")
if not _mcp_token:
    raise RuntimeError("Set MCP_BEARER_TOKEN in your environment or .env before running mcp_client.py")
MCP_BEARER = f"Bearer {_mcp_token}"

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("Set OPENAI_API_KEY in your environment or .env before running mcp_client.py")

client = OpenAI(api_key=api_key)

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")
# Discord is optional; if unset we'll print to stdout

# Logging setup
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FILE = os.getenv("LOG_FILE")  # optional path to also write logs
logger = logging.getLogger("mcp_client")
if not logger.handlers:
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    if LOG_FILE:
        fh = logging.FileHandler(LOG_FILE)
        fh.setFormatter(fmt)
        logger.addHandler(fh)

def mcp_tools_to_openai(tools):
    # MCP Tool has: name, description, inputSchema
    openai_tools = []
    for t in tools:
        # Defensive: tolerate tuples/dicts if upstream changes
        name = (
            getattr(t, "name", None)
            or (t.get("name") if isinstance(t, dict) else None)
            or (t[0] if isinstance(t, (list, tuple)) and t else None)
            or getattr(t, "title", None)
        )
        desc = (
            getattr(t, "description", None)
            or (t.get("description") if isinstance(t, dict) else None)
            or ""
        )
        params = (
            getattr(t, "inputSchema", None)
            or (t.get("inputSchema") if isinstance(t, dict) else None)
            or {"type": "object", "properties": {}}
        )
        if not name:
            # Skip anything that doesn't look like a tool
            logger.debug("Skipping non-tool entry: %s", t)
            continue
        logger.info("Registering MCP tool with OpenAI: %s", name)
        openai_tools.append({
            "type": "function",
            "name": name,
            "description": desc,
            "parameters": params,
        })
    return openai_tools


def format_for_discord(raw: str) -> str:
    """
    Convert free-form model text into Discord-friendly Markdown:
    - Bold heading per ticker
    - Bullet the supporting lines
    """
    if not raw:
        return "(empty response)"

    blocks = [b.strip() for b in raw.strip().split("\n\n") if b.strip()]
    formatted_lines = []
    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        heading = lines[0].rstrip(":")
        formatted_lines.append(f"**{heading}**")
        for ln in lines[1:]:
            prefix = "" if ln.startswith(("-", "•")) else "- "
            formatted_lines.append(f"{prefix}{ln}")
    return "\n".join(formatted_lines)


def format_blocks_for_discord(raw: str) -> list[str]:
    """
    Split the model output into one message per stock block and format each nicely.
    """
    if not raw:
        return ["(empty response)"]

    blocks = [b.strip() for b in raw.strip().split("\n\n") if b.strip()]
    messages = []
    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        heading = lines[0].rstrip(":")
        body = []
        for ln in lines[1:]:
            # strip leading bullets/dashes from model output to avoid double bullets
            cleaned = ln.lstrip("-• ").strip()
            body.append(f"• {cleaned}")
        msg = f"**📌 {heading}**"
        if body:
            msg += "\n" + "\n".join(body)
        msg += "\n──────────────────────"
        messages.append(msg)
    return messages or ["(no parsed blocks)"]


def _chunk_for_discord(text: str, limit: int = 1900):
    """Yield chunks <= limit, trying to split on paragraph boundaries first."""
    text = text or "(empty response)"
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        yield text[:limit]
        return
    current = ""
    for para in paragraphs:
        candidate = (current + "\n\n" + para).strip() if current else para
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                yield current
            # If single paragraph is too long, hard split it
            while len(para) > limit:
                yield para[:limit]
                para = para[limit:]
            current = para
    if current:
        yield current

async def run_agent(user_prompt: str) -> str:
    def _flatten_exceptions(exc):
        if isinstance(exc, BaseExceptionGroup):
            flattened = []
            for sub in exc.exceptions:
                flattened.extend(_flatten_exceptions(sub))
            return flattened
        return [exc]

    try:
        async with httpx.AsyncClient(headers={"Authorization": MCP_BEARER}) as http_client:
            async with streamable_http_client(
                MCP_URL,
                http_client=http_client,
            ) as (read_stream, write_stream, _get_session_id):

                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()

                    logger.info("Requesting tool list from MCP server...")
                    tools_result = await session.list_tools()

                    def extract_tool_list(result):
                        # Preferred: attr .tools from ListToolsResult
                        if hasattr(result, "tools"):
                            return result.tools
                        # Dict response
                        if isinstance(result, dict):
                            if "tools" in result:
                                return result["tools"]
                        # List of key/value tuples
                        if isinstance(result, (list, tuple)):
                            # If looks like [('meta', ...), ('tools', [...])]
                            if all(isinstance(x, tuple) and len(x) == 2 for x in result):
                                for k, v in result:
                                    if k == "tools":
                                        return v
                                return []
                            return list(result)
                        return []

                    mcp_tools = extract_tool_list(tools_result)
                    logger.info("Tools available from MCP server: %s", mcp_tools)
                    tools = mcp_tools_to_openai(mcp_tools)

                    # 1) ask model
                    logger.info("Sending prompt to OpenAI model...")
                    response = client.responses.create(
                        model=OPENAI_MODEL,
                        input=user_prompt,
                        tools=tools,
                    )

                    # 2) tool loop
                    while True:
                        tool_calls = [item for item in response.output if item.type == "function_call"]
                        if not tool_calls:
                            logger.info("No tool calls in response; finishing.")
                            break

                        outputs = []
                        for call in tool_calls:
                            tool_name = call.name
                            args = json.loads(call.arguments or "{}")

                            # Call MCP tool
                            logger.info("Calling MCP tool %s with args %s", tool_name, args)
                            result = await session.call_tool(tool_name, args)
                            logger.info("Result from %s: %s", tool_name, result)

                            outputs.append({
                                "type": "function_call_output",
                                "call_id": call.call_id,
                                "output": json.dumps(result, default=str),
                            })

                        # 3) send tool outputs back to model
                        logger.info("Sending tool outputs back to OpenAI...")
                        response = client.responses.create(
                            model=OPENAI_MODEL,
                            input=outputs,
                            previous_response_id=response.id,
                            tools=tools,
                        )

                    logger.info("Model run complete.")
                    return response.output_text
    except Exception as e:
        root_causes = _flatten_exceptions(e)
        cause_msgs = "; ".join(str(c) for c in root_causes)
        raise RuntimeError(f"Failed to reach MCP server at {MCP_URL}: {cause_msgs}") from e
    
def _chunk_for_discord(text: str, limit: int = 1900):
    """Yield chunks <= limit, trying to split on paragraph boundaries first."""
    text = text or "(empty response)"
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        yield text[:limit]
        return
    current = ""
    for para in paragraphs:
        candidate = (current + "\n\n" + para).strip() if current else para
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                yield current
            # If single paragraph is too long, hard split it
            while len(para) > limit:
                yield para[:limit]
                para = para[limit:]
            current = para
    if current:
        yield current


async def post_to_discord(content: str):
    async with httpx.AsyncClient(timeout=20) as c:
        for chunk in _chunk_for_discord(content):
            r = await c.post(DISCORD_WEBHOOK_URL, json={"content": chunk})
            r.raise_for_status()


async def post_blocks_to_discord(blocks: list[str]):
    async with httpx.AsyncClient(timeout=20) as c:
        for block in blocks:
            # Try to keep each stock in a single message if possible
            for chunk in _chunk_for_discord(block, limit=1900):
                while True:
                    r = await c.post(DISCORD_WEBHOOK_URL, json={"content": chunk})
                    if r.status_code != 429:
                        r.raise_for_status()
                        break
                    # Respect Discord rate limit hint
                    try:
                        retry_after = r.json().get("retry_after", 0.3)
                    except Exception:
                        retry_after = 0.3
                    logger.warning("Rate limited by Discord. Retrying after %s seconds", retry_after)
                    await asyncio.sleep(retry_after)
        # Send a final divider message
        divider = "────────── End of Scorpio update ──────────"
        r = await c.post(DISCORD_WEBHOOK_URL, json={"content": divider})
        if r.status_code == 429:
            try:
                retry_after = r.json().get("retry_after", 0.3)
            except Exception:
                retry_after = 0.3
            logger.warning("Rate limited by Discord on divider. Retrying after %s seconds", retry_after)
            await asyncio.sleep(retry_after)
            r = await c.post(DISCORD_WEBHOOK_URL, json={"content": divider})
        r.raise_for_status()


if __name__ == "__main__":
    try:
        result = asyncio.run(
            run_agent("Given the holdings of user with email: nirmalc10272003@gmail.com and their preferences can you please determine what they should do with their profile given all the news and metrics for each relevant stock today. Be comprehensive with analysis of news.")
        )
        formatted_blocks = format_blocks_for_discord(result)
        if DISCORD_WEBHOOK_URL:
            logger.info("Sending results to Discord webhook...")
            asyncio.run(post_blocks_to_discord(formatted_blocks))
        else:
            logger.warning("No delivery channel configured; printing to stdout.")
            print("\n\n".join(formatted_blocks))
    except Exception as e:
        # Also notify failures to Discord if you want:
        try:
            if DISCORD_WEBHOOK_URL:
                asyncio.run(post_to_discord(f"Scorpio job failed: {e}"))
        except Exception:
            pass
        raise SystemExit(1)
