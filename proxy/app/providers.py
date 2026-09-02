import os
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx
from dotenv import load_dotenv


load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

OPENAI_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")
OPENAI_TEXT_MODEL = os.environ.get("OPENAI_TEXT_MODEL", "gpt-4o-mini")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
PROVIDER_KEYS = {
    "openai": OPENAI_API_KEY,
    "anthropic": ANTHROPIC_API_KEY,
    "groq": GROQ_API_KEY,
}

ProviderAdapter = Callable[[httpx.AsyncClient, dict], Awaitable["ProviderResult"]]


@dataclass
class ProviderResult:
    status_code: int
    content: dict
    headers: dict[str, str] = field(default_factory=dict)


def is_vision_request(payload: dict) -> bool:
    return any(
        isinstance(message.get("content"), list)
        and any(
            isinstance(part, dict) and part.get("type") == "image_url"
            for part in message["content"]
        )
        for message in payload.get("messages", [])
        if isinstance(message, dict)
    )


def _response_content(response: httpx.Response, provider: str) -> dict:
    try:
        content = response.json()
        return content if isinstance(content, dict) else {"error": {"message": str(content)}}
    except ValueError:
        return {
            "error": {
                "message": response.text or f"{provider} returned a non-JSON response"
            }
        }


def _result_from_response(response: httpx.Response, provider: str) -> ProviderResult:
    return ProviderResult(
        status_code=response.status_code,
        content=_response_content(response, provider),
        headers=dict(response.headers),
    )


def _error_result(status_code: int, provider: str, message: str) -> ProviderResult:
    return ProviderResult(
        status_code=status_code,
        content={"error": {"message": message}},
    )


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(95.0, connect=15.0)


async def call_groq(client: httpx.AsyncClient, payload: dict) -> ProviderResult:
    try:
        response = await client.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        return _result_from_response(response, "Groq")
    except httpx.TimeoutException:
        return _error_result(504, "Groq", "Groq request timed out")
    except httpx.HTTPError:
        return _error_result(502, "Groq", "Groq request failed")


async def call_openai(client: httpx.AsyncClient, payload: dict) -> ProviderResult:
    openai_payload = {
        key: value
        for key, value in payload.items()
        if key not in {"reasoning_format", "reasoning_effort"}
    }
    openai_payload["model"] = (
        OPENAI_VISION_MODEL if is_vision_request(payload) else OPENAI_TEXT_MODEL
    )
    try:
        response = await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=openai_payload,
        )
        return _result_from_response(response, "OpenAI")
    except httpx.TimeoutException:
        return _error_result(504, "OpenAI", "OpenAI request timed out")
    except httpx.HTTPError:
        return _error_result(502, "OpenAI", "OpenAI request failed")


def _anthropic_image(url: str) -> dict:
    match = re.match(r"^data:([^;,]+);base64,(.*)$", url, re.DOTALL)
    if match:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": match.group(1),
                "data": match.group(2),
            },
        }
    return {
        "type": "image",
        "source": {"type": "url", "url": url},
    }


def _anthropic_content(content: Any) -> Any:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return content

    converted = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            converted.append({"type": "text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            image_url = part.get("image_url", {})
            url = image_url.get("url", "") if isinstance(image_url, dict) else ""
            converted.append(_anthropic_image(url))
    return converted


def _merge_content(left: Any, right: Any) -> Any:
    if isinstance(left, str) and isinstance(right, str):
        return f"{left}\n{right}"

    def as_blocks(value: Any) -> list:
        if isinstance(value, list):
            return value
        return [{"type": "text", "text": value}]

    return as_blocks(left) + as_blocks(right)


def convert_openai_to_anthropic(payload: dict) -> dict:
    system_parts = []
    messages = []
    for message in payload.get("messages", []):
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role == "system":
            system_parts.append(str(message.get("content", "")))
            continue
        if role not in {"user", "assistant"}:
            continue
        converted = {
            "role": role,
            "content": _anthropic_content(message.get("content", "")),
        }
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] = _merge_content(
                messages[-1]["content"], converted["content"]
            )
        else:
            messages.append(converted)

    if not messages or messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": "(context)"})

    result = {
        "model": ANTHROPIC_MODEL,
        "messages": messages,
        "max_tokens": payload.get("max_tokens") or 1024,
    }
    if system_parts:
        result["system"] = "\n".join(system_parts)
    if "temperature" in payload:
        result["temperature"] = payload["temperature"]
    return result


def convert_anthropic_response(content: dict) -> dict:
    if content.get("type") == "error" and isinstance(content.get("error"), dict):
        error = content["error"]
        return {
            "error": {
                "message": error.get("message", ""),
                "type": error.get("type", ""),
            }
        }

    text = "".join(
        block.get("text", "")
        for block in content.get("content", [])
        if isinstance(block, dict) and block.get("type") == "text"
    )
    stop_reason = content.get("stop_reason")
    if stop_reason == "end_turn":
        finish_reason = "stop"
    elif stop_reason == "max_tokens":
        finish_reason = "length"
    else:
        finish_reason = stop_reason
    usage = content.get("usage", {})
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)
    return {
        "id": content.get("id"),
        "object": "chat.completion",
        "model": content.get("model", ANTHROPIC_MODEL),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    }


async def call_anthropic(client: httpx.AsyncClient, payload: dict) -> ProviderResult:
    anthropic_payload = convert_openai_to_anthropic(payload)
    try:
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=anthropic_payload,
        )
        content = _response_content(response, "Anthropic")
        if response.is_success or content.get("type") == "error":
            content = convert_anthropic_response(content)
        return ProviderResult(
            status_code=response.status_code,
            content=content,
            headers=dict(response.headers),
        )
    except httpx.TimeoutException:
        return _error_result(504, "Anthropic", "Anthropic request timed out")
    except httpx.HTTPError:
        return _error_result(502, "Anthropic", "Anthropic request failed")


PROVIDER_ADAPTERS: dict[str, ProviderAdapter] = {
    "openai": call_openai,
    "anthropic": call_anthropic,
    "groq": call_groq,
}


def should_fallback(result: ProviderResult) -> bool:
    return result.status_code in {408, 409, 429, 500, 502, 503, 504, 529}


async def select_result(
    client: httpx.AsyncClient | None, payload: dict, chain: list[str]
) -> tuple[str, ProviderResult, bool]:
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=_timeout())
    try:
        last_provider = chain[-1]
        last_result = _error_result(500, last_provider, "No provider result")
        for index, provider in enumerate(chain):
            result = await PROVIDER_ADAPTERS[provider](client, payload)
            last_provider = provider
            last_result = result
            if not should_fallback(result):
                return provider, result, index > 0
        return last_provider, last_result, len(chain) > 1
    finally:
        if owns_client:
            await client.aclose()
