from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urlparse

from openai import AsyncOpenAI

from .prompts import (
    FORECAST_SYSTEM_PROMPT,
    build_forecast_prompt,
    build_research_prompt,
    build_retrieval_prompt,
)
from .schemas import FORECAST_SCHEMA, KNOWLEDGE_SCHEMA, RESEARCH_SCHEMA, source_for


PRIVATE_CITATION_RE = re.compile(
    r"[\uE000-\uF8FF]*cite[\uE000-\uF8FF]*[A-Za-z0-9_-]+[\uE000-\uF8FF]*",
    re.IGNORECASE,
)


def strip_citation_markers(text: str) -> str:
    return PRIVATE_CITATION_RE.sub(
        lambda match: "" if re.search(r"[\uE000-\uF8FF]", match.group(0)) else match.group(0),
        text,
    )


def clamp01(value: float) -> float:
    return max(0, min(1, value if math.isfinite(value) else 0))


def safe_source_url(raw: str | None, domains: list[str] | None = None) -> str | None:
    if not raw:
        return None
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    allowed = domains or []
    if any(host == domain or host.endswith(f".{domain}") for domain in allowed):
        return parsed.geturl()
    return None


def _normalized_hostname(raw: str) -> str | None:
    try:
        host = urlparse(raw).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def _hosts_match(left: str, right: str) -> bool:
    return left == right or left.endswith(f".{right}") or right.endswith(f".{left}")


def _normalized_uri(raw: str) -> str:
    value = raw.strip()
    try:
        parsed = urlparse(value)
    except ValueError:
        return value
    if not parsed.scheme or not parsed.netloc:
        return value
    normalized = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        fragment="",
    ).geturl()
    return normalized.rstrip("/")


def route_knowledge(lenses: list[str] | None = None) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for lens in lenses or []:
        values = {
            "smc": ["smc"],
            "ppa": ["pure-price-action"],
            "psych": ["trading-in-the-zone", "disciplined-trader"],
            "gs": ["institutional-overlay", "market-wizards"],
        }.get(lens, [])
        for value in values:
            if value not in seen:
                seen.add(value)
                ids.append(value)
    if not ids:
        ids = ["smc", "pure-price-action", "trading-in-the-zone", "disciplined-trader"]
    return ids


def _string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return "" if value is None else str(value)


def _normalize_utc_time(value: str) -> str:
    """Full ISO Z when the timestamp parses, date-only when just the date does, else ""."""
    text = _string(value).strip()
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass
    else:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return ""


def _string_array(value: Any) -> list[str]:
    return [_string(item) for item in value] if isinstance(value, list) else []


def normalize_forecast(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    liquidity_target = source.get("liquidityTarget")
    liquidity_target = liquidity_target if isinstance(liquidity_target, dict) else {}
    retracement = source.get("retracement")
    retracement = retracement if isinstance(retracement, dict) else {}
    entry = source.get("entry")
    entry = entry if isinstance(entry, dict) else {}
    targets = source.get("targets")
    targets = targets if isinstance(targets, dict) else {}
    raw_bias = _string(source.get("bias"))
    raw_direction = _string(entry.get("direction"))
    raw_liquidity_type = _string(liquidity_target.get("type"))
    try:
        raw_confidence = float(source.get("confidence"))
    except (TypeError, ValueError):
        raw_confidence = 0
    if not math.isfinite(raw_confidence):
        raw_confidence = 0
    confidence = round(max(0, min(100, raw_confidence * 100 if raw_confidence <= 1 else raw_confidence)))

    return {
        "currentState": _string(source.get("currentState")),
        "bias": raw_bias if raw_bias in {"BULLISH", "BEARISH", "NEUTRAL"} else "NEUTRAL",
        "confidence": confidence,
        "nextMove": _string(source.get("nextMove")),
        "expectedPath": _string_array(source.get("expectedPath")),
        "liquidityTarget": {
            "type": raw_liquidity_type if raw_liquidity_type in {"BUY_SIDE", "SELL_SIDE", "UNKNOWN"} else "UNKNOWN",
            "level": _string(liquidity_target.get("level")),
            "reason": _string(liquidity_target.get("reason")),
        },
        "retracement": {
            "expected": bool(retracement.get("expected")),
            "zone": _string(retracement.get("zone")),
            "reason": _string(retracement.get("reason")),
        },
        "entry": {
            "direction": raw_direction if raw_direction in {"BUY", "SELL", "WAIT"} else "WAIT",
            "zone": _string(entry.get("zone")),
            "confirmation": _string(entry.get("confirmation")),
        },
        "targets": {
            "tp1": _string(targets.get("tp1")),
            "tp2": _string(targets.get("tp2")),
            "final": _string(targets.get("final")),
        },
        "invalidation": _string(source.get("invalidation")),
        "primaryScenario": _string(source.get("primaryScenario")),
        "alternativeScenario": _string(source.get("alternativeScenario")),
        "nextEvent": _string(source.get("nextEvent")),
        "structuralEvidence": _string_array(source.get("structuralEvidence")),
        "warnings": _string_array(source.get("warnings")),
    }


def parse_json_object(text: str) -> dict[str, Any]:
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise ValueError("Model returned invalid JSON.") from None
        result = json.loads(match.group(0))
    return result if isinstance(result, dict) else {}


def object_dict(value: Any) -> Any:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "__dict__"):
        return vars(value)
    return value


