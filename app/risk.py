from __future__ import annotations

import math
import re
from typing import Any


LEVEL_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")


def _extract_levels(text: Any, reference: float) -> list[float]:
    if not isinstance(text, str) or not math.isfinite(reference):
        return []
    lower = reference * 0.75
    upper = reference * 1.25
    values: list[float] = []
    for candidate in LEVEL_RE.findall(text):
        try:
            value = float(candidate.replace(",", ""))
        except ValueError:
            continue
        if lower <= value <= upper:
            values.append(value)
    return values


def extract_level(text: str, reference: float) -> float | None:
    values = _extract_levels(text, reference)
    return values[0] if values else None


def _parse_level(text: Any, reference: float) -> float | None:
    if not isinstance(text, str):
        return None
    values = _extract_levels(text, reference)
    if not values:
        return None
    return sum(values[:2]) / len(values[:2])


def calculate_risk(
    forecast: dict[str, Any],
    verification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reference = verification.get("lastClose") if isinstance(verification, dict) else None
    try:
        reference = float(reference)
    except (TypeError, ValueError):
        reference = None
    if reference is None or not math.isfinite(reference):
        reference = None
    entry = forecast.get("entry") if isinstance(forecast.get("entry"), dict) else {}
    targets = forecast.get("targets") if isinstance(forecast.get("targets"), dict) else {}
    if reference is None:
        for source in (entry.get("zone"), forecast.get("invalidation"), targets.get("tp1")):
            candidates = LEVEL_RE.findall(source) if isinstance(source, str) else []
            if candidates:
                try:
                    reference = float(candidates[0].replace(",", ""))
                except ValueError:
                    continue
                break
    entry_level = _parse_level(entry.get("zone"), reference) if reference is not None else None
    invalidation = _parse_level(forecast.get("invalidation"), reference) if reference is not None else None
    target_levels = {
        name: _parse_level(targets.get(name), reference) if reference is not None else None
        for name in ("tp1", "tp2", "final")
    }
    missing = []
    if entry_level is None:
        missing.append("entry")
    if invalidation is None:
        missing.append("invalidation")
    missing.extend(name for name, level in target_levels.items() if level is None)
    if missing:
        return {
            "parsed": False,
            "risk": None,
            "targets": {},
            "warnings": [f"Unable to parse numeric levels: {', '.join(missing)}."],
        }
    direction = entry.get("direction")
    inverted = (direction == "BUY" and invalidation >= entry_level) or (
        direction == "SELL" and invalidation <= entry_level
    )
    risk = abs(entry_level - invalidation)
    warnings: list[str] = []
    if inverted:
        warnings.append("Invalidation is on the wrong side of entry.")
    target_results: dict[str, dict[str, float | None]] = {}
    for name, level in target_levels.items():
        reward = abs(level - entry_level)
        rr = None if inverted or risk == 0 else reward / risk
        target_results[name] = {"reward": reward, "rr": rr}
        if rr is not None and rr < 1:
            warnings.append(f"{name.upper()} reward/risk below 1.0")
    return {
        "parsed": True,
        "entry": entry_level,
        "invalidation": invalidation,
        "risk": risk,
        "targets": target_results,
        "warnings": warnings,
    }
