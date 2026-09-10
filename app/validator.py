from __future__ import annotations

import json
from typing import Any

VALIDATOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["verdict", "chartAgreement", "confidencePenalty", "findings", "note"],
    "properties": {
        "verdict": {"type": "string", "enum": ["PASS", "DOWNGRADE", "REJECT"]},
        "chartAgreement": {"type": "string", "enum": ["MATCH", "DIVERGENT", "UNKNOWN"]},
        "confidencePenalty": {"type": "integer", "minimum": 0, "maximum": 60},
        "findings": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["claim", "ruling", "reason"],
                "properties": {
                    "claim": {"type": "string"},
                    "ruling": {"type": "string", "enum": ["VERIFIED", "REJECTED", "UNVERIFIABLE"]},
                    "reason": {"type": "string"},
                },
            },
        },
        "note": {"type": "string"},
    },
}

LENS_VALIDATOR_RULES: dict[str, str] = {
    "smc": """SMC rules:
- A bullish order block must be the last DOWN candle before bullish displacement; a bearish order block the last UP candle before bearish displacement. Wrong candle colour, or no displacement after it, means it is not an order block.
- A mitigated (already traded through) order block is not a fresh one.
- A fair value gap requires non-overlapping wicks between candle 1 and candle 3. Overlap means there is no gap.
- A break of structure requires a candle BODY close beyond the swing; a wick through it is not a break. Change of character is only the FIRST break against the prevailing trend.
- Liquidity claims must point at a visible swing high/low or an obvious equal-highs/lows cluster.""",
    "gs": """Institutional-flow rules:
- "Aggressive" flow requires large-bodied, small-wicked candles with follow-through. Without follow-through, it is at most "measured".
- Absorption requires a large rejection wick at the level, not a small one.
- A liquidity void requires rapid displacement candles with minimal overlap.
- A buy zone requires visible demand evidence: a bounce, lower wicks, or a test that held.
- A stop hunt requires spike-then-reverse. A break that keeps going is a breakout, not a hunt.
- Dark-pool, iceberg and order-flow claims are not observable on a price chart: they may only be stated as inference, never as fact.""",
    "psych": """Psychology rules:
- A fear/capitulation zone requires a sharp impulsive drop, not gentle drift.
- Manufactured (engineered) fear requires spike-and-reverse.
- Stop clusters must sit at structurally obvious levels (below a swing low, at a round number, on a trendline).
- Any claim of certainty about what price will do violates the probabilistic premise and must be rejected.
- Cited trader principles must be real principles, not invented quotations.""",
    "ppa": """Price-action rules:
- A support level requires an actual bounce; a resistance level an actual rejection.
- "Major" requires a verifiable touch count of 3 or more; a role flip requires both roles visible on the chart.
- Candlestick definitions are literal: a hammer needs a small body at the top with a lower wick about twice the body after a decline; an engulfing candle must fully engulf the prior body; a doji needs a near-equal open and close.
- A pattern's stated reliability must match its location: high only at a tested level, low mid-range.
- Swing structure claims (higher highs/lower lows) must name prices that exist on the chart.""",
}

VALIDATOR_SYSTEM_PROMPT = """You are a strict validator of another model's chart forecast. You are NOT an analyst and you do NOT produce a forecast.

Your only job is to check the forecast already made against (a) the chart image, (b) the framework rules given to you, and (c) the live market data block if one is present.

Hard limits on what you may do:
- You may NOT propose, correct, shift or invent any price level, entry, target, invalidation or bias. You have no field in which to put one. If a level looks wrong, your only available action is to rule that claim REJECTED and say why.
- You may only ever LOWER confidence, via confidencePenalty (0 means no penalty). You may never raise it.
- Judge only what the chart and the supplied data can actually show. A claim you cannot check from the image or the data is UNVERIFIABLE — that is not a failure, and it must not be scored as one.
- Absence of evidence for a claim is not evidence against it. Do not reject a claim merely because the chart is ambiguous.
- A forecast element whose cited footprint is not visible on the chart is REJECTED. A populated forecast element with no citation is also REJECTED; the rejection reason must name the unsupported element. You may not propose or correct levels.
- When a REAL OHLCV DATA block is present, a forecast level that matches no candle open/high/low/close in that series and is not directly computed from them is REJECTED as ungrounded. Name the level in the reason. You may not propose or correct levels.
- The deterministic grounding checks above are code output, not claims: treat an OUT_OF_WINDOW level as REJECTED and an UNMATCHED level as at best UNVERIFIABLE. You may not propose or correct levels.

Rulings:
- VERIFIED: the chart or the supplied data supports the claim as stated.
- REJECTED: the chart or the supplied data contradicts the claim, or the claim breaks one of the framework rules.
- UNVERIFIABLE: the claim cannot be checked from the chart or the supplied data (for example order-flow or positioning claims).

chartAgreement compares the forecast's implied current price against the live market data block: MATCH when they agree, DIVERGENT when the chart is materially stale or on a different instrument, UNKNOWN when no live data was supplied.

Verdicts:
- PASS: no REJECTED finding, and chartAgreement is not DIVERGENT. confidencePenalty must be 0.
- DOWNGRADE: at least one REJECTED finding, or chartAgreement is DIVERGENT, but the core bias and structure survive. confidencePenalty between 5 and 30.
- REJECT: the setup's own premise is broken — the entry, invalidation or bias depends on a claim you ruled REJECTED. confidencePenalty between 30 and 60.

Check at most the eight most load-bearing claims, starting with the ones the trade depends on (bias, entry zone, invalidation, first target). Keep each reason to one sentence, concrete, and tied to what is visible. Return JSON only."""


