from __future__ import annotations

import base64
import json
import logging
import math
import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urlparse

from anthropic import AsyncAnthropic
from google import genai
from google.genai import types as gemini_types
from openai import AsyncOpenAI

from .prompts import (
    FORECAST_SYSTEM_PROMPT,
    build_forecast_prompt,
    build_research_prompt,
    build_retrieval_prompt,
)
from .schemas import FORECAST_SCHEMA, KNOWLEDGE_SCHEMA, RESEARCH_SCHEMA, SCAN_SCHEMA, source_for


PRIVATE_CITATION_RE = re.compile(
    r"[\uE000-\uF8FF]*cite[\uE000-\uF8FF]*[A-Za-z0-9_-]+[\uE000-\uF8FF]*",
    re.IGNORECASE,
)
logger = logging.getLogger("quantsage.providers")


class SafeMessageError(RuntimeError):
    """An application error safe to expose to API clients."""


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


_GEMINI_SCHEMA_KEYS = {"type", "properties", "required", "items", "enum", "description", "nullable"}


def _to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    converted: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in _GEMINI_SCHEMA_KEYS:
            continue
        if key == "properties" and isinstance(value, dict):
            converted[key] = {
                property_name: _to_gemini_schema(property_schema)
                for property_name, property_schema in value.items()
                if isinstance(property_schema, dict)
            }
        elif key == "items" and isinstance(value, dict):
            converted[key] = _to_gemini_schema(value)
        else:
            converted[key] = value
    return converted


def require_forecast_confidence(forecast: dict[str, Any], engine: str) -> None:
    confidence = forecast.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(confidence):
        raise SafeMessageError(f"{engine} omitted confidence")


def parse_json_object(text: str) -> dict[str, Any]:
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise ValueError("Model returned invalid JSON.") from None
        result = json.loads(match.group(0))
    return result if isinstance(result, dict) else {}


def _log_claude_json_failure(text: str, error: Exception, attempt: str) -> None:
    offset = max(0, min(getattr(error, "pos", 0), len(text)))
    start = max(0, offset - 150)
    end = min(len(text), offset + 150)
    excerpt = text[start:end].replace("\n", "\\n")
    logger.warning(
        "Claude %s JSON parse failed at offset %s: %s",
        attempt,
        offset,
        excerpt,
    )


def _log_claude_truncation(text: str, attempt: str) -> None:
    excerpt = text[max(0, len(text) - 300):].replace("\n", "\\n")
    logger.warning(
        "Claude %s response truncated at max_tokens; excerpt: %s",
        attempt,
        excerpt,
    )


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


def map_gemini_grounding(result: Any) -> list[dict[str, dict[str, str]]]:
    metadatas = [object_dict(getattr(result, "grounding_metadata", None))]
    metadatas.extend(
        object_dict(getattr(candidate, "grounding_metadata", None))
        for candidate in (getattr(result, "candidates", None) or [])
    )
    mapped: list[dict[str, dict[str, str]]] = []
    seen: set[str] = set()
    for metadata in metadatas:
        chunks = (
            metadata.get("grounding_chunks", metadata.get("groundingChunks", []))
            if isinstance(metadata, dict)
            else []
        )
        for item in chunks if isinstance(chunks, list) else []:
            item = object_dict(item)
            web = object_dict(item.get("web")) if isinstance(item, dict) else None
            uri = web.get("uri") if isinstance(web, dict) else None
            if not isinstance(uri, str) or not re.match(r"https?://", uri, re.IGNORECASE):
                continue
            normalized = _normalized_uri(uri)
            if normalized in seen:
                continue
            seen.add(normalized)
            mapped.append({"web": {"uri": uri, "title": str(web.get("title") or uri)}})
    return mapped


