import hmac
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

from .providers import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    GROQ_API_KEY,
    OPENAI_API_KEY,
    OPENAI_TEXT_MODEL,
    OPENAI_VISION_MODEL,
    PROVIDER_ADAPTERS,
    PROVIDER_KEYS,
    is_vision_request,
    select_result,
)

PROXY_ACCESS_KEY = os.environ.get("PROXY_ACCESS_KEY", "").strip()
PROXY_ALLOW_UNAUTHENTICATED = (
    os.environ.get("PROXY_ALLOW_UNAUTHENTICATED", "").strip().lower() == "true"
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]


app = FastAPI(title="QuantSage AI Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "x-quantsage-ai-provider",
        "x-quantsage-ai-route",
        "x-quantsage-ai-fallback",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-reset",
        "retry-after",
    ],
)


def _configured_chain(variable: str, default: str) -> list[str]:
    requested = os.environ.get(variable, default)
    return [
        provider
        for provider in (item.strip().lower() for item in requested.split(","))
        if provider in PROVIDER_ADAPTERS and PROVIDER_KEYS.get(provider)
    ]


VISION_CHAIN = _configured_chain("AI_VISION_PROVIDERS", "openai,anthropic,groq")
TEXT_CHAIN = _configured_chain("AI_TEXT_PROVIDERS", "anthropic,openai,groq")


ACCESS_POLICY_CONFIGURED = bool(PROXY_ACCESS_KEY) or PROXY_ALLOW_UNAUTHENTICATED


@app.get("/health")
async def health() -> JSONResponse:
    ready = ACCESS_POLICY_CONFIGURED and bool(VISION_CHAIN) and bool(TEXT_CHAIN)
    body = {
        "ok": ready,
        "access_policy_configured": ACCESS_POLICY_CONFIGURED,
        "providers": {
            "openai": bool(OPENAI_API_KEY),
            "anthropic": bool(ANTHROPIC_API_KEY),
            "groq": bool(GROQ_API_KEY),
        },
        "vision_chain": VISION_CHAIN,
        "text_chain": TEXT_CHAIN,
        "models": {
            "openai_vision": OPENAI_VISION_MODEL,
            "openai_text": OPENAI_TEXT_MODEL,
            "anthropic": ANTHROPIC_MODEL,
        },
        "openai_configured": bool(OPENAI_API_KEY),
        "openai_primary": bool(VISION_CHAIN and VISION_CHAIN[0] == "openai"),
        "access_key_required": bool(PROXY_ACCESS_KEY),
    }
    return JSONResponse(body, status_code=200 if ready else 503)


@app.post("/api/groq/chat/completions")
async def groq_chat_completions(request: Request) -> JSONResponse:
    if not ACCESS_POLICY_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail=(
                "PROXY_ACCESS_KEY is not configured; set it or "
                "PROXY_ALLOW_UNAUTHENTICATED=true for local development"
            ),
        )
    if PROXY_ACCESS_KEY and not hmac.compare_digest(
        request.headers.get("X-QuantSage-Proxy-Key", ""),
        PROXY_ACCESS_KEY,
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing proxy access key")

    payload = await request.json()
    route = "vision" if is_vision_request(payload) else "text"
    chain = VISION_CHAIN if route == "vision" else TEXT_CHAIN
    if not chain:
        raise HTTPException(
            status_code=500,
            detail=f"No AI provider configured for {route} requests",
        )

    provider, result, used_fallback = await select_result(None, payload, chain)
    headers = {
        name: value
        for name, value in result.headers.items()
        if name.lower().startswith("x-ratelimit-") or name.lower() == "retry-after"
    }
    headers["x-quantsage-ai-provider"] = provider
    headers["x-quantsage-ai-route"] = route
    if used_fallback:
        headers["x-quantsage-ai-fallback"] = "true"

    return JSONResponse(
        status_code=result.status_code,
        content=result.content,
        headers=headers,
    )
