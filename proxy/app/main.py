import os

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv


load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

app = FastAPI(title="QuantSage Groq Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {
        "ok": True,
        "groq_configured": bool(GROQ_API_KEY),
        "openai_fallback_configured": bool(OPENAI_API_KEY),
    }


def payload_contains_image(value: object) -> bool:
    if isinstance(value, dict):
        if value.get("type") == "image_url" or "image_url" in value:
            return True
        return any(payload_contains_image(nested) for nested in value.values())
    if isinstance(value, list):
        return any(payload_contains_image(item) for item in value)
    return False


def should_fallback_to_openai(status_code: int, content: object) -> bool:
    if status_code in {429, 500, 502, 503, 504}:
        return True

    if not isinstance(content, dict):
        return False

    error = content.get("error")
    if isinstance(error, dict):
        message = str(error.get("message", "")).lower()
    else:
        message = str(error or "").lower()

    fallback_markers = (
        "rate limit",
        "capacity",
        "temporarily unavailable",
        "unavailable",
        "overloaded",
        "timeout",
        "timed out",
    )
    return any(marker in message for marker in fallback_markers)


def build_openai_payload(payload: dict) -> dict:
    openai_payload = dict(payload)
    openai_payload["model"] = os.environ.get("OPENAI_VISION_FALLBACK_MODEL", "gpt-4o")

    max_tokens = openai_payload.pop("max_completion_tokens", None)
    if max_tokens is None:
        max_tokens = openai_payload.get("max_tokens")
    if max_tokens is not None:
        openai_payload["max_tokens"] = min(int(max_tokens), 4096)

    return openai_payload


async def post_openai_fallback(client: httpx.AsyncClient, payload: dict) -> httpx.Response:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=502, detail="OpenAI fallback is not configured")

    try:
        return await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=build_openai_payload(payload),
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="OpenAI fallback request timed out") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="OpenAI fallback request failed") from exc


@app.post("/api/groq/chat/completions")
async def groq_chat_completions(request: Request) -> JSONResponse:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="Server missing GROQ_API_KEY")

    payload = await request.json()
    timeout = httpx.Timeout(95.0, connect=15.0)
    uses_vision = payload_contains_image(payload.get("messages", []))
    fallback_headers: dict[str, str] = {}

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except httpx.TimeoutException as exc:
            if uses_vision and OPENAI_API_KEY:
                response = await post_openai_fallback(client, payload)
                fallback_headers = {
                    "x-quantsage-fallback-provider": "openai",
                    "x-quantsage-fallback-reason": "groq-timeout",
                }
            else:
                raise HTTPException(status_code=504, detail="Groq request timed out") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Groq request failed") from exc

    passthrough_headers = {
        name: value
        for name, value in response.headers.items()
        if name.lower().startswith("x-ratelimit-") or name.lower() == "retry-after"
    }

    try:
        content = response.json()
    except ValueError:
        content = {"error": {"message": response.text or "Groq returned a non-JSON response"}}

    if (
        not fallback_headers
        and uses_vision
        and OPENAI_API_KEY
        and should_fallback_to_openai(response.status_code, content)
    ):
        groq_status_code = response.status_code
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await post_openai_fallback(client, payload)
        fallback_headers = {
            "x-quantsage-fallback-provider": "openai",
            "x-quantsage-fallback-reason": f"groq-{groq_status_code}",
        }

        try:
            content = response.json()
        except ValueError:
            content = {
                "error": {
                    "message": response.text or "OpenAI fallback returned a non-JSON response"
                }
            }

    return JSONResponse(
        status_code=response.status_code,
        content=content,
        headers={**passthrough_headers, **fallback_headers},
    )
