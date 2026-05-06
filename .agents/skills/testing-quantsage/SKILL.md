# QuantSage Runtime Testing

Use this skill when testing QuantSage frontend deployments, especially Deep Visualizer rollbacks or changes to Groq/proxy routing.

## Devin Secrets Needed

- `GROQ_API_KEY`: only needed for server-side proxy setup or direct local proxy testing. Do not expose it to the Vite frontend.
- `OPENAI_API_KEY`: not needed for Groq-only runtime testing. Only use if the user explicitly asks to test OpenAI fallback.
- `FLY_API_TOKEN`: do not use unless the user explicitly re-authorizes Fly app management. Routine frontend deploy/runtime testing should not need it.

## Build and deploy checks

1. Install dependencies if needed:
   ```bash
   npm install
   ```
2. Run lint:
   ```bash
   npm run lint
   ```
3. Build public frontend with the Groq proxy URL, not a browser API key:
   ```bash
   VITE_GROQ_PROXY_URL=https://quantsage-groq-proxy-nvfxfwjk.fly.dev npm run build
   ```
4. Deploy the static frontend from `dist/`.
5. Verify the deployed bundle before testing UI:
   - exactly one `https://quantsage-groq-proxy-nvfxfwjk.fly.dev` reference is expected
   - zero `api.groq.com`
   - zero `api.openai.com`
   - zero `VITE_GROQ_API_KEY`
   - zero `OPENAI_API_KEY`
   - zero fallback proxy references unless explicitly testing fallback

## Browser runtime test flow

The public deployed app normally requires no login. Use `/home/ubuntu/quantsage-test-chart.png` when available.

1. Open `https://dist-vlkyerww.devinapps.com`.
2. For mobile/sidebar regressions, set a mobile viewport below `1024px` and verify:
   - sidebar starts off-canvas
   - header toggle opens sidebar
   - dark backdrop appears
   - `X` close button appears
   - clicking `Deep Visualizer` auto-closes sidebar
3. In `Deep Visualizer`, upload the test chart and verify:
   - chart appears
   - `SMC Mechanics` remains selected
   - `Analyze (1)` is enabled
4. Before clicking Analyze, instrument browser `fetch` to record request URLs/statuses. CDP is available at `http://localhost:29229`.
5. Click `Analyze (1)` and verify:
   - button changes to `Processing...`
   - overlay includes `Neural Scan Active`
   - at least one POST goes to `https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions`
6. When processing finishes, acceptable outcomes depend on Groq capacity:
   - success: `Neural Insights` with chart-specific SMC analysis and annotations
   - Groq capacity failure: `Neural Insights` with `SMC Analysis — Temporary Failure` and placeholder annotations
   - failure: UI stuck on `Processing...`, browser alert, or no final success/fallback panel
7. Confirm runtime traffic:
   - all AI POSTs go to the Groq proxy
   - zero direct browser calls to `api.groq.com`
   - zero direct browser calls to `api.openai.com`
   - zero fallback proxy calls unless explicitly testing fallback

## Notes

- Groq rate limits or payload limits can make live vision return `429` or `413`. Treat this as an external capacity caveat, not necessarily a frontend regression, if the UI falls back gracefully and traffic stays proxy-only.
- `Annotation Engine Notice` is a top-level Visualizer exception UI. Normal per-lens Groq failures may be caught inside `geminiService.annotateChart` and render `SMC Analysis — Temporary Failure` inside `Neural Insights` instead.
- Always record GUI runtime tests and annotate mobile sidebar, chart upload, processing state, final result/fallback, and proxy-only network evidence.