def map_claude_grounding(message: Any) -> list[dict[str, dict[str, str]]]:
    chunks: list[dict[str, dict[str, str]]] = []
    seen: set[str] = set()

    def add(uri: Any, title: Any) -> None:
        if not isinstance(uri, str) or not re.match(r"https?://", uri, re.IGNORECASE):
            return
        normalized = _normalized_uri(uri)
        if normalized in seen:
            return
        seen.add(normalized)
        chunks.append({"web": {"uri": uri, "title": str(title) if title else uri}})

    def visit(value: Any) -> None:
        value = object_dict(value)
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            block_type = value.get("type")
            if block_type in {"web_search_result", "web_search_result_location"}:
                add(value.get("url"), value.get("title"))
            for child in value.values():
                visit(child)

    visit(message)
    return chunks


def _claude_text(message: Any) -> str:
    blocks = message.content
    return "".join(block.text for block in blocks if block.type == "text" and block.text)


class AIProvider:
    def __init__(self) -> None:
        import os

        provider = (os.getenv("AI_PROVIDER") or "openai").strip().lower()
        self.name = provider if provider in {"openai", "groq", "claude", "gemini"} else "openai"
        self.openai_model = os.getenv("OPENAI_MODEL") or "gpt-4o"
        self.groq_model = os.getenv("GROQ_MODEL") or "groq/compound"
        self.groq_vision_model = os.getenv("GROQ_VISION_MODEL") or "qwen/qwen3.6-27b"
        self.claude_model = os.getenv("CLAUDE_MODEL") or "claude-sonnet-5"
        self.gemini_model = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
        openai_key = os.getenv("OPENAI_API_KEY")
        groq_key = os.getenv("GROQ_API_KEY")
        claude_key = os.getenv("ANTHROPIC_API_KEY")
        gemini_key = os.getenv("GEMINI_API_KEY")
        self._clients: dict[str, AsyncOpenAI | AsyncAnthropic | genai.Client] = {}
        if openai_key:
            self._clients["openai"] = AsyncOpenAI(api_key=openai_key)
        if groq_key:
            self._clients["groq"] = AsyncOpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
        if claude_key:
            self._clients["claude"] = AsyncAnthropic(api_key=claude_key)
        if gemini_key:
            self._clients["gemini"] = genai.Client(api_key=gemini_key)
        self.client = self._clients.get(self.name)
        self._gemini_schema_supported: bool | None = None

    @property
    def missing_key_message(self) -> str:
        return self.missing_key_message_for(self.name)

    @staticmethod
    def missing_key_message_for(engine: str) -> str:
        return f"{ {'openai': 'OPENAI', 'groq': 'GROQ', 'claude': 'ANTHROPIC', 'gemini': 'GEMINI'}.get(engine, 'OPENAI') }_API_KEY environment variable is not set."

    def has_engine(self, engine: str) -> bool:
        return engine in self._clients

    def _require_openai(self, engine: str) -> AsyncOpenAI:
        client = self._clients.get(engine)
        if not isinstance(client, AsyncOpenAI):
            raise SafeMessageError(self.missing_key_message_for(engine))
        return client

    def _require_claude(self) -> AsyncAnthropic:
        client = self._clients.get("claude")
        if not isinstance(client, AsyncAnthropic):
            raise SafeMessageError(self.missing_key_message_for("claude"))
        return client

    def _require_gemini(self) -> genai.Client:
        client = self._clients.get("gemini")
        if not isinstance(client, genai.Client):
            raise SafeMessageError(self.missing_key_message_for("gemini"))
        return client

    def require_client(self) -> AsyncOpenAI | AsyncAnthropic | genai.Client:
        client = self._clients.get(self.name)
        if client is None:
            raise SafeMessageError(self.missing_key_message)
        return client

    @staticmethod
    def _gemini_schema_error(error: Exception) -> bool:
        message = str(error).lower()
        return "response_schema" in message or "additional_properties" in message or "invalid json payload" in message

    async def _gemini_json(
        self,
        client: genai.Client,
        contents: Any,
        schema: dict[str, Any],
        include_schema: bool,
        tools: list[Any] | None = None,
    ) -> Any:
        if self._gemini_schema_supported is not False:
            try:
                response = await client.aio.models.generate_content(
                    model=self.gemini_model,
                    contents=contents,
                    config=gemini_types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=_to_gemini_schema(schema),
                        tools=tools,
                    ),
                )
            except Exception as error:
                if not self._gemini_schema_error(error):
                    raise
                self._gemini_schema_supported = False
            else:
                self._gemini_schema_supported = True
                return response
        response = await client.aio.models.generate_content(
            model=self.gemini_model,
            contents=contents,
            config=gemini_types.GenerateContentConfig(
                response_mime_type="application/json",
                tools=tools,
            ),
        )
        return response

    async def _gemini_search(self, client: genai.Client, prompt: str) -> Any:
        chat = client.aio.chats.create(
            model=self.gemini_model,
            config=gemini_types.GenerateContentConfig(
                tools=[gemini_types.Tool(google_search=gemini_types.GoogleSearch())],
            ),
        )
        return await chat.send_message(f"Use Google Search now.\n\n{prompt}")

    async def retrieve_knowledge(
        self,
        prompt: str,
        lenses: list[str],
        market_context: str,
        engine: str | None = None,
    ) -> dict[str, Any]:
        engine_name = engine or self.name
        source_ids = route_knowledge(lenses)
        source_text = "\n".join(f"- {source_id}" for source_id in source_ids)
        retrieval_prompt = build_retrieval_prompt(prompt, market_context, source_text)
        if engine_name == "gemini":
            client = self._require_gemini()
            search = await self._gemini_search(client, retrieval_prompt)
            source_material = search.text or "No web search material was returned."
            result = await self._gemini_json(
                client,
                f"""{retrieval_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
                KNOWLEDGE_SCHEMA,
                include_schema=True,
            )
            text = result.text or ""
            if not text:
                return {"items": [], "context": "NO EXTERNAL KNOWLEDGE RETRIEVED.", "warnings": ["Knowledge retrieval returned no text."]}
            return self.map_knowledge_result(parse_json_object(text))
        if engine_name == "claude":
            client = self._require_claude()
            search_result = await client.messages.create(
                model=self.claude_model,
                max_tokens=4096,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=[{"role": "user", "content": retrieval_prompt}],
            )
            source_material = _claude_text(search_result) or "No web search material was returned."
            result = await client.messages.create(
                model=self.claude_model,
                max_tokens=4096,
                messages=[
                    {
                        "role": "user",
                        "content": f"""{retrieval_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
                    }
                ],
                output_config={"format": {"type": "json_schema", "schema": KNOWLEDGE_SCHEMA}},
            )
            text = _claude_text(result)
            if not text:
                return {"items": [], "context": "NO EXTERNAL KNOWLEDGE RETRIEVED.", "warnings": ["Knowledge retrieval returned no text."]}
            return self.map_knowledge_result(parse_json_object(text))
        client = self._require_openai(engine_name)
        if engine_name == "groq":
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

    async def research_market(self, label: str, engine: str | None = None) -> dict[str, Any]:
        engine_name = engine or self.name
        research_prompt = build_research_prompt(label)
        if engine_name == "gemini":
            client = self._require_gemini()
            search = await self._gemini_search(
                client,
                f"Search current {label} market headlines from the last 48 hours and upcoming events. Include current sources.",
            )
            source_material = search.text or "No web search material was returned."
            result = await self._gemini_json(
                client,
                f"""{research_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
                RESEARCH_SCHEMA,
                include_schema=True,
            )
            text = result.text or ""
            if not text:
                raise SafeMessageError("No response text from model")
            return self.map_research_result(parse_json_object(text), map_gemini_grounding(search))
        if engine_name == "claude":
            client = self._require_claude()
            search_result = await client.messages.create(
                model=self.claude_model,
                max_tokens=4096,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=[{"role": "user", "content": research_prompt}],
            )
            source_material = _claude_text(search_result) or "No web search material was returned."
            result = await client.messages.create(
                model=self.claude_model,
                max_tokens=4096,
                messages=[
                    {
                        "role": "user",
                        "content": f"""{research_prompt}

WEB SEARCH MATERIAL:
{source_material}

Convert the material above into the requested JSON schema. Return JSON only.""",
                    }
                ],
                output_config={"format": {"type": "json_schema", "schema": RESEARCH_SCHEMA}},
            )
            text = _claude_text(result)
            if not text:
                raise SafeMessageError("No response text from model")
            return self.map_research_result(parse_json_object(text), map_claude_grounding(search_result))
        client = self._require_openai(engine_name)
        if engine_name == "groq":
            result = await client.chat.completions.create(
                model=self.groq_model,
                messages=[{"role": "user", "content": research_prompt}],
                response_format={"type": "json_object"},
            )
            text = result.choices[0].message.content
            if not text:
                raise SafeMessageError("No response text from model")
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
            raise SafeMessageError("No response text from model")
        return self.map_research_result(json.loads(result.output_text), map_openai_grounding(search_result))

    async def annotate(
        self,
        base64_image: str,
        prompt: str,
        lenses: list[str],
        market_context: str,
        instructions: str,
        knowledge: dict[str, Any],
        engine: str | None = None,
    ) -> dict[str, Any]:
        engine_name = engine or self.name
        augmented_prompt = build_forecast_prompt(
            instructions,
            knowledge["context"],
            "\n".join(knowledge["warnings"]) if knowledge["warnings"] else "",
            market_context,
            prompt,
            engine_name in {"groq", "gemini"},
        )
        if engine_name == "gemini":
            client = self._require_gemini()
            contents = [
                gemini_types.Part.from_bytes(data=base64.b64decode(base64_image), mime_type="image/png"),
                augmented_prompt,
            ]
            result = await self._gemini_json(client, contents, FORECAST_SCHEMA, include_schema=True)
            text = result.text or ""
            if not text:
                raise SafeMessageError("No response text from model")
            raw_forecast = parse_json_object(text)
            require_forecast_confidence(raw_forecast, engine_name)
            forecast = normalize_forecast(raw_forecast)
            model = self.gemini_model
        elif engine_name == "claude":
            client = self._require_claude()

            async def create_claude_message(text_prompt: str) -> Any:
                return await client.messages.create(
                    model=self.claude_model,
                    max_tokens=4096,
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64_image}},
                        {"type": "text", "text": text_prompt},
                    ]}],
                    output_config={"format": {"type": "json_schema", "schema": FORECAST_SCHEMA}},
                )

            message = await create_claude_message(augmented_prompt)
            text = _claude_text(message)
            if not text:
                raise SafeMessageError("No response text from model")

            if getattr(message, "stop_reason", None) == "max_tokens":
                _log_claude_truncation(text, "initial")
                raise SafeMessageError("claude response truncated at max_tokens")
            try:
                forecast = parse_json_object(text)
            except (json.JSONDecodeError, ValueError) as error:
                _log_claude_json_failure(text, error, "initial")
                retry_prompt = f"""{augmented_prompt}

Return JSON only. Escape all quotes inside string values. Do not include prose outside the JSON object."""
                retry_message = await create_claude_message(retry_prompt)
                retry_text = _claude_text(retry_message)
                if not retry_text:
                    raise SafeMessageError("No response text from model after Claude JSON retry")
                if getattr(retry_message, "stop_reason", None) == "max_tokens":
                    _log_claude_truncation(retry_text, "retry")
                    raise SafeMessageError("claude response truncated at max_tokens")
                try:
                    forecast = parse_json_object(retry_text)
                except (json.JSONDecodeError, ValueError) as retry_error:
                    _log_claude_json_failure(retry_text, retry_error, "retry")
                    raise SafeMessageError("claude returned malformed JSON after retry") from retry_error
            require_forecast_confidence(forecast, engine_name)
            forecast["confidence"] = normalize_forecast(forecast)["confidence"]
            model = self.claude_model
        elif engine_name == "groq":
            client = self._require_openai(engine_name)
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
                raise SafeMessageError("No response text from model")
            raw_forecast = parse_json_object(text)
            require_forecast_confidence(raw_forecast, engine_name)
            forecast = normalize_forecast(raw_forecast)
            model = self.groq_vision_model
        else:
            client = self._require_openai(engine_name)
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
                raise SafeMessageError("No response text from model")
            forecast = json.loads(result.output_text)
            require_forecast_confidence(forecast, engine_name)
            forecast["confidence"] = normalize_forecast(forecast)["confidence"]
            model = self.openai_model
        return {
            "analysis": json.dumps(forecast, separators=(",", ":"), ensure_ascii=False),
            "forecast": forecast,
            "knowledge": {"items": knowledge["items"], "warnings": knowledge["warnings"]},
            "engine": engine_name,
            "model": model,
        }

    async def scan(self, base64_image: str, prompt: str, instrument: str | None = None) -> dict[str, Any]:
        client = self._require_openai("groq")
        scan_prompt = f"""Perform a fast, preliminary visual market scan for {instrument or "the supplied chart"}.

This is not a forecast and must not contain a tradeable call. Do not provide confidence,
an entry, targets, TP levels, invalidation, stop, or position guidance. Return exactly
one JSON object with bias, up to four observable keyLevels, and one concise sentence note.

USER DIRECTIVE:
{prompt or "Scan the supplied chart."}

Return ONLY valid JSON matching this schema:
{json.dumps(SCAN_SCHEMA, indent=2)}"""
        result = await client.chat.completions.create(
            model=self.groq_vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}},
                        {"type": "text", "text": scan_prompt},
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )
        text = result.choices[0].message.content
        if not text:
            raise SafeMessageError("No response text from Groq scan")
        raw_scan = parse_json_object(text)
        bias = raw_scan.get("bias")
        key_levels = raw_scan.get("keyLevels")
        note = raw_scan.get("note")
        if bias not in {"BULLISH", "BEARISH", "NEUTRAL"}:
            raise SafeMessageError("Groq scan returned invalid bias")
        if not isinstance(key_levels, list) or any(not isinstance(level, str) for level in key_levels):
            raise SafeMessageError("Groq scan returned invalid key levels")
        if not isinstance(note, str) or not note.strip():
            raise SafeMessageError("Groq scan returned invalid note")
        return {
            "bias": bias,
            "keyLevels": [level.strip() for level in key_levels[:4]],
            "note": note.strip(),
        }

    async def chat(self, prompt: str, history: list[dict[str, Any]], engine: str | None = None) -> dict[str, Any]:
        engine_name = engine or self.name
        if engine_name == "gemini":
            client = self._require_gemini()
            history_contents = []
            for entry in history or []:
                history_contents.append(
                    {
                        "role": "model" if entry.get("role") in {"model", "assistant"} else "user",
                        "parts": [{"text": (entry.get("parts") or [{}])[0].get("text") or entry.get("text") or ""}],
                    }
                )
            chat = client.aio.chats.create(
                model=self.gemini_model,
                config=gemini_types.GenerateContentConfig(
                    system_instruction=FORECAST_SYSTEM_PROMPT,
                    tools=[gemini_types.Tool(google_search=gemini_types.GoogleSearch())],
                ),
                history=history_contents,
            )
            result = await chat.send_message(prompt)
            text = result.text or ""
            if not text:
                raise SafeMessageError("No response text from model")
            return {"text": strip_citation_markers(text), "grounding": map_gemini_grounding(result)}
        if engine_name == "claude":
            client = self._require_claude()
            messages = []
            for entry in history or []:
                messages.append(
                    {
                        "role": "assistant" if entry.get("role") in {"model", "assistant"} else "user",
                        "content": (entry.get("parts") or [{}])[0].get("text") or entry.get("text") or "",
                    }
                )
            messages.append({"role": "user", "content": prompt})
            result = await client.messages.create(
                model=self.claude_model,
                max_tokens=4096,
                system=FORECAST_SYSTEM_PROMPT,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=messages,
            )
            return {"text": strip_citation_markers(_claude_text(result)), "grounding": map_claude_grounding(result)}
        client = self._require_openai(engine_name)
        if engine_name == "groq":
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
                raise SafeMessageError("No response text from model")
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
