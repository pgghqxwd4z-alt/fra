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
from .citations import check_citations
from .grounding import check_level_grounding
from .library import search_library
from .lenses import lens_instructions
from .market import fetch_market_data, fetch_ohlcv_series, normalize_timeframe, resolve_instrument
from .providers import AIProvider, SafeMessageError, normalize_validator
from .research import fetch_market_research, fetch_validation_research
from .retry import retry_with_backoff
from .risk import calculate_risk
from .synthesis import run_synthesis, select_lens_forecast

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
    message = str(error) if isinstance(error, SafeMessageError) else "AI request failed."
    return JSONResponse({"error": message}, status_code=500)


def consensus_enabled() -> bool:
    return os.getenv("CONSENSUS_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def validator_enabled() -> bool:
    return os.getenv("VALIDATOR_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


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
            "warnings": ["External knowledge retrieval unavailable; using local library only."],
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


def apply_validation(
    result: dict[str, Any],
    validation: dict[str, Any],
    engine: str,
    cross_provider: bool,
) -> dict[str, Any]:
    normalized = normalize_validator(validation)
    forecast = result["forecast"]
    penalty = normalized["confidencePenalty"]
    try:
        confidence = int(round(float(forecast.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0
    forecast["confidence"] = max(0, confidence - penalty)
    warnings = forecast.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
        forecast["warnings"] = warnings
    warnings.append(f"Forecast validation by {engine}: {normalized['verdict']}.")
    for finding in normalized["findings"]:
        if finding["ruling"] == "REJECTED":
            warnings.append(f"Validation rejected: {finding['claim']} — {finding['reason']}")
    result["analysis"] = json.dumps(forecast, separators=(",", ":"), ensure_ascii=False)
    result["validation"] = {
        "engine": engine,
        "crossProvider": cross_provider,
        "verdict": normalized["verdict"],
        "chartAgreement": normalized["chartAgreement"],
        "confidencePenalty": penalty,
        "findings": normalized["findings"],
        "note": normalized["note"],
    }
    return normalized


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
        timeframe = normalize_timeframe(payload.get("timeframe"))
        market_data_result, ohlcv_result, research_result = await asyncio.gather(
            fetch_market_data(instrument),
            fetch_ohlcv_series(instrument, timeframe),
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
        ohlcv_series = (
            ohlcv_result
            if not isinstance(ohlcv_result, Exception)
            else None
        )
        if isinstance(ohlcv_result, Exception):
            logger.warning("OHLCV series failed unexpectedly: %s", ohlcv_result)
        market_research = (
            research_result
            if not isinstance(research_result, Exception)
            else None
        )
        if isinstance(research_result, Exception):
            logger.warning("External market research failed unexpectedly: %s", research_result)
        retrieval_context_parts = [
            market_context if isinstance(market_context, str) and market_context.strip() else "",
            market_data.context if market_data else "",
            market_research.context if market_research else "",
        ]
        retrieval_context = "\n\n".join(part for part in retrieval_context_parts if part)
        context_parts = [
            retrieval_context,
            ohlcv_series.context if ohlcv_series else "",
        ]
        market_context = "\n\n".join(part for part in context_parts if part)
        knowledge = await retrieve_knowledge_with_library(prompt, lenses, retrieval_context)
        engines = consensus_engines()
        use_consensus = consensus_enabled() and len(engines) >= 2
        if not use_consensus:
            engines = [provider.name]
        per_lens = len(lenses) >= 2
        if per_lens:
            # Multi-lens analysis is intentionally kept on the primary engine; the
            # existing cross-engine consensus path remains unchanged for one lens.
            attempt_specs = [(provider.name, lens) for lens in lenses]
        else:
            attempt_specs = [(engine, None) for engine in engines]
        forecast_tasks = []
        for engine, lens in attempt_specs:
            call_lenses = [lens] if lens else lenses
            instructions = "\n".join(lens_instructions(call_lenses))
            forecast_tasks.append(
                retry_with_backoff(
                    lambda engine=engine, call_lenses=call_lenses, instructions=instructions: provider.annotate(
                        payload.get("base64Image", ""),
                        prompt,
                        call_lenses,
                        market_context,
                        instructions,
                        knowledge,
                        engine=engine,
                    ),
                    engine,
                    "analyst annotate",
                )
            )
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
            if per_lens or use_consensus:
                attempts = await asyncio.gather(*forecast_tasks, return_exceptions=True)
            else:
                attempts = [await forecast_tasks[0]]
        successes: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        success_lenses: list[tuple[str | None, str]] = []
        for (engine, lens), attempt in zip(attempt_specs, attempts):
            if isinstance(attempt, Exception):
                logger.warning("Consensus %s annotation failed: %s", engine, attempt)
                failure = {
                    "engine": engine,
                    "error": str(attempt)
                    if isinstance(attempt, SafeMessageError)
                    else f"{engine} request failed",
                }
                if lens:
                    failure["lens"] = lens
                failures.append(failure)
            else:
                check_citations(attempt["forecast"])
                successes.append(attempt)
                success_lenses.append((lens, engine))
        if not successes:
            first_failure = next((attempt for attempt in attempts if isinstance(attempt, Exception)), RuntimeError("AI request failed"))
            raise first_failure
        if per_lens:
            consensus = None
            result = successes[0]
            lens_runs = []
            for (lens, _engine), attempt in zip(success_lenses, successes):
                forecast = attempt.get("forecast", {})
                entry = forecast.get("entry") if isinstance(forecast.get("entry"), dict) else {}
                lens_runs.append(
                    {
                        "lens": lens,
                        "bias": forecast.get("bias"),
                        "confidence": forecast.get("confidence"),
                        "entryZone": entry.get("zone"),
                        "invalidation": forecast.get("invalidation"),
                    }
                )
            for failure in failures:
                if isinstance(failure.get("lens"), str):
                    lens_runs.append(
                        {
                            "lens": failure["lens"],
                            "failed": failure["error"],
                        }
                    )
            result["lensRuns"] = lens_runs
        else:
            consensus, result = build_consensus(successes, failures)
            selected_forecast = result.get("forecast", {})
            selected_entry = selected_forecast.get("entry") if isinstance(selected_forecast.get("entry"), dict) else {}
            result["lensRuns"] = [
                {
                    "lens": lenses[0] if lenses else "unknown",
                    "bias": selected_forecast.get("bias"),
                    "confidence": selected_forecast.get("confidence"),
                    "entryZone": selected_entry.get("zone"),
                    "invalidation": selected_forecast.get("invalidation"),
                }
            ]
        if not instrument:
            grounding_reason = "instrument not recognised"
        elif not timeframe:
            grounding_reason = "timeframe not specified"
        elif not ohlcv_series:
            grounding_reason = "no candle feed available for this symbol and timeframe"
        else:
            grounding_reason = None
        result["dataGrounding"] = {
            "grounded": bool(ohlcv_series),
            "instrument": instrument,
            "timeframe": timeframe,
            "source": ohlcv_series.source if ohlcv_series else None,
            "proxy": ohlcv_series.proxy if ohlcv_series else False,
            "candles": len(ohlcv_series.candles) if ohlcv_series else 0,
            "reason": grounding_reason,
        }
        raw_forecasts = [copy.deepcopy(model_result.get("forecast")) for model_result in successes]
        if per_lens:
            synthesis_inputs = [
                {"lens": lens, "forecast": attempt.get("forecast", {})}
                for (lens, _engine), attempt in zip(success_lenses, successes)
                if lens
            ]
            synthesis_verified = False
            if len(synthesis_inputs) >= 2:
                try:
                    synthesis_result = await asyncio.wait_for(
                        run_synthesis(provider, synthesis_inputs),
                        timeout=25,
                    )
                    selected = select_lens_forecast(synthesis_result, synthesis_inputs)
                    selected_forecast = selected.get("forecast")
                    if not isinstance(selected_forecast, dict):
                        raise ValueError("Synthesis selected an invalid forecast.")
                    confluence = synthesis_result.get("confluence")
                    if confluence not in {"STRONG", "MODERATE", "WEAK"}:
                        confluence = "WEAK"
                    agreements = synthesis_result.get("agreements")
                    disagreements = synthesis_result.get("disagreements")
                    note = synthesis_result.get("note") if isinstance(synthesis_result.get("note"), str) else ""
                    result["forecast"] = selected_forecast
                    result["synthesis"] = {
                        "selectedLens": selected.get("lens"),
                        "confluence": confluence,
                        "agreements": agreements if isinstance(agreements, list) else [],
                        "disagreements": disagreements if isinstance(disagreements, list) else [],
                        "note": note,
                        "engine": "claude",
                    }
                    summary = note.strip().rstrip(".")
                    if not summary and isinstance(disagreements, list):
                        summary = "; ".join(
                            item.get("detail", "").strip().rstrip(".")
                            for item in disagreements
                            if isinstance(item, dict) and isinstance(item.get("detail"), str) and item.get("detail", "").strip()
                        )
                    if confluence in {"WEAK", "MODERATE"}:
                        cap = 45 if confluence == "WEAK" else 60
                        result["forecast"]["confidence"] = min(result["forecast"].get("confidence", 0), cap)
                        result["forecast"].setdefault("warnings", []).append(
                            f"Lens convergence {confluence.lower()}: {summary or 'lens analyses did not fully converge'}."
                        )
                    synthesis_verified = True
                except asyncio.TimeoutError:
                    logger.warning("Forecast synthesis timed out; continuing with existing selection.")
                    result["synthesisUnavailable"] = "forecast synthesis timed out"
                except Exception as error:
                    logger.warning("Forecast synthesis failed: %s", error)
                    result["synthesisUnavailable"] = "forecast synthesis unavailable"
            else:
                result["synthesisUnavailable"] = "forecast synthesis unavailable"
            if not synthesis_verified:
                result["forecast"]["confidence"] = min(result["forecast"].get("confidence", 0), 60)
                result["forecast"].setdefault("warnings", []).append(
                    "Lens convergence unverified: synthesis unavailable."
                )
            for failure in failures:
                lens = failure.get("lens")
                if isinstance(lens, str):
                    reason = failure["error"].rstrip(".")
                    result["forecast"].setdefault("warnings", []).append(
                        f"Lens {lens} failed: {reason}."
                    )
            result["analysis"] = json.dumps(
                result["forecast"],
                separators=(",", ":"),
                ensure_ascii=False,
            )
        else:
            apply_consensus_cap(result, consensus)
        grounding: dict[str, Any] | None = None
        if ohlcv_series:
            try:
                grounding = check_level_grounding(result["forecast"], ohlcv_series.candles)
            except Exception as error:
                logger.warning("Deterministic forecast grounding failed: %s", error)
        if grounding:
            result["grounding"] = grounding
            out_of_window = sum(
                finding.get("status") == "OUT_OF_WINDOW"
                for finding in grounding.get("findings", [])
                if isinstance(finding, dict)
            )
            if out_of_window:
                forecast = result["forecast"]
                forecast["confidence"] = min(forecast.get("confidence", 0), 45)
                forecast.setdefault("warnings", []).append(
                    f"{out_of_window} forecast level(s) fall outside the real candle window."
                )
                result["analysis"] = json.dumps(forecast, separators=(",", ":"), ensure_ascii=False)
        validation_result: dict[str, Any] | None = None
        validation_engine: str | None = None
        validation_cross_provider = False
        if validator_enabled():
            selected_engine = provider.name if per_lens else consensus.get("selectedEngine")
            successful_engines = [
                model_result.get("engine")
                for model_result in successes
                if isinstance(model_result.get("engine"), str)
            ]
            failed_engines = (
                set()
                if per_lens
                else {
                    failure["engine"]
                    for failure in consensus.get("failures", [])
                    if isinstance(failure.get("engine"), str)
                }
            )
            configured_engines = consensus_engines()
            if isinstance(selected_engine, str):
                preferred_validator = os.getenv("VALIDATOR_ENGINE", "claude").strip().lower()
                preferred_candidates = (
                    [preferred_validator]
                    if preferred_validator in {"openai", "groq", "claude", "gemini"}
                    and provider.has_engine(preferred_validator)
                    and preferred_validator != selected_engine
                    and preferred_validator not in failed_engines
                    else []
                )
                validation_engine = next(
                    (
                        engine
                        for engine in [*preferred_candidates, *successful_engines]
                        if engine != selected_engine and engine not in failed_engines
                    ),
                    None,
                )
                if validation_engine:
                    validation_cross_provider = True
                else:
                    validation_engine = next(
                        (
                            engine
                            for engine in configured_engines
                            if engine != selected_engine and engine not in failed_engines
                        ),
                        selected_engine,
                    )
                    validation_cross_provider = validation_engine != selected_engine
            if not validation_engine:
                result["validationUnavailable"] = "no second provider available"
            else:
                try:
                    validator_forecast = copy.deepcopy(result["forecast"])
                    if grounding:
                        validator_forecast["_grounding"] = grounding
                    validation_research = await fetch_validation_research(
                        provider,
                        instrument,
                        timeframe,
                        result["forecast"].get("bias"),
                        validation_engine,
                    )
                    validation_research_context = None
                    if validation_research:
                        validation_research_context = validation_research.context or None
                        if validation_research.metadata:
                            result["validationResearch"] = validation_research.metadata
                        if validation_research.unavailable:
                            result["validationResearchUnavailable"] = validation_research.unavailable
                    validation_payload = await retry_with_backoff(
                        lambda: provider.validate_forecast(
                            payload.get("base64Image", ""),
                            validator_forecast,
                            lenses,
                            market_context,
                            validation_engine,
                            validation_research_context,
                        ),
                        validation_engine,
                        "forecast validation",
                    )
                    validation_result = apply_validation(
                        result,
                        validation_payload,
                        validation_engine,
                        validation_cross_provider,
                    )
                except Exception as error:
                    logger.warning("Forecast validation %s failed: %s", validation_engine, error)
                    validation_result = None
                    result["validationUnavailable"] = (
                        str(error)
                        if isinstance(error, SafeMessageError)
                        else f"{validation_engine} validation request failed"
                    )
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
            if validation_result is not None and validation_engine:
                validated_forecast = copy.deepcopy(result["forecast"])
                if validation_result["verdict"] == "REJECT":
                    entry = validated_forecast.get("entry")
                    if isinstance(entry, dict):
                        entry["direction"] = "WAIT"
                await asyncio.to_thread(
                    record_forecast,
                    validated_forecast,
                    instrument,
                    market_data.verification if market_data else None,
                    f"validator:{validation_engine}",
                    consensus,
                )
            if per_lens:
                selected_lens = (
                    result.get("synthesis", {}).get("selectedLens")
                    if isinstance(result.get("synthesis"), dict)
                    else None
                )
                selected_index = next(
                    (
                        index
                        for index, (lens, _engine) in enumerate(success_lenses)
                        if lens == selected_lens
                    ),
                    0,
                )
                selected_forecast_id = (
                    forecast_ids[selected_index]
                    if selected_index < len(forecast_ids)
                    else None
                )
            else:
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
