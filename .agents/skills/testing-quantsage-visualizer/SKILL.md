# QuantSage Deep Visualizer Testing

Use this skill when testing QuantSage Deep Visualizer deployments, rollback versions, or AI-analysis behavior.

## Devin Secrets Needed

- `GROQ_API_KEY` — only needed for backend/proxy maintenance or smoke tests, not for public frontend browser testing.
- `OPENAI_API_KEY` — only relevant if a future task explicitly restores an OpenAI fallback; Groq-only runs should not use it.
- `FLY_API_TOKEN` — only relevant for Fly proxy maintenance if the user explicitly permits it. Do not use it for Groq-only frontend runtime tests.

## Environment and URLs

- Public frontend used in recent tests: `https://dist-vlkyerww.devinapps.com`.
- Groq-only proxy expected by public builds: `https://quantsage-groq-proxy-nvfxfwjk.fly.dev`.
- Standard chart fixture: `/home/ubuntu/quantsage-test-chart.png`.
- Public frontend tests do not require login.

## Browser Runtime Test Flow

1. Open the public frontend in Chrome and navigate to `Deep Visualizer` from the sidebar.
2. Confirm the expected version-specific UI before upload. For Groq-only/verifier-era checks, verify no OpenAI/fallback UI labels are visible.
3. Upload the chart fixture through the upload area (`Ingest Asset Data` / `DROP CHART OR BROWSE`).
4. Confirm the chart preview renders and `Analyze (1)` is enabled with `SMC Mechanics` selected.
5. Instrument browser fetch calls before clicking Analyze. A simple wrapper around `window.fetch` can record URL, method, status, and duration in `window.__qsFetchLog`.
6. Click `Analyze (1)` and record the GUI. Annotate upload, processing, result, network-safety, and any capacity caveats.
7. During processing, verify `Processing...` and `Neural Scan Active`.
8. After processing, verify either:
   - a successful `Neural Insights` result with chart annotations, or
   - a graceful fallback/error state that exits processing and does not crash/hang.
9. Inspect `window.__qsFetchLog` and browser console. All AI POSTs should route through the configured proxy; public browser traffic should not call `api.groq.com` or `api.openai.com` directly.

## Bundle Safety Check

After every deployment, fetch the live HTML and assets and count these strings:

- Expected for Groq-only public builds: exactly one or more references to the active Groq proxy URL.
- Must be zero in public bundles: `VITE_GROQ_API_KEY`, `OPENAI_API_KEY`, `api.groq.com`, `api.openai.com`, fallback proxy hostnames, and any provider key fragments.
- For verifier-era tests, `Specialist Verification` / `Lens Specialist Verification` should appear in the deployed bundle even if Groq rate limits prevent runtime verifier completion.

## Handling Groq Capacity Failures

Groq may return `429` or `413` during Visualizer tests. Treat these carefully:

- If primary analysis completes but validator/verifier calls are rate-limited, mark the deeper stage runtime completion as **untested/inconclusive**, not passed.
- If the UI exits processing and shows `Neural Insights` fallback or inline error text, report that graceful handling passed but live AI completion was not fully proven.
- If the UI remains stuck on `Processing...`, crashes, or shows a browser alert, mark the runtime flow failed.

## Reporting

- Post one PR comment with test results when testing a PR.
- Lead with capacity caveats before passed assertions.
- Attach the annotated recording and include screenshots for start/upload/processing/final states.
- Include network evidence: AI POST count, statuses, unique URLs, and counts for direct Groq/OpenAI/fallback calls.
