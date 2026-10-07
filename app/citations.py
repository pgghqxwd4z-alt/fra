from __future__ import annotations

from typing import Any


CITATION_FIELDS = (
    ("bias", "Bias", lambda forecast: forecast.get("bias")),
    (
        "liquidityTarget",
        "Liquidity target",
        lambda forecast: (
            forecast.get("liquidityTarget", {}).get("level")
            or forecast.get("liquidityTarget", {}).get("reason")
            if isinstance(forecast.get("liquidityTarget"), dict)
            else ""
        ),
    ),
    ("retracement", "Retracement", lambda forecast: forecast.get("retracement")),
    (
        "entry",
        "Entry zone",
        lambda forecast: (
            forecast.get("entry", {}).get("zone")
            if isinstance(forecast.get("entry"), dict)
            else ""
        ),
    ),
    ("invalidation", "Invalidation", lambda forecast: forecast.get("invalidation")),
    (
        "tp1",
        "TP1",
        lambda forecast: (
            forecast.get("targets", {}).get("tp1")
            if isinstance(forecast.get("targets"), dict)
            else ""
        ),
    ),
    (
        "tp2",
        "TP2",
        lambda forecast: (
            forecast.get("targets", {}).get("tp2")
            if isinstance(forecast.get("targets"), dict)
            else ""
        ),
    ),
    (
        "final",
        "Final target",
        lambda forecast: (
            forecast.get("targets", {}).get("final")
            if isinstance(forecast.get("targets"), dict)
            else ""
        ),
    ),
)


def _has_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(_has_value(child) for child in value.values())
    return value is not None


def check_citations(forecast: dict[str, Any]) -> dict[str, Any]:
    evidence = forecast.get("structuralEvidence")
    valid_ids: set[str] = set()
    for item in evidence if isinstance(evidence, list) else []:
        if not isinstance(item, dict):
            continue
        evidence_id = item.get("id")
        if isinstance(evidence_id, str) and evidence_id.strip():
            valid_ids.add(evidence_id.strip())

    retracement = forecast.get("retracement")
    retracement_active = (
        isinstance(retracement, dict)
        and retracement.get("expected") is not False
        and _has_value(retracement.get("zone"))
    )
    unsupported: list[str] = []
    citations = forecast.get("citations")
    for key, label, value_getter in CITATION_FIELDS:
        if key == "retracement":
            populated = retracement_active
        else:
            populated = _has_value(value_getter(forecast))
        if not populated:
            continue
        raw_ids = citations.get(key) if isinstance(citations, dict) else []
        citation_ids = [
            item.strip()
            for item in raw_ids
            if isinstance(item, str) and item.strip()
        ] if isinstance(raw_ids, list) else []
        if not citation_ids:
            unsupported.append(f"{label} cites no identified footprint")
            continue
        seen_unknown: set[str] = set()
        for citation_id in citation_ids:
            if citation_id not in valid_ids and citation_id not in seen_unknown:
                unsupported.append(f"{label} cites unknown footprint {citation_id}")
                seen_unknown.add(citation_id)

    forecast["unsupported"] = unsupported
    warnings = forecast.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
        forecast["warnings"] = warnings
    warnings.extend(unsupported)
    return forecast
