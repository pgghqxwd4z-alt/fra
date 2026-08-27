from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


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
        f"{item.get('impact', 'LOW')} {item.get('publishedAt', '')} {item.get('title', '')}".strip()
        for item in headlines
        if isinstance(item, dict)
    ]
    event_lines = [
        f"{item.get('importance', 'MEDIUM')} {item.get('whenUtc', '')} {item.get('name', '')}".strip()
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
        result = await asyncio.wait_for(provider.research_market(label), timeout=25)
        if not isinstance(result, dict):
            raise ValueError("Market research returned a non-object result.")
        return _build_research_data(result, label, _timestamp())
    except asyncio.TimeoutError:
        logger.warning("Market research timed out; continuing without external research.")
    except Exception as error:
        logger.warning("Market research failed (%s); continuing without external research.", error)
    return None
