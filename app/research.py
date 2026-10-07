from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .prompts import build_validation_research_prompt
from .retry import retry_with_backoff


logger = logging.getLogger("quantsage")

INSTRUMENT_LABELS = {
    "XAU_USD": "XAU/USD (spot gold)",
    "XAG_USD": "XAG/USD (spot silver)",
    "EUR_USD": "EUR/USD",
    "GBP_USD": "GBP/USD",
    "USD_JPY": "USD/JPY",
    "NAS100_USD": "NAS100 (Nasdaq 100)",
    "SPX500_USD": "SPX500 (S&P 500)",
}


@dataclass(frozen=True)
class ResearchData:
    context: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class ValidationResearchData:
    context: str
    metadata: dict[str, Any]
    unavailable: str | None = None


def _label_for(instrument: str) -> str:
    return INSTRUMENT_LABELS.get(instrument, instrument.replace("_", "/"))


def _timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _build_research_data(result: dict[str, Any], label: str, as_of: str) -> ResearchData:
    headlines = result.get("headlines", [])
    headlines = headlines if isinstance(headlines, list) else []
    events = result.get("upcomingEvents", [])
    events = events if isinstance(events, list) else []
    bias_signal = result.get("biasSignal", "NONE")
    notes = result.get("notes", "")
    metadata_headlines = [
        {
            key: item[key]
            for key in ("title", "publishedAt", "impact", "url")
            if key in item
        }
        for item in headlines
        if isinstance(item, dict)
    ]

    headline_lines = [
        f"{item.get('impact', 'LOW')} {item.get('publishedAt') or 'time unknown'} {item.get('title', '')}".strip()
        for item in headlines
        if isinstance(item, dict)
    ]
    event_lines = [
        f"{item.get('importance', 'MEDIUM')} {item.get('whenUtc') or 'time TBC'} {item.get('name', '')}".strip()
        for item in events
        if isinstance(item, dict)
    ]
    context_lines = [
        f"EXTERNAL RESEARCH (web, {label}, as of {as_of})",
        f"Research bias signal: {bias_signal}",
        "Headlines (newest first):",
        *(headline_lines or ["None reported."]),
        "Upcoming events (next 24h):",
        *(event_lines or ["None reported."]),
    ]
    if isinstance(notes, str) and notes.strip():
        context_lines.append(f"Notes: {notes}")
    metadata = {
        "asOf": as_of,
        "label": label,
        "biasSignal": bias_signal,
        "headlines": metadata_headlines,
        "upcomingEvents": events,
        "sources": result.get("sources", []) if isinstance(result.get("sources"), list) else [],
    }
    return ResearchData(context="\n".join(context_lines), metadata=metadata)


async def fetch_market_research(provider: Any, instrument: str | None) -> ResearchData | None:
    enabled = os.getenv("MARKET_RESEARCH_ENABLED", "1").strip().lower()
    if enabled in {"0", "false", "no"}:
        logger.warning("Market research is disabled; continuing without external research.")
        return None
    if not instrument:
        logger.warning("No resolved instrument for market research; continuing without external research.")
        return None
    if getattr(provider, "client", None) is None:
        logger.warning("Research provider client is unavailable; continuing without external research.")
        return None

    label = _label_for(instrument)
    try:
        result = await asyncio.wait_for(
            retry_with_backoff(
                lambda: provider.research_market(label),
                getattr(provider, "name", "unknown"),
                "market research",
            ),
            timeout=25,
        )
        if not isinstance(result, dict):
            raise ValueError("Market research returned a non-object result.")
        return _build_research_data(result, label, _timestamp())
    except asyncio.TimeoutError:
        logger.warning("Market research timed out; continuing without external research.")
    except Exception as error:
        logger.warning("Market research failed (%s); continuing without external research.", error)
    return None


def _build_validation_research_data(
    result: dict[str, Any],
    engine: str,
    fetched_at: str,
) -> ValidationResearchData:
    summary = result.get("summary") if isinstance(result.get("summary"), str) else ""
    events = result.get("events") if isinstance(result.get("events"), list) else []
    supporting = result.get("supporting") if isinstance(result.get("supporting"), list) else []
    contradicting = result.get("contradicting") if isinstance(result.get("contradicting"), list) else []
    sources = result.get("sources") if isinstance(result.get("sources"), list) else []
    event_lines = [
        f"{item.get('name', '')} — {item.get('whenUtc', '') or 'time unknown'} — {item.get('impact', 'MEDIUM')}"
        for item in events
        if isinstance(item, dict) and item.get("name")
    ]
    supporting_lines = [str(item) for item in supporting if isinstance(item, str) and item.strip()]
    contradicting_lines = [str(item) for item in contradicting if isinstance(item, str) and item.strip()]
    source_lines = [
        f"{item.get('title', item.get('url', ''))} — {item.get('url', '')}"
        for item in sources
        if isinstance(item, dict) and item.get("url")
    ]
    def section_lines(label: str, values: list[str]) -> list[str]:
        return [f"{label}: {values[0]}", *values[1:]] if values else [f"{label}: none found"]

    context_lines = [
        "INDEPENDENT EVENT & NEWS CHECK (fetched by the validator, separate from the analyst's research)",
        f"Backdrop: {summary or 'No current news backdrop found.'}",
        *section_lines("Scheduled events", event_lines),
        *section_lines("Supporting the stated bias", supporting_lines),
        *section_lines("Contradicting the stated bias", contradicting_lines),
        *section_lines("Sources", source_lines),
    ]
    metadata = {
        "summary": summary,
        "events": events,
        "supporting": supporting_lines,
        "contradicting": contradicting_lines,
        "sources": sources,
        "engine": engine,
        "fetchedAt": fetched_at,
    }
    return ValidationResearchData(context="\n".join(context_lines), metadata=metadata)


async def fetch_validation_research(
    provider: Any,
    instrument: str | None,
    timeframe: str | None,
    bias: str | None,
    engine: str,
) -> ValidationResearchData | None:
    enabled = os.getenv("VALIDATION_RESEARCH_ENABLED", "1").strip().lower()
    if enabled in {"0", "false", "no"}:
        logger.warning("Validation research is disabled; continuing without independent research.")
        return None
    if not instrument:
        logger.warning("No resolved instrument for validation research; continuing without independent research.")
        return None
    has_engine = getattr(provider, "has_engine", None)
    if callable(has_engine) and not has_engine(engine):
        logger.warning("Validation research client for %s is unavailable; continuing without independent research.", engine)
        return None
    if not callable(has_engine) and getattr(provider, "client", None) is None:
        logger.warning("Validation research provider client is unavailable; continuing without independent research.")
        return None

    label = _label_for(instrument)
    prompt = build_validation_research_prompt(label, bias or "", timeframe)
    try:
        result = await asyncio.wait_for(
            retry_with_backoff(
                lambda: provider.research_validation(prompt, engine),
                engine,
                "validation research",
            ),
            timeout=25,
        )
        if not isinstance(result, dict):
            raise ValueError("Validation research returned a non-object result.")
        return _build_validation_research_data(result, engine, _timestamp())
    except asyncio.TimeoutError:
        logger.warning("Validation research timed out; continuing without independent research.")
        return ValidationResearchData("", {}, "validator research timed out")
    except Exception as error:
        logger.warning("Validation research failed (%s); continuing without independent research.", error)
        return ValidationResearchData("", {}, "validator research unavailable")