def map_openai_grounding(result: Any) -> list[dict[str, dict[str, str]]]:
    output = object_dict(getattr(result, "output", []))
    chunks: list[dict[str, dict[str, str]]] = []
    for item in output if isinstance(output, list) else []:
        item = object_dict(item)
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            content = object_dict(content)
            for annotation in content.get("annotations", []) if isinstance(content, dict) else []:
                annotation = object_dict(annotation)
                if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
                    url = annotation.get("url")
                    if isinstance(url, str):
                        chunks.append({"web": {"uri": url, "title": annotation.get("title") or url}})
    return chunks


def map_groq_grounding(result: Any) -> list[dict[str, dict[str, str]]]:
    chunks: list[dict[str, dict[str, str]]] = []
    seen: set[str] = set()

    def add(candidate: Any) -> None:
        candidate = object_dict(candidate)
        if not isinstance(candidate, dict):
            return
        uri = candidate.get("url") or candidate.get("uri") or candidate.get("source_url") or candidate.get("link")
        if not isinstance(uri, str) or not re.match(r"https?://", uri, re.IGNORECASE) or uri in seen:
            return
        seen.add(uri)
        source = candidate.get("source")
        source = object_dict(source)
        title = candidate.get("title") or candidate.get("name") or (
            source.get("title") if isinstance(source, dict) else None
        ) or uri
        chunks.append({"web": {"uri": uri, "title": str(title)}})

    def visit(value: Any) -> None:
        value = object_dict(value)
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            add(value)
            for key, child in value.items():
                if re.search(r"citation|source|result|tool", key, re.IGNORECASE):
                    visit(child)

    result_dict = object_dict(result)
    if isinstance(result_dict, dict):
        choices = result_dict.get("choices", [])
        choice = object_dict(choices[0]) if choices else {}
        message = object_dict(choice.get("message", {})) if isinstance(choice, dict) else {}
        for key in ("annotations", "citations", "executed_tools"):
            visit(message.get(key) if isinstance(message, dict) else None)
        visit(result_dict.get("citations"))
    return chunks


