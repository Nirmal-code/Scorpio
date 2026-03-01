FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000

# If your entrypoint is `python -m yourpkg.server`
CMD ["python", "-m", "mcp_server.server"]