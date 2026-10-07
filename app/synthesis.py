from __future__ import annotations

import json
from typing import Any

from .providers import (
    AIProvider,
    _claude_text,
    _to_claude_schema,
    parse_json_object,
)


SYNTHESIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["selectedLens", "confluence", "agreements", "disagreements", "note"],
    "properties": {
        "selectedLens": {"type": "string"},
        "confluence": {"type": "string", "enum": ["STRONG", "MODERATE", "WEAK"]},
        "agreements": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["element", "lenses", "detail"],
                "properties": {
                    "element": {"type": "string"},
                    "lenses": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
                    "detail": {"type": "string"},
                },
            },
        },
        "disagreements": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["element", "lenses", "detail"],
                "properties": {
                    "element": {"type": "string"},
                    "lenses": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
                    "detail": {"type": "string"},
                },
            },
        },
        "note": {"type": "string"},
    },
}

SYNTHESIS_PROMPT = """You are merging several independent framework analyses of the SAME chart into one convergence view. You are not an analyst and you do not produce a forecast of your own.

Each block below is one lens's completed forecast, with its own bias, entry zone, invalidation and targets.

Your job:
- selectedLens: name the lens whose forecast should stand as the primary plan — the one best supported by agreement with the other lenses and by its own cited structural evidence. You must pick one of the lens ids given to you.
- agreements: where the lenses point at the same thing (same directional bias, overlapping entry zones, the same level acting as target or invalidation). Name the element and which lenses agree.
- disagreements: where they conflict, stated plainly. A conflict is information, not a problem to smooth over.
- confluence: STRONG when the lenses agree on direction and the key levels overlap; MODERATE when direction agrees but levels differ; WEAK when direction itself is contested.
- note: one sentence on what the combined read means for the trade.

HARD LIMITS:
- You may NOT state, shift or invent any price level. Refer to levels only by quoting what a lens already said.
- You may NOT output probabilities, percentages or probability tiers of any kind.
- Do not rewrite or improve any lens's analysis.

Return JSON only.
"""


def build_synthesis_prompt(lens_forecasts: list[dict[str, Any]]) -> str:
    blocks = []
    for item in lens_forecasts:
        lens = item.get("lens", "")
        forecast = item.get("forecast", {})
        blocks.append(f"LENS {lens}:\n{json.dumps(forecast, ensure_ascii=False, indent=2)}")
    return f"{SYNTHESIS_PROMPT}\n\n" + "\n\n".join(blocks)


def select_lens_forecast(
    synthesis: dict[str, Any],
    lens_forecasts: list[dict[str, Any]],
) -> dict[str, Any]:
    selected_lens = synthesis.get("selectedLens")
    for item in lens_forecasts:
        if item.get("lens") == selected_lens:
            return item
    return lens_forecasts[0]


async def run_synthesis(
    provider: AIProvider,
    lens_forecasts: list[dict[str, Any]],
) -> dict[str, Any]:
    client = provider._require_claude()
    response = await client.messages.create(
        model=provider.claude_model,
        max_tokens=2048,
        messages=[{"role": "user", "content": build_synthesis_prompt(lens_forecasts)}],
        output_config={"format": {"type": "json_schema", "schema": _to_claude_schema(SYNTHESIS_SCHEMA)}},
    )
    text = _claude_text(response)
    if not text:
        raise ValueError("No response text from synthesis")
    parsed = parse_json_object(text)
    return parsed if isinstance(parsed, dict) else {}