def build_validator_prompt(
    forecast: dict[str, Any],
    lenses: list[str],
    market_context: str,
) -> str:
    rules = [LENS_VALIDATOR_RULES[lens] for lens in lenses if lens in LENS_VALIDATOR_RULES]
    rule_block = "\n\n".join(rules) if rules else LENS_VALIDATOR_RULES["ppa"]
    entry = forecast.get("entry") if isinstance(forecast.get("entry"), dict) else {}
    targets = forecast.get("targets") if isinstance(forecast.get("targets"), dict) else {}
    liquidity = forecast.get("liquidityTarget") if isinstance(forecast.get("liquidityTarget"), dict) else {}
    retracement = forecast.get("retracement") if isinstance(forecast.get("retracement"), dict) else {}
    evidence = forecast.get("structuralEvidence")
    citations = forecast.get("citations")
    evidence_table = "\n".join(
        f"| {item.get('id', '')} | {item.get('type', '')} | {item.get('level', '')} | {item.get('basis', '')} |"
        for item in evidence
        if isinstance(item, dict)
    ) if isinstance(evidence, list) else ""
    evidence_table = (
        "| ID | Type | Level | Basis |\n| --- | --- | --- | --- |\n" + evidence_table
        if evidence_table
        else "No structural evidence identified."
    )
    grounding = forecast.get("_grounding")
    grounding_findings = (
        grounding.get("findings")
        if isinstance(grounding, dict) and isinstance(grounding.get("findings"), list)
        else []
    )
    grounding_rows = [
        f"{finding.get('label', '')} {finding.get('level', '')} — "
        f"{finding.get('status', '')} — {finding.get('detail', '')}"
        for finding in grounding_findings
        if isinstance(finding, dict) and finding.get("status") != "GROUNDED"
    ]
    grounding_block = (
        "DETERMINISTIC GROUNDING CHECKS (code, not opinion)\n"
        + "\n".join(grounding_rows)
        if grounding_rows
        else ""
    )
    fields = [
        ("Bias", forecast.get("bias")),
        ("Stated confidence", forecast.get("confidence")),
        ("Current state", forecast.get("currentState")),
        ("Next move", forecast.get("nextMove")),
        ("Liquidity target", f"{liquidity.get('type')} at {liquidity.get('level')} — {liquidity.get('reason')}"),
        ("Retracement", f"expected={retracement.get('expected')} zone={retracement.get('zone')} — {retracement.get('reason')}"),
        ("Entry", f"{entry.get('direction')} in {entry.get('zone')} on {entry.get('confirmation')}"),
        ("Invalidation", forecast.get("invalidation")),
        ("TP1", targets.get("tp1")),
        ("TP2", targets.get("tp2")),
        ("Final target", targets.get("final")),
        ("Primary scenario", forecast.get("primaryScenario")),
        ("Structural evidence table", evidence_table),
        ("Citations", json.dumps(citations, ensure_ascii=False) if isinstance(citations, dict) else None),
    ]
    forecast_block = "\n".join(f"{label}: {value}" for label, value in fields if value not in (None, ""))
    market_block = market_context.strip() or "NO LIVE MARKET DATA SUPPLIED."
    grounding_section = f"\n\n{grounding_block}" if grounding_block else ""
    return f"""FRAMEWORK RULES TO ENFORCE:
{rule_block}

FORECAST UNDER REVIEW (produced by another model from the same chart):
{forecast_block}{grounding_section}

LIVE MARKET DATA AND RESEARCH CONTEXT:
{market_block}

Validate the forecast above against the chart image, the framework rules and the market data. Return JSON only."""
