import os

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv


load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
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
    return {"ok": True, "groq_configured": bool(GROQ_API_KEY)}


@app.post("/api/groq/chat/completions")
async def groq_chat_completions(request: Request) -> JSONResponse:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="Server missing GROQ_API_KEY")

    payload = await request.json()
    timeout = httpx.Timeout(95.0, connect=15.0)

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

    return JSONResponse(
        status_code=response.status_code,
        content=content,
        headers=passthrough_headers,
    )
