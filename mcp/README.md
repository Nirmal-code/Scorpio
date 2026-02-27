# MCP Server

Scaffold for a Model Context Protocol (MCP) server. This layout separates the server runtime, tool implementations, and tests so you can iterate quickly.

## Getting started

1. Create a virtual environment (optional)
   ```bash
   cd mcp
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies
   ```bash
   pip install -e .
   ```
3. Run the server (stdout/stdio transport)
   ```bash
   python -m mcp_server.server
   ```

## Layout
- `src/mcp_server/server.py` – entrypoint; wires transports and registers tools.
- `src/mcp_server/tools.py` – place MCP tool implementations here.
- `tests/` – quick smoke tests; add protocol-level tests as you build tools.
- `pyproject.toml` – package metadata and dependencies.

## Next steps
- Add real tool implementations in `tools.py`.
- Register tools by adding them to `REGISTERED_TOOLS` in `server.py`.
- Add integration tests that exercise tool calls via the MCP protocol.
