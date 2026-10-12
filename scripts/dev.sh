#!/usr/bin/env bash
set -euo pipefail

backend_port="${BACKEND_PORT:-8000}"
uv run uvicorn app.main:app --no-proxy-headers --reload --host 0.0.0.0 --port "$backend_port" &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM

npm exec vite -- --host 0.0.0.0
