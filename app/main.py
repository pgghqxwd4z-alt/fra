from __future__ import annotations

import base64
import binascii
import hmac
import ipaddress
import logging
import os
import time
from collections import OrderedDict, deque
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED
from starlette.types import ASGIApp

from .providers import AIProvider

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("quantsage")

MAX_BODY_BYTES = 8 * 1024 * 1024
RATE_LIMIT_WINDOW = max(1, int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60")))
RATE_LIMIT_QUOTA = max(1, int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "30")))
RATE_LIMIT_MAX_IDENTITIES = max(1, int(os.getenv("RATE_LIMIT_MAX_IDENTITIES", "4096")))
TRUST_PROXY_VALUE = os.getenv("TRUST_PROXY", "").strip().lower()
try:
    TRUSTED_PROXY_HOPS = max(0, int(TRUST_PROXY_VALUE))
except ValueError:
    TRUSTED_PROXY_HOPS = 1 if TRUST_PROXY_VALUE in {"1", "true", "yes", "on"} else 0
APP_USERNAME = os.getenv("APP_USERNAME", "user")
APP_PASSWORD = os.getenv("APP_PASSWORD")

if not APP_PASSWORD:
    logger.warning("APP_PASSWORD is not set; HTTP Basic auth is disabled.")

rate_windows: OrderedDict[str, deque[float]] = OrderedDict()


class AccessMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        path = scope.get("path", "")
        if APP_PASSWORD and path != "/health":
            authorization = headers.get("authorization", "")
            scheme, encoded = authorization.split(" ", 1) if " " in authorization else ("", "")
            valid = False
            if scheme.lower() == "basic":
                try:
                    decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
                    username, password = decoded.split(":", 1)
                    valid = username == APP_USERNAME and hmac.compare_digest(password, APP_PASSWORD)
                except (ValueError, UnicodeDecodeError, binascii.Error):
                    valid = False
            if not valid:
                await self._send_json(send, {"error": "Authentication required."}, HTTP_401_UNAUTHORIZED, {"www-authenticate": 'Basic realm="QuantSage"'})
                return

        if path.startswith("/api/"):
            content_length = headers.get("content-length", "")
            if content_length and content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
                await self._send_json(send, {"error": "Request body too large."}, 413)
                return

            now = time.monotonic()
            identity = client_identity(scope, headers)
            sweep_rate_windows(now)
            window = rate_windows.get(identity)
            if window is None:
                if len(rate_windows) >= RATE_LIMIT_MAX_IDENTITIES:
                    rate_windows.popitem(last=False)
                window = deque()
                rate_windows[identity] = window
            else:
                rate_windows.move_to_end(identity)
            while window and window[0] <= now - RATE_LIMIT_WINDOW:
                window.popleft()
            if len(window) >= RATE_LIMIT_QUOTA:
                await self._send_json(send, {"error": "Rate limit exceeded."}, 429)
                return
            window.append(now)

            total = 0
            sent = False

            async def limited_receive() -> dict[str, Any]:
                nonlocal total, sent
                message = await receive()
                if message["type"] == "http.request":
                    total += len(message.get("body", b""))
                    if total > MAX_BODY_BYTES:
                        if not sent:
                            sent = True
                            await self._send_json(send, {"error": "Request body too large."}, 413)
                        return {"type": "http.disconnect"}
                return message

            await self.app(scope, limited_receive, send)
            return

        await self.app(scope, receive, send)

    @staticmethod
    async def _send_json(send: Any, payload: dict[str, str], status_code: int, extra_headers: dict[str, str] | None = None) -> None:
        import json

        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))]
        for key, value in (extra_headers or {}).items():
            headers.append((key.encode("latin-1"), value.encode("latin-1")))
        await send({"type": "http.response.start", "status": status_code, "headers": headers})
        await send({"type": "http.response.body", "body": body})


def socket_identity(scope: dict[str, Any]) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


def client_identity(scope: dict[str, Any], headers: dict[str, str]) -> str:
    if TRUSTED_PROXY_HOPS <= 0:
        return socket_identity(scope)
    forwarded = headers.get("x-forwarded-for", "")
    addresses = [candidate.strip() for candidate in forwarded.split(",") if candidate.strip()]
    if len(addresses) >= TRUSTED_PROXY_HOPS:
        candidate = addresses[-TRUSTED_PROXY_HOPS]
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    return socket_identity(scope)


def sweep_rate_windows(now: float) -> None:
    expired_before = now - RATE_LIMIT_WINDOW
    for identity, window in list(rate_windows.items()):
        while window and window[0] <= expired_before:
            window.popleft()
        if not window:
            del rate_windows[identity]


app = FastAPI(title="QuantSage")
app.add_middleware(AccessMiddleware)
provider = AIProvider()


def error_response(error: Exception) -> JSONResponse:
    message = str(error) or "AI request failed"
    return JSONResponse({"error": message}, status_code=500)


def lens_instructions(lenses: list[str]) -> list[str]:
    instructions: list[str] = []
    for lens in lenses:
        if lens == "smc":
            instructions.append("SMC: Use observable structure. Do not invent BOS, CHoCH, FVG, OB or liquidity levels.")
        elif lens == "gs":
            instructions.append("INSTITUTIONAL / MACRO: Use macro/intermarket claims only when supplied or retrieved from legitimate evidence.")
        elif lens == "psych":
            instructions.append("PSYCHOLOGY: Apply retrieved probability/discipline principles. Do not claim private positioning as fact.")
        elif lens == "ppa":
            instructions.append("PURE PRICE ACTION: Analyze observable swing structure, momentum, rejection, expansion and support/resistance.")
    return instructions


@app.post("/api/knowledge/search")
async def knowledge_search(payload: dict[str, Any]) -> Any:
    try:
        prompt = payload.get("prompt", "")
        lenses = payload.get("lenses", ["smc"])
        market_context = payload.get("marketContext", "")
        return await provider.retrieve_knowledge(prompt, lenses, market_context)
    except Exception as error:
        logger.exception("Knowledge Retrieval Error:")
        return error_response(error)


@app.post("/api/annotate")
async def annotate(payload: dict[str, Any]) -> Any:
    try:
        prompt = payload.get("prompt", "")
        lenses = payload.get("lenses", ["smc"])
        market_context = payload.get("marketContext", "")
        knowledge = await provider.retrieve_knowledge(prompt, lenses, market_context)
        return await provider.annotate(
            payload.get("base64Image", ""),
            prompt,
            lenses,
            market_context,
            "\n".join(lens_instructions(lenses)),
            knowledge,
        )
    except Exception as error:
        logger.exception("Annotate error:")
        return error_response(error)


@app.post("/api/chat")
async def chat(payload: dict[str, Any]) -> Any:
    try:
        return await provider.chat(payload.get("prompt", ""), payload.get("history", []))
    except Exception as error:
        logger.exception("Chat error:")
        return error_response(error)


CLIENT_DIST = Path.cwd() / "dist" / "client"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/{full_path:path}")
async def static_files(full_path: str) -> Any:
    if not CLIENT_DIST.is_dir():
        return JSONResponse({"error": "Client build not found."}, status_code=404)
    requested = (CLIENT_DIST / full_path).resolve()
    if CLIENT_DIST not in requested.parents and requested != CLIENT_DIST:
        return JSONResponse({"error": "Not found."}, status_code=404)
    if requested.is_file():
        return FileResponse(requested)
    if Path(full_path).suffix:
        return JSONResponse({"error": "Not found."}, status_code=404)
    return FileResponse(CLIENT_DIST / "index.html")
