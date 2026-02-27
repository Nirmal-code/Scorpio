import asyncio
import pytest

from mcp_server import tools


@pytest.mark.asyncio
async def test_ping():
    assert await tools.ping() == "pong"


@pytest.mark.asyncio
async def test_echo():
    msg = "hello"
    assert await tools.echo(msg) == msg
