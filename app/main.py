from __future__ import annotations

import base64
import binascii
import asyncio
import copy
import hmac
import ipaddress
import json
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

from .forecast_log import recent, record_forecast, score_pending, stats
from .library import search_library
from .market import fetch_market_data, resolve_instrument
from .providers import AIProvider
from .research import fetch_market_research
from .risk import calculate_risk

load_dotenv()
logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("quantsage")

MAX_BODY_BYTES = 8 * 1024 * 1024
RATE_LIMIT_WINDOW = max(1, int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60")))
RATE_LIMIT_QUOTA = max(1, int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "30")))
RATE_LIMIT_MAX_IDENTITIES = max(1, int(os.getenv("RATE_LIMIT_MAX_IDENTITIES", "4096")))
GROQ_SCAN_TIMEOUT_SECONDS = 15
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
                    valid = username == APP_USERNAME and hmac.compare_digest(
                        password.encode("utf-8"), APP_PASSWORD.encode("utf-8")
                    )
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


def consensus_enabled() -> bool:
    return os.getenv("CONSENSUS_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def groq_scan_enabled() -> bool:
    return os.getenv("GROQ_SCAN_ENABLED", "").strip().lower() not in {"", "0", "false", "no"}


def merge_local_knowledge(knowledge: dict[str, Any], prompt: str, lenses: list[str]) -> dict[str, Any]:
    try:
        hits = search_library(prompt, lenses)
    except Exception as error:
        logger.warning("Local knowledge search failed: %s", error)
        return knowledge
    if not hits:
        return knowledge

    local_items = [
        {
            "sourceId": hit["sourceId"],
            "sourceTitle": hit["title"],
            "kind": hit["kind"],
            "principle": hit["principle"],
            "relevance": hit["application"],
            "isLocal": True,
        }
        for hit in hits
    ]
    local_context = "\n\n".join(
        f"{index}. {hit['title']}\n"
        f"Section: {hit['section']}\n"
        f"Principle: {hit['principle']}\n"
        f"Relevance: {hit['application']}\n"
        "Source: local document"
        for index, hit in enumerate(hits, start=1)
    )
    merged = dict(knowledge)
    merged["items"] = local_items + list(knowledge.get("items", []))
    existing_context = knowledge.get("context", "")
    merged["context"] = (
        f"{existing_context}\n\nLOCAL LIBRARY (user-supplied documents)\n{local_context}"
        if existing_context
        else f"LOCAL LIBRARY (user-supplied documents)\n{local_context}"
    )
    return merged


async def retrieve_knowledge_with_library(
    prompt: str,
    lenses: list[str],
    market_context: str,
) -> dict[str, Any]:
    try:
        knowledge = await provider.retrieve_knowledge(prompt, lenses, market_context)
    except Exception as error:
        logger.warning("Knowledge retrieval failed; continuing without external knowledge: %s", error)
        knowledge = {
            "items": [],
            "context": "NO EXTERNAL KNOWLEDGE RETRIEVED.",
            "warnings": [f"Knowledge retrieval failed: {error}"],
        }
    return merge_local_knowledge(knowledge, prompt, lenses)


def consensus_engines() -> list[str]:
    configured = [value.strip().lower() for value in os.getenv("CONSENSUS_ENGINES", "openai,claude,gemini").split(",")]
    engines: list[str] = []
    for engine in [provider.name, *configured]:
        if engine not in {"openai", "groq", "claude", "gemini"} or not provider.has_engine(engine) or engine in engines:
            continue
        engines.append(engine)
    return engines


def build_consensus(
    successes: list[dict[str, Any]],
    failures: list[dict[str, str]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    models = [
        {
            "engine": result["engine"],
            "model": result["model"],
            "bias": result["forecast"]["bias"],
            "direction": result["forecast"]["entry"]["direction"],
            "confidence": result["forecast"]["confidence"],
            "tp1": result["forecast"]["targets"]["tp1"],
            "invalidation": result["forecast"]["invalidation"],
            "nextMove": result["forecast"]["nextMove"],
        }
        for result in successes
    ]
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for model in models:
        groups.setdefault((model["bias"], model["direction"]), []).append(model)
    winning_group = max(groups.values(), key=len) if groups else []
    support = len(winning_group)
    total = len(models)
    vote_bias = winning_group[0]["bias"] if winning_group else None
    vote_direction = winning_group[0]["direction"] if winning_group else None
    if len(models) < 2:
        verdict = "SINGLE"
    else:
        biases = {model["bias"] for model in models}
        directions = {model["direction"] for model in models}
        opposite_biases = {"BULLISH", "BEARISH"} <= biases
        opposite_directions = {"BUY", "SELL"} <= directions
        if support == total:
            verdict = "AGREE"
        elif support > total / 2:
            verdict = "MAJORITY"
        elif opposite_biases or opposite_directions:
            verdict = "CONFLICT"
        else:
            verdict = "PARTIAL"
    notes = " vs ".join(
        f"{model['engine']} {model['bias']}/{model['direction']} {model['confidence']}" for model in models
    )
    confidences = [model["confidence"] for model in models]
    consensus = {
        "verdict": verdict,
        "models": models,
        "biasAgreement": len({model["bias"] for model in models}) <= 1,
        "directionAgreement": len({model["direction"] for model in models}) <= 1,
        "confidenceSpread": max(confidences) - min(confidences) if confidences else 0,
        "notes": notes,
        "failures": failures,
        "vote": {"bias": vote_bias, "direction": vote_direction, "support": support, "total": total},
        "selectedEngine": successes[0]["engine"] if successes else None,
    }
    selected = successes[0]
    if verdict == "MAJORITY":
        winning_engines = {model["engine"] for model in winning_group}
        if selected["engine"] not in winning_engines:
            selected_model = max(winning_group, key=lambda model: model["confidence"])
            selected = next(result for result in successes if result["engine"] == selected_model["engine"])
        consensus["selectedEngine"] = selected["engine"]
    return consensus, selected


def apply_consensus_cap(result: dict[str, Any], consensus: dict[str, Any]) -> None:
    forecast = result["forecast"]
    verdict = consensus["verdict"]
    if verdict == "MAJORITY":
        forecast["confidence"] = min(forecast["confidence"], 70)
        forecast.setdefault("warnings", []).append(
            f"Model consensus majority: {consensus['vote']['support']}/{consensus['vote']['total']} — {consensus['notes']}."
        )
    elif verdict == "PARTIAL":
        forecast["confidence"] = min(forecast["confidence"], 60)
        forecast.setdefault("warnings", []).append(f"Model consensus partial: {consensus['notes']}.")
    elif verdict == "CONFLICT":
        forecast["confidence"] = min(forecast["confidence"], 45)
        forecast.setdefault("warnings", []).append(f"Model consensus conflict: {consensus['notes']}.")
    elif verdict == "SINGLE":
        for failure in consensus["failures"]:
            forecast.setdefault("warnings", []).append(f"Consensus unavailable: {failure['engine']} failed.")
    result["consensus"] = consensus
    result["analysis"] = json.dumps(forecast, separators=(",", ":"), ensure_ascii=False)


@app.post("/api/knowledge/search")
async def knowledge_search(payload: dict[str, Any]) -> Any:
    try:
        prompt = payload.get("prompt", "")
        lenses = payload.get("lenses", ["smc"])
        market_context = payload.get("marketContext", "")
        return await retrieve_knowledge_with_library(prompt, lenses, market_context)
    except Exception as error:
        logger.exception("Knowledge Retrieval Error:")
        return error_response(error)


@app.post("/api/annotate")
async def annotate(payload: dict[str, Any]) -> Any:
    try:
        prompt = payload.get("prompt", "")
        lenses = payload.get("lenses", ["smc"])
        market_context = payload.get("marketContext", "")
        instrument = resolve_instrument(payload.get("instrument"), prompt)
        market_data_result, research_result = await asyncio.gather(
            fetch_market_data(instrument),
            fetch_market_research(provider, instrument),
            return_exceptions=True,
        )
        market_data = (
            market_data_result
            if not isinstance(market_data_result, Exception)
            else None
        )
        if isinstance(market_data_result, Exception):
            logger.warning("Oanda market data failed unexpectedly: %s", market_data_result)
        market_research = (
            research_result
            if not isinstance(research_result, Exception)
            else None
        )
        if isinstance(research_result, Exception):
            logger.warning("External market research failed unexpectedly: %s", research_result)
        context_parts = [
            market_context if isinstance(market_context, str) and market_context.strip() else "",
            market_data.context if market_data else "",
            market_research.context if market_research else "",
        ]
        market_context = "\n\n".join(part for part in context_parts if part)
        knowledge = await retrieve_knowledge_with_library(prompt, lenses, market_context)
        instructions = "\n".join(lens_instructions(lenses))
        engines = consensus_engines()
        use_consensus = consensus_enabled() and len(engines) >= 2
        if not use_consensus:
            engines = [provider.name]
        forecast_tasks = [
            provider.annotate(
                payload.get("base64Image", ""),
                prompt,
                lenses,
                market_context,
                instructions,
                knowledge,
                engine=engine,
            )
            for engine in engines
        ]
        scan_enabled = groq_scan_enabled() and provider.has_engine("groq")
        scan_attempt: Any = None
        if scan_enabled:
            gathered = await asyncio.gather(
                *forecast_tasks,
                asyncio.wait_for(
                    provider.scan(payload.get("base64Image", ""), prompt, instrument),
                    timeout=GROQ_SCAN_TIMEOUT_SECONDS,
                ),
                return_exceptions=True,
            )
            attempts = gathered[:-1]
            scan_attempt = gathered[-1]
            if isinstance(scan_attempt, BaseException):
                logger.warning("Groq scan failed: %s", scan_attempt)
        else:
            if use_consensus:
                attempts = await asyncio.gather(*forecast_tasks, return_exceptions=True)
            else:
                attempts = [await forecast_tasks[0]]
        successes: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        for engine, attempt in zip(engines, attempts):
            if isinstance(attempt, Exception):
                logger.warning("Consensus %s annotation failed: %s", engine, attempt)
                failures.append({"engine": engine, "error": str(attempt)})
            else:
                successes.append(attempt)
        if not successes:
            first_failure = next((attempt for attempt in attempts if isinstance(attempt, Exception)), RuntimeError("AI request failed"))
            raise first_failure
        consensus, result = build_consensus(successes, failures)
        raw_forecasts = [copy.deepcopy(model_result.get("forecast")) for model_result in successes]
        apply_consensus_cap(result, consensus)
        if market_data:
            result["marketVerification"] = market_data.verification
        if market_research:
            result["marketResearch"] = market_research.metadata
        result["risk"] = calculate_risk(
            result.get("forecast", {}),
            market_data.verification if market_data else None,
        )
        if isinstance(scan_attempt, dict):
            result["scan"] = scan_attempt
        try:
            forecast_ids = []
            forecast_ids_by_engine: dict[str, str | None] = {}
            for model_result, forecast in zip(successes, raw_forecasts):
                forecast_id = (
                    await asyncio.to_thread(
                        record_forecast,
                        forecast,
                        instrument,
                        market_data.verification if market_data else None,
                        model_result.get("engine"),
                        consensus,
                    )
                    if isinstance(forecast, dict)
                    else None
                )
                forecast_ids.append(forecast_id)
                engine = model_result.get("engine")
                if isinstance(engine, str):
                    forecast_ids_by_engine[engine] = forecast_id
            selected_engine = consensus.get("selectedEngine")
            selected_forecast_id = forecast_ids_by_engine.get(selected_engine)
            if selected_forecast_id:
                result["forecastId"] = selected_forecast_id
        except Exception as error:
            logger.warning("Forecast logging failed: %s", error)
        return result
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


@app.get("/api/forecasts")
async def forecasts() -> dict[str, Any]:
    await score_pending(limit=20)
    return {"forecasts": await recent(50), "stats": await stats()}


@app.post("/api/forecasts/score")
async def score_forecasts() -> dict[str, int]:
    return await score_pending(limit=100)


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