class AIProvider:
    def __init__(self) -> None:
        import os

        self.name = "groq" if os.getenv("AI_PROVIDER") == "groq" else "openai"
        self.openai_model = os.getenv("OPENAI_MODEL") or "gpt-4o"
        self.groq_model = os.getenv("GROQ_MODEL") or "groq/compound"
        self.groq_vision_model = os.getenv("GROQ_VISION_MODEL") or "qwen/qwen3.6-27b"
        openai_key = os.getenv("OPENAI_API_KEY")
        groq_key = os.getenv("GROQ_API_KEY")
        self.client = (
            AsyncOpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
            if self.name == "groq" and groq_key
            else AsyncOpenAI(api_key=openai_key)
            if self.name == "openai" and openai_key
            else None
        )

    @property
    def missing_key_message(self) -> str:
        return f"{'GROQ' if self.name == 'groq' else 'OPENAI'}_API_KEY environment variable is not set."

    def require_client(self) -> AsyncOpenAI:
        if self.client is None:
            raise RuntimeError(self.missing_key_message)
        return self.client

    async def retrieve_knowledge(self, prompt: str, lenses: list[str], market_context: str) -> dict[str, Any]:
        source_ids = route_knowledge(lenses)
        source_text = "\n".join(f"- {source_id}" for source_id in source_ids)
        retrieval_prompt = build_retrieval_prompt(prompt, market_context, source_text)
        client = self.require_client()
        if self.name == "groq":
            result = await client.chat.completions.create(
                model=self.groq_model,
                messages=[{"role": "user", "content": retrieval_prompt}],
                response_format={"type": "json_object"},
            )
            text = result.choices[0].message.content
            if not text:
                return {"items": [], "context": "NO EXTERNAL KNOWLEDGE RETRIEVED.", "warnings": ["Knowledge retrieval returned no text."]}
            return self.map_knowledge_result(parse_json_object(text))

        search_result = await client.responses.create(
            model=self.openai_model,
            tools=[{"type": "web_search"}],
            input=retrieval_prompt,
        )
        source_material = search_result.output_text or "No web search material was returned."
        result = await client.responses.create(
            model=self.openai_model,
            input=f"""{retrieval_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "knowledge_retrieval",
                    "strict": True,
                    "schema": KNOWLEDGE_SCHEMA,
                }
            },
        )
        if not result.output_text:
            return {"items": [], "context": "NO EXTERNAL KNOWLEDGE RETRIEVED.", "warnings": ["Knowledge retrieval returned no text."]}
        return self.map_knowledge_result(json.loads(result.output_text))

    @staticmethod
    def map_knowledge_result(parsed: dict[str, Any]) -> dict[str, Any]:
        items = []
        for item in parsed.get("items", []) if isinstance(parsed.get("items"), list) else []:
            source = source_for(item.get("sourceId", "")) if isinstance(item, dict) else None
            if not source:
                continue
            source_url = safe_source_url(item.get("sourceUrl"), source.get("allowedDomains", []))
            try:
                confidence = clamp01(float(item.get("confidence", 0)))
            except (TypeError, ValueError):
                confidence = 0
            mapped = {
                "sourceId": source["id"],
                "sourceTitle": source["title"],
            }
            if source.get("author") is not None:
                mapped["author"] = source["author"]
            mapped.update(
                {
                    "kind": source["kind"],
                    "principle": _string(item.get("principle")),
                    "relevance": _string(item.get("relevance")),
                }
            )
            if source_url is not None:
                mapped["sourceUrl"] = source_url
            mapped.update(
                {
                    "sourceTitleFromWeb": _string(item.get("sourceTitleFromWeb")),
                    "confidence": confidence,
                }
            )
            items.append(mapped)
        context = (
            "\n\n".join(
                f"{i + 1}. {item['sourceTitle']}{' — ' + item['author'] if item.get('author') else ''}\n"
                f"Principle: {item['principle']}\nRelevance: {item['relevance']}\n"
                f"Source: {item.get('sourceUrl') or 'not provided'}\nConfidence: {item['confidence']}"
                for i, item in enumerate(items)
            )
            if items
            else "NO EXTERNAL KNOWLEDGE RETRIEVED."
        )
        return {"items": items, "context": context, "warnings": parsed.get("warnings", [])}

    @staticmethod
    def map_research_result(parsed: Any, grounding: list[dict[str, Any]]) -> dict[str, Any]:
        source = parsed if isinstance(parsed, dict) else {}
        grounding_hosts = {
            host
            for item in grounding
            if isinstance(item, dict)
            for web in [item.get("web")]
            if isinstance(web, dict)
            for uri in [web.get("uri")]
            if isinstance(uri, str)
            for host in [_normalized_hostname(uri)]
            if host
        }
        headlines = []
        for item in source.get("headlines", [])[:6] if isinstance(source.get("headlines"), list) else []:
            if not isinstance(item, dict):
                continue
            impact = _string(item.get("impact"))
            mapped = {
                "title": _string(item.get("title")),
                "summary": _string(item.get("summary")),
                "publishedAt": _normalize_utc_time(item.get("publishedAt")),
                "impact": impact if impact in {"HIGH", "MEDIUM", "LOW"} else "LOW",
            }
            raw_url = _string(item.get("url"))
            try:
                parsed_url = urlparse(raw_url)
            except ValueError:
                parsed_url = None
            if (
                parsed_url
                and parsed_url.scheme.lower() in {"http", "https"}
                and parsed_url.netloc
            ):
                headline_host = _normalized_hostname(raw_url)
                if headline_host and any(
                    _hosts_match(headline_host, source_host) for source_host in grounding_hosts
                ):
                    mapped["url"] = parsed_url.geturl()
            headlines.append(mapped)

        events = []
        for item in source.get("upcomingEvents", [])[:4] if isinstance(source.get("upcomingEvents"), list) else []:
            if not isinstance(item, dict):
                continue
            importance = _string(item.get("importance"))
            events.append(
                {
                    "name": _string(item.get("name")),
                    "whenUtc": _normalize_utc_time(item.get("whenUtc")),
                    "importance": importance if importance in {"HIGH", "MEDIUM", "LOW"} else "MEDIUM",
                }
            )

        sources = []
        seen_source_uris = set()
        for item in grounding:
            web = item.get("web") if isinstance(item, dict) else None
            if not isinstance(web, dict):
                continue
            uri = web.get("uri")
            if isinstance(uri, str):
                normalized_uri = _normalized_uri(uri)
                if normalized_uri in seen_source_uris:
                    continue
                seen_source_uris.add(normalized_uri)
                sources.append({"uri": uri, "title": _string(web.get("title")) or uri})
                if len(sources) == 6:
                    break
        bias_signal = _string(source.get("biasSignal"))
        return {
            "headlines": headlines,
            "upcomingEvents": events,
            "biasSignal": bias_signal if bias_signal in {"SUPPORTS_BULLISH", "SUPPORTS_BEARISH", "MIXED", "NONE"} else "NONE",
            "notes": _string(source.get("notes")),
            "sources": sources,
        }

    async def research_market(self, label: str) -> dict[str, Any]:
        research_prompt = build_research_prompt(label)
        client = self.require_client()
        if self.name == "groq":
            result = await client.chat.completions.create(
                model=self.groq_model,
                messages=[{"role": "user", "content": research_prompt}],
                response_format={"type": "json_object"},
            )
            text = result.choices[0].message.content
            if not text:
                raise RuntimeError("No response text from model")
            return self.map_research_result(parse_json_object(text), map_groq_grounding(result))

        search_result = await client.responses.create(
            model=self.openai_model,
            tools=[{"type": "web_search"}],
            input=research_prompt,
        )
        source_material = search_result.output_text or "No web search material was returned."
        result = await client.responses.create(
            model=self.openai_model,
            input=f"""{research_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "market_research",
                    "strict": True,
                    "schema": RESEARCH_SCHEMA,
                }
            },
        )
        if not result.output_text:
            raise RuntimeError("No response text from model")
        return self.map_research_result(json.loads(result.output_text), map_openai_grounding(search_result))

    async def annotate(
        self,
        base64_image: str,
        prompt: str,
        lenses: list[str],
        market_context: str,
        instructions: str,
        knowledge: dict[str, Any],
    ) -> dict[str, Any]:
        augmented_prompt = build_forecast_prompt(
            instructions,
            knowledge["context"],
            "\n".join(knowledge["warnings"]) if knowledge["warnings"] else "",
            market_context,
            prompt,
            self.name == "groq",
        )
        client = self.require_client()
        if self.name == "groq":
            result = await client.chat.completions.create(
                model=self.groq_vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}},
                            {"type": "text", "text": augmented_prompt},
                        ],
                    }
                ],
                response_format={"type": "json_object"},
            )
            text = result.choices[0].message.content
            if not text:
                raise RuntimeError("No response text from model")
            forecast = normalize_forecast(parse_json_object(text))
        else:
            result = await client.responses.create(
                model=self.openai_model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_image", "image_url": f"data:image/png;base64,{base64_image}", "detail": "auto"},
                            {"type": "input_text", "text": augmented_prompt},
                        ],
                    }
                ],
                text={"format": {"type": "json_schema", "name": "forecast", "strict": True, "schema": FORECAST_SCHEMA}},
            )
            if not result.output_text:
                raise RuntimeError("No response text from model")
            forecast = json.loads(result.output_text)
            forecast["confidence"] = normalize_forecast(forecast)["confidence"]
        return {
            "analysis": json.dumps(forecast, separators=(",", ":"), ensure_ascii=False),
            "forecast": forecast,
            "knowledge": {"items": knowledge["items"], "warnings": knowledge["warnings"]},
        }

    async def chat(self, prompt: str, history: list[dict[str, Any]]) -> dict[str, Any]:
        client = self.require_client()
        if self.name == "groq":
            messages = [{"role": "system", "content": FORECAST_SYSTEM_PROMPT}]
            for entry in history or []:
                messages.append(
                    {
                        "role": "assistant" if entry.get("role") in {"model", "assistant"} else "user",
                        "content": (entry.get("parts") or [{}])[0].get("text") or entry.get("text") or "",
                    }
                )
            messages.append({"role": "user", "content": prompt})
            result = await client.chat.completions.create(model=self.groq_model, messages=messages)
            text = result.choices[0].message.content
            if not text:
                raise RuntimeError("No response text from model")
            return {"text": strip_citation_markers(text), "grounding": map_groq_grounding(result)}

        input_items = []
        for entry in history or []:
            is_assistant = entry.get("role") in {"model", "assistant"}
            input_items.append(
                {
                    "role": "assistant" if is_assistant else "user",
                    "content": [
                        {
                            "type": "output_text" if is_assistant else "input_text",
                            "text": (entry.get("parts") or [{}])[0].get("text") or entry.get("text") or "",
                        }
                    ],
                }
            )
        input_items.append({"role": "user", "content": [{"type": "input_text", "text": prompt}]})
        result = await client.responses.create(
            model=self.openai_model,
            instructions=FORECAST_SYSTEM_PROMPT,
            tools=[{"type": "web_search"}],
            input=input_items,
        )
        return {"text": strip_citation_markers(result.output_text), "grounding": map_openai_grounding(result)}
