from __future__ import annotations

from typing import Any


KNOWLEDGE_SOURCES = [
    {
        "id": "trading-in-the-zone",
        "title": "Trading in the Zone",
        "author": "Mark Douglas",
        "kind": "BOOK",
        "allowedDomains": ["penguinrandomhouse.com", "books.google.com", "markdouglas.com"],
    },
    {
        "id": "disciplined-trader",
        "title": "The Disciplined Trader",
        "author": "Mark Douglas",
        "kind": "BOOK",
        "allowedDomains": ["penguinrandomhouse.com", "books.google.com", "markdouglas.com"],
    },
    {
        "id": "market-wizards",
        "title": "Market Wizards",
        "author": "Jack D. Schwager",
        "kind": "BOOK",
        "allowedDomains": ["wiley.com", "wiley-vch.de", "books.google.com"],
    },
    {"id": "smc", "title": "Smart Money Concepts", "kind": "FRAMEWORK"},
    {"id": "smc-pdf", "title": "Smart Money Concept Trading Strategy", "kind": "DOCUMENT"},
    {"id": "pure-price-action", "title": "Pure Price Action", "kind": "FRAMEWORK"},
    {"id": "institutional-overlay", "title": "Institutional / Macro Overlay", "kind": "FRAMEWORK"},
]

SCAN_SCHEMA = {
    "type": "object",
    "properties": {
        "bias": {"type": "string", "enum": ["BULLISH", "BEARISH", "NEUTRAL"]},
        "keyLevels": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
        "note": {"type": "string", "description": "One concise sentence describing the preliminary chart read."},
    },
    "required": ["bias", "keyLevels", "note"],
    "additionalProperties": False,
}

KNOWLEDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sourceId": {"type": "string"},
                    "principle": {"type": "string"},
                    "relevance": {"type": "string"},
                    "sourceUrl": {"type": "string"},
                    "sourceTitleFromWeb": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": [
                    "sourceId",
                    "principle",
                    "relevance",
                    "sourceUrl",
                    "sourceTitleFromWeb",
                    "confidence",
                ],
                "additionalProperties": False,
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["items", "warnings"],
    "additionalProperties": False,
}

RESEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "headlines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "publishedAt": {"type": "string"},
                    "url": {
                        "type": "string",
                        "description": "Exact retrieved url, or an empty string when unknown.",
                    },
                    "impact": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
                },
                "required": ["title", "summary", "publishedAt", "url", "impact"],
                "additionalProperties": False,
            },
        },
        "upcomingEvents": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "whenUtc": {"type": "string"},
                    "importance": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
                },
                "required": ["name", "whenUtc", "importance"],
                "additionalProperties": False,
            },
        },
        "biasSignal": {
            "type": "string",
            "enum": ["SUPPORTS_BULLISH", "SUPPORTS_BEARISH", "MIXED", "NONE"],
        },
        "notes": {"type": "string"},
    },
    "required": ["headlines", "upcomingEvents", "biasSignal", "notes"],
    "additionalProperties": False,
}

FORECAST_SCHEMA = {
    "type": "object",
    "properties": {
        "currentState": {"type": "string"},
        "bias": {"type": "string", "enum": ["BULLISH", "BEARISH", "NEUTRAL"]},
        "confidence": {
            "type": "number",
            "description": "An integer confidence percentage from 0 to 100.",
        },
        "nextMove": {"type": "string"},
        "expectedPath": {"type": "array", "items": {"type": "string"}},
        "liquidityTarget": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["BUY_SIDE", "SELL_SIDE", "UNKNOWN"]},
                "level": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["type", "level", "reason"],
            "additionalProperties": False,
        },
        "retracement": {
            "type": "object",
            "properties": {
                "expected": {"type": "boolean"},
                "zone": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["expected", "zone", "reason"],
            "additionalProperties": False,
        },
        "entry": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["BUY", "SELL", "WAIT"]},
                "zone": {"type": "string"},
                "confirmation": {"type": "string"},
            },
            "required": ["direction", "zone", "confirmation"],
            "additionalProperties": False,
        },
        "targets": {
            "type": "object",
            "properties": {
                "tp1": {"type": "string"},
                "tp2": {"type": "string"},
                "final": {"type": "string"},
            },
            "required": ["tp1", "tp2", "final"],
            "additionalProperties": False,
        },
        "invalidation": {"type": "string"},
        "primaryScenario": {"type": "string"},
        "alternativeScenario": {"type": "string"},
        "nextEvent": {"type": "string"},
        "structuralEvidence": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "currentState",
        "bias",
        "confidence",
        "nextMove",
        "expectedPath",
        "liquidityTarget",
        "retracement",
        "entry",
        "targets",
        "invalidation",
        "primaryScenario",
        "alternativeScenario",
        "nextEvent",
        "structuralEvidence",
        "warnings",
    ],
    "additionalProperties": False,
}


def source_for(source_id: str) -> dict[str, Any] | None:
    return next((source for source in KNOWLEDGE_SOURCES if source["id"] == source_id), None)
