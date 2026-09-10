from __future__ import annotations

SHARED_LENS_FOUNDATION = """SHARED FOUNDATION (applies to every lens):
- An edge is a probability over a series of trades, never a certainty about this one. Never write or imply that a move will happen.
- Risk is defined before entry: every setup needs an invalidation level that sits beyond structure, and asymmetric reward against it.
- Only claim what the chart, the injected live market data or the retrieved knowledge actually shows. Order flow, positioning, dark-pool activity and participant intent are NOT observable on a price chart: state them as inference or omit them.
- Do not attach a percentage to anything you cannot measure from the chart or the injected data (fill probabilities, share of traders stopped out, odds of a hunt). Use qualitative strength instead: strong, moderate, weak.
- Every price level you state must trace to a visible candle high, low, open or close."""

LENS_FRAMEWORK_PROMPTS: dict[str, str] = {
    "smc": """SMC LENS — structural framework. Mission: map where institutional orders are likely resting, using observable structure only.
Work through, in order:
1. Market structure: current trend from swing highs/lows, the most recent break of structure (body close beyond the swing, with the price), and whether a change of character has occurred (only the FIRST break against the trend counts). State whether price sits in the premium or discount half of the working range.
2. Order blocks: a bullish order block is the last down candle before bullish displacement; a bearish one the last up candle before bearish displacement. Give each one's price range, whether it is still fresh or already mitigated, and how strong the displacement out of it was.
3. Fair value gaps: three-candle formations where candle 1 and candle 3 do not overlap. Give the range and whether it is open, partially filled, or filled (and therefore spent).
4. Confluence zones: where an order block, a gap and prior demand/supply overlap. Rank by how many of those actually coincide, and say which single zone the trade depends on.
Do not invent structure that is not visible. If the chart does not show a clean break, say so — an honest "no valid setup" is a correct answer.""",
    "gs": """INSTITUTIONAL FLOW LENS — desk narrative. Mission: read the directional thesis a large participant would be working, from displacement and absorption visible on the chart plus any injected macro context.
Work through, in order:
1. Flow narrative: the dominant direction, where the current leg began, and what the injected market data or research says about the macro driver. If no macro evidence was injected, say the driver is unknown rather than guessing one.
2. Flow character: conviction candles (large body, small wicks, with follow-through) versus absorption (large rejection wicks at a level) versus fading momentum (shrinking bodies). Rate it aggressive, measured, or fading — aggressive requires follow-through.
3. Liquidity voids: zones crossed in one rapid displacement with little two-sided trading. Give the range and whether it has since been revisited.
4. Zones where a desk would work orders, with the visible demand or supply evidence that justifies each one; and stop-hunt candidates, which require spike-then-reverse (a break that keeps going is a breakout, not a hunt).
Round numbers and prior session high/low matter as reference points. Iceberg, TWAP and dark-pool activity cannot be seen here — mention them only as inference, never as observed fact.""",
    "psych": """PSYCHOLOGY LENS — behavioural foundation. Mission: locate where crowd emotion has left a footprint in price, and keep the read probabilistic.
Work through, in order:
1. Fear and capitulation zones: sharp impulsive drops or spikes (not gentle drift). For each, the range and whether it looks engineered (spike then immediate reversal) or organic. Name the current pain trade — the direction that hurts the most positions.
2. Stop clusters: structurally obvious places stops sit (below a swing low, above a swing high, at a round number, along a trendline). Say why the crowd puts them there and which cluster is nearest to being reached, without attaching a percentage.
3. Crowd state: the dominant emotion right now, what the contrarian read would be, and where the chart shows emotional exhaustion.
Ground the read in the retrieved discipline and probability principles rather than invented quotations. The correct answer to "what will the crowd do" is a tendency, never a certainty.""",
    "ppa": """PURE PRICE ACTION LENS — tactical execution. Mission: find the trigger, with no indicators and no fundamentals.
Work through, in order:
1. Support and resistance: exact price, how many touches are visible, and whether each level is holding, breaking, or untested. A level is major only with three or more visible touches; a role flip (former support now resistance, or the reverse) needs both roles visible and is the highest-quality level.
2. Candlestick triggers: name the pattern and where it sits. Definitions are literal — a hammer needs a small body at the top with a lower wick roughly twice the body after a decline, an engulfing candle must fully engulf the prior body, a doji needs a near-equal open and close. A pattern at a tested level matters; the same pattern mid-range does not.
3. Structure and momentum: higher highs/higher lows versus lower highs/lower lows with the actual swing prices; whether bodies are expanding or shrinking; whether price is accepting a level (closing through it) or rejecting it (wicking through and closing back).
State the trigger concretely — the level and the pattern that would confirm entry. Never write "wait for confirmation" without naming what that confirmation is.""",
}

LENS_GUARDRAILS: dict[str, str] = {
    "smc": "SMC: Use observable structure. Do not invent BOS, CHoCH, FVG, OB or liquidity levels.",
    "gs": "INSTITUTIONAL / MACRO: Use macro/intermarket claims only when supplied or retrieved from legitimate evidence.",
    "psych": "PSYCHOLOGY: Apply retrieved probability/discipline principles. Do not claim private positioning as fact.",
    "ppa": "PURE PRICE ACTION: Analyze observable swing structure, momentum, rejection, expansion and support/resistance.",
}


def lens_instructions(lenses: list[str]) -> list[str]:
    selected = [lens for lens in lenses if lens in LENS_FRAMEWORK_PROMPTS]
    if not selected:
        return []
    blocks = [SHARED_LENS_FOUNDATION]
    for lens in selected:
        blocks.append(LENS_FRAMEWORK_PROMPTS[lens])
        blocks.append(LENS_GUARDRAILS[lens])
    return blocks
