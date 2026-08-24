# QuantSage

QuantSage is a React and FastAPI trading analysis terminal.

## Prerequisites

- Node.js 20.18.1
- npm 10.8.2
- Python 3.10+
- uv
- An OpenAI API key, or a Groq API key when using Groq

## Setup

```sh
cp .env.example .env
```

Set `AI_PROVIDER` to `openai` (the default) or `groq`, then provide the
corresponding API key in `.env`.

For OpenAI, `OPENAI_MODEL` is optional. For Groq, `GROQ_MODEL` and
`GROQ_VISION_MODEL` are optional and default to `groq/compound` and
`qwen/qwen3.6-27b`.

```sh
npm install
uv sync
npm run dev
```

`npm run dev` starts Vite on port 3000 and uvicorn on port 8000. Vite proxies
`/api` requests to the FastAPI backend. Set `PORT` and `BACKEND_PORT` to use
different ports.

To build and run the production server as one FastAPI process:

```sh
npm run build
uv run uvicorn app.main:app --no-proxy-headers --host 0.0.0.0 --port 3000
```

The FastAPI process serves `dist/client` when the client build exists and
provides `/api/chat`, `/api/annotate`, and `/api/knowledge/search`. Set
`APP_USERNAME` and `APP_PASSWORD` to require HTTP Basic authentication;
authentication is disabled with a warning when `APP_PASSWORD` is unset.
`RATE_LIMIT_WINDOW_SECONDS` and `RATE_LIMIT_MAX_REQUESTS` configure the
per-IP API quota. `RATE_LIMIT_MAX_IDENTITIES` bounds the in-process rate-limit
identity table. `TRUST_PROXY` is disabled by default; set it to the number of
trusted reverse proxies (for example, `1` for Render or Cloudflare followed by
the app) to use the corresponding rightmost `X-Forwarded-For` address for
rate limiting. Provider keys are server-side only.
