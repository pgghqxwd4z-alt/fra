# QuantSage Runtime Testing

Use this skill when testing QuantSage frontend deployments, especially Deep Visualizer chart-analysis flows and Groq proxy routing.

## Devin Secrets Needed

- None required for public frontend runtime testing at the deployed app URL.
- `GROQ_API_KEY` may be needed only when maintaining or running a server-side Groq proxy locally. Never expose it through `VITE_*` frontend variables.
- Do not use `FLY_API_TOKEN` unless the user explicitly authorizes Fly deployment/secret changes for that task.

## Public App and Test Asset

- Public frontend commonly used in this project: `https://dist-vlkyerww.devinapps.com`
- Groq proxy commonly used in this project: `https://quantsage-groq-proxy-nvfxfwjk.fly.dev`
- A reusable chart image may exist at `/home/ubuntu/quantsage-test-chart.png`; if missing, ask the user for a chart or create a non-secret synthetic chart fixture.

## Pre-Test Checks

1. Confirm frontend and proxy are reachable:
   ```bash
   python3 - <<'PY'
   import urllib.request
   print(urllib.request.urlopen('https://dist-vlkyerww.devinapps.com', timeout=20).status)
   print(urllib.request.urlopen('https://quantsage-groq-proxy-nvfxfwjk.fly.dev/health', timeout=20).read().decode())
   PY
   ```
2. For public builds, confirm no secrets or direct AI provider endpoints are embedded in `dist/`:
   ```bash
   python3 - <<'PY'
   from pathlib import Path
   text='\n'.join(p.read_text(errors='ignore') for p in Path('dist').rglob('*') if p.is_file())
   for needle in ['api.groq.com','api.openai.com','VITE_GROQ_API_KEY','OPENAI_API_KEY','gsk_','sk-']:
       print(needle, text.count(needle))
   PY
   ```
3. Run the project checks before reporting completion:
   ```bash
   npm run lint
   VITE_GROQ_PROXY_URL=https://quantsage-groq-proxy-nvfxfwjk.fly.dev npm run build
   ```

## Browser Runtime Test Flow

1. Open the deployed app in Chrome and start a recording only after setup is complete.
2. Navigate via sidebar: `Deep Visualizer`.
3. Verify expected Visualizer mode text for the version under test:
   - Oldest rollback should show `Ingest Asset Data`, `DROP CHART OR BROWSE`, `SMC Mechanics`, and `Analyze (1)` after upload.
   - Best-version builds may show `Live Vision Mode`, `Stable Groq`, Specialist Verification, or Annotation Guard; only assert those when that version is expected.
4. Install fetch instrumentation before clicking Analyze:
   ```js
   (() => {
     window.__qsFetchLog = [];
     if (!window.__qsFetchPatched) {
       const orig = window.fetch.bind(window);
       window.__qsFetchPatched = true;
       window.fetch = async (...args) => {
         const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
         const method = (args[1]?.method || 'GET').toUpperCase();
         const started = Date.now();
         try {
           const res = await orig(...args);
           window.__qsFetchLog.push({ url, method, status: res.status, ok: res.ok, ms: Date.now() - started });
           return res;
         } catch (e) {
           window.__qsFetchLog.push({ url, method, error: String(e), ms: Date.now() - started });
           throw e;
         }
       };
     }
   })()
   ```
5. Upload the chart, click `Analyze (1)`, and verify processing text such as `Neural Scan Active` appears.
6. After completion, inspect `window.__qsFetchLog` and assert:
   - AI POSTs go only to the expected Groq proxy `/api/groq/chat/completions`.
   - Browser makes 0 direct requests to `api.groq.com` and 0 requests to `api.openai.com`.
   - Browser makes 0 requests to any fallback proxy unless the tested version intentionally uses it.
7. Verify the result state: `Neural Insights` and lens-specific analysis text, or explicitly report any rate-limit/capacity alert as a caveat.

## Reporting

- Lead with caveats such as Groq 429s or market-data CORS/network failures.
- Include one concise PR comment with results, a recording link, and screenshot evidence.
- Attach a separate markdown report with inline screenshots and shell evidence.
- If Groq is rate-limited but the UI handles it as designed, mark the live-AI portion as caveated rather than fully failed.
