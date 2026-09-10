from __future__ import annotations

import math
import os
from datetime import datetime
from typing import Any

from .market import Candle
from .risk import LEVEL_RE


GROUNDING_TOLERANCE_PCT = float(os.getenv("GROUNDING_TOLERANCE_PCT", "0.05"))


def _format_number(value: float) -> str:
    return f"{value:,.10g}"


def _timestamp_text(value: str) -> str:
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return timestamp.strftime("%Y-%m-%d %H:%M")


def _level_values(text: Any, window_low: float, window_high: float) -> list[float]:
    if not isinstance(text, str) or not text.strip():
        return []
    lower_bound = 0.5 * window_low
    upper_bound = 2.0 * window_high
    values: list[float] = []
    for match in LEVEL_RE.finditer(text):
        raw_value = match.group(0)
        suffix = text[match.end() : match.end() + 1]
        if suffix in {"%", "R", "r"}:
            continue
        try:
            value = float(raw_value.replace(",", ""))
        except ValueError:
            continue
        if 1900 <= value <= 2100 and len(raw_value.replace(",", "").split(".")[0]) == 4:
            continue
        if math.isfinite(value) and lower_bound <= value <= upper_bound:
            values.append(value)
    return values


def _extract_candidates(
    forecast: dict[str, Any],
    window_low: float,
    window_high: float,
) -> list[tuple[str, float]]:
    fields: list[tuple[str, Any]] = []
    entry = forecast.get("entry") if isinstance(forecast.get("entry"), dict) else {}
    fields.append(("Entry zone", entry.get("zone")))
    fields.append(("Invalidation", forecast.get("invalidation")))
    targets = forecast.get("targets") if isinstance(forecast.get("targets"), dict) else {}
    fields.extend(
        (
            ("TP1", targets.get("tp1")),
            ("TP2", targets.get("tp2")),
            ("Final target", targets.get("final")),
        )
    )
    liquidity = forecast.get("liquidityTarget") if isinstance(forecast.get("liquidityTarget"), dict) else {}
    fields.append(("Liquidity target", liquidity.get("level")))
    retracement = forecast.get("retracement") if isinstance(forecast.get("retracement"), dict) else {}
    if retracement.get("expected") is not False:
        fields.append(("Retracement", retracement.get("zone")))

    candidates: list[tuple[str, float]] = []
    seen: set[tuple[str, float]] = set()
    for label, text in fields:
        for value in _level_values(text, window_low, window_high):
            candidate = (label, value)
            if candidate not in seen:
                seen.add(candidate)
                candidates.append(candidate)

    evidence = forecast.get("structuralEvidence")
    if isinstance(evidence, list):
        for item in evidence:
            if not isinstance(item, dict):
                continue
            label = f"{item.get('id', '')} ({item.get('type', '')})"
            for value in _level_values(item.get("level"), window_low, window_high):
                candidate = (label, value)
                if candidate not in seen:
                    seen.add(candidate)
                    candidates.append(candidate)
    return candidates


def _candle_values(candle: Candle) -> tuple[tuple[str, float], ...]:
    return (
        ("open", candle.open),
        ("high", candle.high),
        ("low", candle.low),
        ("close", candle.close),
    )


def _finding(label: str, level: float, candles: list[Candle], window_low: float, window_high: float) -> dict[str, Any]:
    if level < window_low:
        return {
            "label": label,
            "level": level,
            "status": "OUT_OF_WINDOW",
            "detail": f"{_format_number(level)} is below the 150-candle window low {_format_number(window_low)}",
        }
    if level > window_high:
        return {
            "label": label,
            "level": level,
            "status": "OUT_OF_WINDOW",
            "detail": f"{_format_number(level)} is above the 150-candle window high {_format_number(window_high)}",
        }

    tolerance = abs(level) * GROUNDING_TOLERANCE_PCT / 100
    matches: list[tuple[float, Candle, str, float]] = []
    for candle in candles:
        for field, candle_value in _candle_values(candle):
            difference = abs(level - candle_value)
            if difference <= tolerance:
                matches.append((difference, candle, field, candle_value))
    if matches:
        _, candle, field, candle_value = min(matches, key=lambda match: match[0])
        return {
            "label": label,
            "level": level,
            "status": "GROUNDED",
            "detail": (
                f"matches the {_timestamp_text(candle.timestamp)} {field} "
                f"({_format_number(candle_value)})"
            ),
        }

    if label.endswith("(SUPPORT_RESISTANCE)"):
        return {
            "label": label,
            "level": level,
            "status": "UNTOUCHED",
            "detail": "no candle touches this level in the window (may predate it)",
        }
    return {
        "label": label,
        "level": level,
        "status": "UNMATCHED",
        "detail": f"{_format_number(level)} matches no candle extreme within {GROUNDING_TOLERANCE_PCT:g}%",
    }


def check_level_grounding(
    forecast: dict[str, Any],
    candles: list[Candle],
) -> dict[str, Any] | None:
    if not candles:
        return None
    window_low = min(candle.low for candle in candles)
    window_high = max(candle.high for candle in candles)
    candidates = _extract_candidates(forecast, window_low, window_high)
    findings = [
        _finding(label, level, candles, window_low, window_high)
        for label, level in candidates
    ]
    return {
        "tolerancePct": GROUNDING_TOLERANCE_PCT,
        "windowHigh": window_high,
        "windowLow": window_low,
        "checked": len(findings),
        "grounded": sum(finding["status"] == "GROUNDED" for finding in findings),
        "findings": findings,
    }
