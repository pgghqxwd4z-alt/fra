---
name: testing-quantsage-visualizer
description: Test QuantSage Deep Visualizer and its server-side Groq/OpenAI proxy end-to-end. Use when verifying chart upload/analyze flows, provider fallback behavior, or AI key exposure safety.
---

# QuantSage Visualizer Testing

## Devin Secrets Needed

- `GROQ_API_KEY`: server-side Groq credential for the proxy.
- `OPENAI_API_KEY`: server-side OpenAI credential for fallback testing.
- `FLY_API_TOKEN` or a repo-specific Fly token may be needed only when deploying the proxy to Fly.

Never put provider keys in frontend env vars, browser local storage, screenshots, or committed files.

## Runtime Paths

- Deep Visualizer is reached from the left sidebar button labeled `Deep Visualizer`.
- Chart upload is the central panel labeled `Ingest Asset Data` / `DROP CHART OR BROWSE`.
- Use `/home/ubuntu/quantsage-test-chart.png` as a stable local test chart when available.
- The frontend uses `VITE_GROQ_PROXY_URL` when set; if unset, it calls same-origin `/api/groq/chat/completions`.
- The proxy health endpoint is `/health` and should return both `groq_configured: true` and `openai_fallback_configured: true` before fallback testing.

## Browser-Safe Same-Origin Test Pattern

If using Devin `deploy expose`, the public URL may contain Basic Auth credentials. Do not build the frontend with a URL like `https://user:password@host` because browser `fetch()` rejects credentialed request URLs.

Preferred local runtime test pattern:

1. Start the FastAPI proxy with `GROQ_API_KEY` and `OPENAI_API_KEY`.
2. Build the frontend with `VITE_GROQ_PROXY_URL` unset/empty so requests use `/api/groq/chat/completions`.
3. Serve `dist/` and the FastAPI routes from one local origin for browser testing.
4. Open that same-origin URL in Chrome, upload the chart, and click `Analyze (1)`.

This verifies the browser integration without exposing provider hosts or keys.

## Key Assertions

- `/health` returns `{"ok":true,"groq_configured":true,"openai_fallback_configured":true}`.
- Browser AI POST URLs are `/api/groq/chat/completions` or the configured proxy URL, never `api.groq.com` or `api.openai.com`.
- Browser AI request headers do not include `Authorization`.
- Provider response headers, when visible, are only `groq` or `openai-fallback`.
- A deterministic backend test should simulate Groq `429` with capacity/rate-limit wording and assert `x-quantsage-ai-provider: openai-fallback` plus OpenAI response content.
- Deep Visualizer should render `NEURAL INSIGHTS` / `Lens Specialist Verification` after analysis for a normal chart when providers are available.
- The old phrase `The live vision model is temporarily unavailable` and generic `temporarily unavailable` copy should be absent from rendered UI and built assets.
- Built frontend assets should not contain direct provider URLs `api.groq.com` or `api.openai.com`.

## Fly Config Checks

When verifying durable deployment config, parse `proxy/fly.toml` and check:

- `app = "quantsage-groq-proxy-francis"` when testing Francis' configured app.
- `primary_region = "iad"`.
- `[http_service].internal_port = 8000`.
- `auto_start_machines`, `auto_stop_machines`, and `force_https` are true.
- `[[vm]].memory = "1gb"` and `memory_mb = 1024`.

After Fly deploy, set server-side secrets on the Fly app before testing the frontend against it.
