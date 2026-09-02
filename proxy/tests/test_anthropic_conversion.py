import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from proxy.app import providers
from proxy.app.providers import (
    ProviderResult,
    convert_anthropic_response,
    convert_openai_to_anthropic,
    is_vision_request,
    select_result,
)


def test_system_messages_are_extracted_and_concatenated():
    result = convert_openai_to_anthropic(
        {
            "messages": [
                {"role": "system", "content": "one"},
                {"role": "system", "content": "two"},
                {"role": "user", "content": "hello"},
            ],
            "max_tokens": 12,
        }
    )

    assert result["system"] == "one\ntwo"
    assert result["messages"] == [{"role": "user", "content": "hello"}]


def test_data_url_image_is_converted_to_base64_source():
    result = convert_openai_to_anthropic(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "describe"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64,aGVsbG8="
                            },
                        },
                    ],
                }
            ]
        }
    )

    assert result["messages"][0]["content"][1] == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "aGVsbG8=",
        },
    }


def test_consecutive_same_roles_are_merged():
    result = convert_openai_to_anthropic(
        {
            "messages": [
                {"role": "user", "content": "first"},
                {"role": "user", "content": "second"},
                {"role": "assistant", "content": "answer"},
            ]
        }
    )

    assert result["messages"] == [
        {"role": "user", "content": "first\nsecond"},
        {"role": "assistant", "content": "answer"},
    ]


@pytest.mark.parametrize(
    "messages",
    [
        [{"role": "assistant", "content": "answer"}],
        [{"role": "system", "content": "context"}],
        [],
    ],
)
def test_first_message_is_user(messages):
    result = convert_openai_to_anthropic({"messages": messages})

    assert result["messages"][0] == {"role": "user", "content": "(context)"}


def test_response_conversion_finish_reasons_and_usage():
    result = convert_anthropic_response(
        {
            "id": "msg_1",
            "model": "claude-test",
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "tool_use", "id": "tool"},
                {"type": "text", "text": " world"},
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 4, "output_tokens": 3},
        }
    )

    assert result["choices"][0]["finish_reason"] == "stop"
    assert result["choices"][0]["message"]["content"] == "hello world"
    assert result["usage"]["total_tokens"] == 7

    result = convert_anthropic_response(
        {
            "id": "msg_2",
            "content": [{"type": "text", "text": "partial"}],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 1, "output_tokens": 2},
        }
    )
    assert result["choices"][0]["finish_reason"] == "length"


def test_vision_request_detection():
    assert is_vision_request(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "image_url", "image_url": {"url": "x"}}],
                }
            ]
        }
    )
    assert not is_vision_request(
        {"messages": [{"role": "user", "content": "no image"}]}
    )


def test_select_result_falls_back_and_marks_header(monkeypatch):
    calls = []

    async def first(_client, _payload):
        calls.append("first")
        return ProviderResult(429, {"error": {"message": "busy"}}, {})

    async def second(_client, _payload):
        calls.append("second")
        return ProviderResult(200, {"ok": True}, {})

    monkeypatch.setattr(
        providers,
        "PROVIDER_ADAPTERS",
        {"first": first, "second": second},
    )
    provider, result, fallback = asyncio.run(
        select_result(None, {}, ["first", "second"])
    )

    assert calls == ["first", "second"]
    assert provider == "second"
    assert result.status_code == 200
    assert fallback is True


def test_select_result_returns_last_result_when_all_fail(monkeypatch):
    async def first(_client, _payload):
        return ProviderResult(503, {"error": {"message": "down"}}, {})

    async def second(_client, _payload):
        return ProviderResult(529, {"error": {"message": "overloaded"}}, {})

    monkeypatch.setattr(
        providers,
        "PROVIDER_ADAPTERS",
        {"first": first, "second": second},
    )
    provider, result, fallback = asyncio.run(
        select_result(None, {}, ["first", "second"])
    )

    assert provider == "second"
    assert result.status_code == 529
    assert fallback is True
