import json
import asyncio
import os
import httpx
import logging
from openai import OpenAI
from dotenv import load_dotenv

from mcp import ClientSession
from supabase_runs import log_run
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


async def run_for_email(email: str) -> str:
    prompt = f"""
        You are my financial advisor providing educational, risk-managed portfolio guidance.

        Use MCP tools to gather:
        - Portfolio holdings and weights for user: {email}
        - Latest available metrics for each ticker
        - Recent ticker-specific news returned by tools

        Use your own lookup and recent news from the last day to gather:
        - Global volatility and macro regime indicators (see below for details)

        Provide information on how each of my holdings would be impacted by different macro regimes, and actionable recommendations on how to adjust my portfolio weights accordingly. Also give better stocks/tickers to invest in at the moment.

        --------------------------------
        GLOBAL VOLATILITY & MACRO REGIME ANALYSIS

        1. Evaluate major global risk channels that commonly drive equity volatility:
        - Interest rates & inflation sensitivity
        - Central bank tightening vs easing environments
        - Energy/oil price shocks
        - Geopolitical instability risk
        - Credit/liquidity stress
        - Currency strength/weakness
        - Global growth slowdown risk
        - Technology/growth risk sentiment

        --------------------------------
        PORTFOLIO OUTPUT

        1. Portfolio Overview
        - Sector/theme concentration risks
        - Exposure to macro sensitivity (growth, commodities, rates, speculative assets)
        - Key portfolio vulnerabilities

        2. For EACH holding:
        - Summary of latest tool-derived metrics and news
        - Base-case outlook
        - Key downside risks
        - Suggested action:
                [Add / Hold / Trim / Reduce / Exit]
        - Position sizing guidance using percentage ranges
                (e.g., trim 5–15%, add 5–10%)
        - Reasoning tied to BOTH company-specific and macro-regime considerations

        3. Portfolio-Level Actions
        - Top risks currently facing the portfolio
        - Opportunities created by current regime conditions
        - 3–6 prioritized actions I should take today

        --------------------------------
        RISK MANAGEMENT CONSTRAINTS

        - Use percentage ranges rather than exact dollar amounts unless tools provide cash balances.
        - Never guarantee outcomes.
        - Prefer diversification and risk-adjusted thinking over aggressive predictions.
        - If information is missing, explicitly state uncertainty rather than guessing.

        Return output as a clean, structured markdown investment report. Don't include my email or a follow up prompt in the output of this.
        """
    result = await run_agent(prompt)
    # store + deliver (optional)
    await log_run(email, result)
    return result
