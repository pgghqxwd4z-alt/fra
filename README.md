# QuantSage

QuantSage is a React and FastAPI trading analysis terminal.

## Prerequisites

- Node.js 20.18.1
- npm 10.8.2
- Python 3.10+
- uv
- An OpenAI, Anthropic, Groq, or Gemini API key for the selected provider

## Setup

```sh
cp .env.example .env
```

Set `AI_PROVIDER` to `openai` (the default), `claude`, `groq`, or `gemini`, then provide the
corresponding API key in `.env`.

For OpenAI, `OPENAI_MODEL` is optional. For Groq, `GROQ_MODEL` and
`GROQ_VISION_MODEL` are optional and default to `groq/compound` and
`qwen/qwen3.6-27b`.
For Claude, `CLAUDE_MODEL` defaults to `claude-sonnet-5`. For Gemini,
`GEMINI_MODEL` defaults to `gemini-2.5-flash`. Set
`CONSENSUS_ENABLED=1` and configure `CONSENSUS_ENGINES` (the default is
`openai,claude,gemini`) to run the selected engines in parallel on the same
chart. `AGREE` means all models share the same bias and entry direction;
`MAJORITY` means more than half share a bias/direction pair and caps the
selected forecast at 70; `PARTIAL` means they differ without an opposite
bias/direction; `CONFLICT` means at least one opposite bias or direction;
`SINGLE` means only one model was available. Agreement never inflates
confidence; partial agreement caps it at 60 and conflict caps it at 45.
Consensus costs one provider call per engine per analysis. Per-model hit rates
need weeks of resolved forecasts before they mean anything.
The optional Groq fast scan is disabled by default; set `GROQ_SCAN_ENABLED=1`
only after verifying `GROQ_API_KEY`. It is a preliminary, non-gating chart read
that runs outside the forecast vote, is excluded from consensus, and is not
scored.

### Local knowledge library

QuantSage can use deterministic, user-supplied knowledge documents from
`app/library/*.json`. Each document contains metadata and entries with an ID,
section, tags, principle, and application. A prompt is tokenized into lowercase
alphanumeric words; entries receive a higher-weight score for matches between
their tags and the selected lens tags, plus a lower-weight score for prompt
overlap with their tags and text. Only positive-scoring entries are injected,
with stable ID tie-breaking and a small result limit.

Library hits are placed before live research items and appended to the forecast
knowledge context under a `LOCAL LIBRARY (user-supplied documents)` heading.
They provide context only: they never override live research or the verified
price feed, and they do not change consensus or risk calculations. To add a
document, drop another JSON file with the same shape into `app/library/` and
register its source in `KNOWLEDGE_SOURCES` in `app/schemas.py`. The original
PDF is intentionally not committed; the checked-in entries are condensed
paraphrases authored from that document.

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
authentication is disabled with a warning when `APP_PASSWORD` is unset. The
`/health` endpoint is intentionally unauthenticated so Render can perform its
HTTP health check without credentials.
`RATE_LIMIT_WINDOW_SECONDS` and `RATE_LIMIT_MAX_REQUESTS` configure the
per-IP API quota. `RATE_LIMIT_MAX_IDENTITIES` bounds the in-process rate-limit
identity table. `TRUST_PROXY` is disabled by default; set it to the number of
trusted reverse proxies (for example, `1` for Render or Cloudflare followed by
the app) to use the corresponding rightmost `X-Forwarded-For` address for
rate limiting. Market verification uses a three-tier priority: Oanda when
`OANDA_API_TOKEN` is set, Twelve Data when `TWELVEDATA_API_KEY` is set and
Oanda is unavailable, then keyless Yahoo Finance when
`MARKET_FALLBACK_ENABLED` (default `1`) is enabled. `OANDA_ENVIRONMENT` defaults
to `practice`; set it to `live` only when the corresponding Oanda token is
intended for the live environment. Yahoo Finance data is delayed, and its
metals symbols use COMEX futures as a proxy for spot, so these feeds are for
sanity-checking chart structure rather than exact-tick claims. When all feeds
are unavailable, forecasting continues with the previous screenshot-only
behavior.
`MARKET_RESEARCH_ENABLED` defaults to `1` and controls external headline and
event research. It costs one extra provider search call per forecast, adds
latency, degrades silently to screenshot-only forecasting when unavailable,
and requires a resolved instrument.
Provider keys are server-side only.

Forecast logging is enabled by default with `FORECAST_LOG_ENABLED=1`. Each
recognised-instrument forecast records its direction, confidence, live
reference price, parsed TP1/TP2/final and invalidation levels, feed metadata,
and later scoring fields in SQLite at `FORECAST_DB_PATH` (default
`data/forecasts.db`). The scorer marks a forecast as a win when TP1, TP2, or
the final target is reached, and as a loss when invalidation is reached first.
If TP1 and invalidation occur in the same M15 candle, the result is
`ambiguous`; a forecast with no touched level at the end of its configured
window is `expired`. Ambiguous and expired forecasts are excluded from the
win-rate denominator. Allow weeks of live forecasts to accumulate before
treating the hit rate as meaningful.
The forecast panel also calculates deterministic risk and reward-to-risk values
from parsed entry, invalidation, and target levels; nonnumeric levels are shown
as unavailable rather than inferred.

`FORECAST_HORIZON_HOURS` defaults to `48`. `FORECAST_DB_DURABLE=1` selects
durable SQLite settings when the configured path is on persistent storage.
Render's free plan uses ephemeral storage, so the SQLite log is lost on
redeploy unless `FORECAST_DB_PATH` is moved to a persistent disk; this
configuration does not add a Render disk. Yahoo Finance's 15-minute history
only reaches back approximately 60 days, which can limit scoring of older
forecasts.

## Render deployment

The repository includes a multi-stage `Dockerfile` and a `render.yaml`
Blueprint for deploying the client and FastAPI server as one Render web
service. The Docker build uses Node/npm to produce `dist/client`, then copies
only that build and the Python application into the runtime image. The runtime
uses the Render-provided `$PORT` value, defaulting to `10000` when run locally.
It starts Uvicorn with `--no-proxy-headers`; set `TRUST_PROXY=1` in Render so
the application, rather than Uvicorn, explicitly controls forwarded-client
identity handling.

To deploy:

1. Create a Render Blueprint from the repository. Render reads the root
   `render.yaml` and builds the declared Docker web service.
2. Enter `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `APP_PASSWORD` when prompted
   or in the Render service environment. `GROQ_API_KEY` is also declared as a
   secret placeholder if `AI_PROVIDER=groq` is selected. `GROQ_SCAN_ENABLED`
   remains opt-in and should stay `0` until the Groq key has been verified.
3. Keep `AI_PROVIDER=openai` for the default OpenAI deployment, or select
   `claude`/`groq`/`gemini` and provide its key. The Blueprint supplies defaults for the model,
   username, proxy trust, rate limits, Oanda practice mode, Twelve Data,
   Yahoo fallback, and market research. Enter `OANDA_API_TOKEN` to prefer
   Oanda live market verification; otherwise provide `TWELVEDATA_API_KEY` for
   Twelve Data or use the keyless Yahoo Finance fallback.

Render injects `PORT` at runtime; do not hardcode the public service port.
Provider keys and authentication secrets are read only from Render environment
variables and are not included in the image.
