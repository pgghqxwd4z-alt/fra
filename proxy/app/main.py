import os
import hmac

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv


load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
OPENAI_VISION_FALLBACK_MODEL = "gpt-4o"
OPENAI_TEXT_FALLBACK_MODEL = "gpt-4o-mini"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
PROXY_ACCESS_KEY = os.environ.get("PROXY_ACCESS_KEY", "").strip()
AI_PRIMARY_PROVIDER = os.environ.get("AI_PRIMARY_PROVIDER", "").strip().lower() or (
    "openai" if OPENAI_API_KEY else "groq"
)
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
        "openai_configured": bool(OPENAI_API_KEY),
        "openai_fallback_configured": bool(OPENAI_API_KEY),
        "openai_primary": AI_PRIMARY_PROVIDER == "openai",
        "access_key_required": bool(PROXY_ACCESS_KEY),
    }


def should_fallback_to_openai(response: httpx.Response, content: dict) -> bool:
    if response.status_code != 429:
        return False

    message = str(content.get("error", {}).get("message", "")).lower()
    return any(
        signal in message
        for signal in (
            "capacity",
            "rate limit",
            "rate-limit",
            "too many requests",
            "quota",
            "tokens per minute",
            "tokens per day",
            "tpm",
            "tpd",
            "daily",
        )
    )


def map_openai_payload(payload: dict) -> dict:
    openai_payload = dict(payload)
    model = str(payload.get("model", ""))
    openai_payload["model"] = (
        OPENAI_VISION_FALLBACK_MODEL
        if model == GROQ_VISION_MODEL
        else OPENAI_TEXT_FALLBACK_MODEL
    )
    return openai_payload


@app.post("/api/groq/chat/completions")
async def groq_chat_completions(request: Request) -> JSONResponse:
    if PROXY_ACCESS_KEY and not hmac.compare_digest(
        request.headers.get("X-QuantSage-Proxy-Key", ""),
        PROXY_ACCESS_KEY,
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing proxy access key")

    if AI_PRIMARY_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=500, detail="Server missing OPENAI_API_KEY")
    elif not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="Server missing GROQ_API_KEY")

    payload = await request.json()
    timeout = httpx.Timeout(95.0, connect=15.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        if AI_PRIMARY_PROVIDER == "openai":
            try:
                response = await client.post(
                    OPENAI_API_URL,
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=map_openai_payload(payload),
                )
                try:
                    content = response.json()
                except ValueError:
                    content = {"error": {"message": response.text or "OpenAI returned a non-JSON response"}}
            except httpx.TimeoutException as exc:
                raise HTTPException(status_code=504, detail="OpenAI request timed out") from exc
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

            passthrough_headers = {
                name: value
                for name, value in response.headers.items()
                if name.lower().startswith("x-ratelimit-") or name.lower() == "retry-after"
            }
            passthrough_headers["x-quantsage-ai-provider"] = "openai-primary"

            return JSONResponse(
                status_code=response.status_code,
                content=content,
                headers=passthrough_headers,
            )

        try:
            groq_response = await client.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="Groq request timed out") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Groq request failed") from exc

        try:
            content = groq_response.json()
        except ValueError:
            content = {"error": {"message": groq_response.text or "Groq returned a non-JSON response"}}

        response = groq_response
        used_fallback = False

        if OPENAI_API_KEY and should_fallback_to_openai(groq_response, content):
            try:
                response = await client.post(
                    OPENAI_API_URL,
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=map_openai_payload(payload),
                )
                used_fallback = True
                try:
                    content = response.json()
                except ValueError:
                    content = {"error": {"message": response.text or "OpenAI returned a non-JSON response"}}
            except httpx.TimeoutException as exc:
                raise HTTPException(status_code=504, detail="OpenAI fallback request timed out") from exc
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="OpenAI fallback request failed") from exc

    passthrough_headers = {
        name: value
        for name, value in response.headers.items()
        if name.lower().startswith("x-ratelimit-") or name.lower() == "retry-after"
    }
    passthrough_headers["x-quantsage-ai-provider"] = "openai-fallback" if used_fallback else "groq"

    return JSONResponse(
        status_code=response.status_code,
        content=content,
        headers=passthrough_headers,
    )
