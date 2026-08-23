# QuantSage Visualizer Testing

Use this skill when validating QuantSage Deep Visualizer or Groq proxy changes.

## Devin Secrets Needed

- `GROQ_API_KEY` — Groq key for server-side proxy validation or smoke tests.
- `FLY_API_TOKEN` / `FLY_QUANTSAGE_GROQ_PROXY_TOKEN` / `FLY_EXISTING_GROQ_PROXY_TOKEN` — only needed when deploying or updating Fly proxy apps. Use only with explicit user authorization for the target proxy.
- Do not use `OPENAI_API_KEY` for Groq-only validation.

## Environment and URLs

- Live frontend is commonly deployed to `https://dist-vlkyerww.devinapps.com`.
- Public frontend builds must use `VITE_GROQ_PROXY_URL`, not `VITE_GROQ_API_KEY`.
- Before public builds, remove or rename root `.env.local` so Vite cannot embed local secrets.
- Proxy health endpoint pattern: `https://<proxy-app>.fly.dev/health`; expected healthy shape includes `ok: true` and `groq_configured: true`.

## Useful Commands

```bash
npm run lint
VITE_GROQ_PROXY_URL=https://<proxy-app>.fly.dev npm run build
```

Bundle safety check should inspect deployed JS assets and verify:

- expected proxy URL appears at least once
- old proxy URL appears 0 times when switching proxies
- `api.groq.com` appears 0 times in the browser bundle
- `api.openai.com` appears 0 times for Groq-only builds
- `VITE_GROQ_API_KEY`, `OPENAI_API_KEY`, `gsk_`, and `sk-proj-` appear 0 times

## Deep Visualizer E2E Flow

1. Open the live frontend.
2. Click `Deep Visualizer` in the sidebar.
3. Verify the upload state shows `Ingest Asset Data` and `DROP CHART OR BROWSE`.
4. Verify `SMC Mechanics` is selected by default and `Analyze (1)` is disabled until upload.
5. Upload a representative chart image, such as `/home/ubuntu/quantsage-test-chart.png` if present.
6. Verify the chart renders and `Analyze (1)` becomes enabled.
7. Click `Analyze (1)`.
8. Verify processing shows `Processing...` and `Neural Scan Active`.
9. Verify final UI exits processing and shows either chart-specific `Neural Insights` or a clear `Groq capacity is busy` framework fallback.
10. Verify the old phrase `the live vision model is temporarily unavailable` is absent.

## Runtime Network Evidence

Use browser fetch instrumentation or CDP to capture runtime network calls. For Groq-only deployments:

- all AI POSTs should go to `https://<expected-proxy>.fly.dev/api/groq/chat/completions`
- 0 AI POSTs should go to old proxy URLs after a proxy switch
- 0 browser POSTs should go directly to `api.groq.com` or `api.openai.com`
- 0 browser POSTs should go to fallback proxy apps

When testing UI, record the browser and annotate: app loaded, Visualizer ready, chart uploaded, processing state, final result, network assertion.

## Reporting

Post one PR comment with concise assertions and artifacts. Lead with caveats, especially Groq `429` or `413` responses. Do not claim verifier completion if Groq capacity prevents the verifier stage from running.
