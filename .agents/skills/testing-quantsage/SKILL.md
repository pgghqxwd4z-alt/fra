# QuantSage Runtime Testing

Use this skill when testing the QuantSage React/Vite app, especially Groq-backed AI Advisor or Deep Visualizer flows.

## Devin Secrets Needed

- `GROQ_API_KEY` — server-side Groq key used by the FastAPI proxy deployment. Do not expose it in frontend builds.

## Environments

- Public frontend: `https://dist-vlkyerww.devinapps.com`
- Public Groq proxy health endpoint: `https://quantsage-groq-proxy-nvfxfwjk.fly.dev/health`
- Public Groq proxy chat endpoint: `https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions`

For public frontend testing, the built asset should contain `VITE_GROQ_PROXY_URL` and should not contain `VITE_GROQ_API_KEY` or any `gsk_` fragments.

## Useful Commands

Run from repo root:

```bash
npm install
npm run lint
npm run build
```

For public-build safety, remove or rename any root `.env.local` before building unless it only contains non-secret `VITE_GROQ_PROXY_URL`.

## Deep Visualizer Per-Lens Verifier Test Flow

1. Open the deployed frontend in Chrome.
2. Navigate sidebar → `Deep Visualizer`.
3. Upload the preserved test image if available: `/home/ubuntu/quantsage-test-chart.png`.
4. Select only one target lens for an adversarial verifier test, usually `SMC Mechanics`.
5. Use a directive that forces evidence-backed correction, for example: `BTCUSDT: verify only evidence-backed SMC order blocks, FVGs, BOS/CHoCH, and remove unsupported annotations.`
6. Click `Analyze (1)`.
7. Verify the final `Neural Insights` contains:
   - `Lens Specialist Verification`
   - `Evidence Used`
   - `Corrected Analysis`
8. Verify the chart remains annotated after the analysis completes.

## Browser Network Evidence Pattern

Install fetch instrumentation before clicking `Analyze` so the browser proves proxy usage and verifier prompts:

```js
window.__qsFetchLog = [];
if (!window.__qsOriginalFetch) {
  window.__qsOriginalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init = {}] = args;
    const url = typeof input === 'string' ? input : input?.url;
    const body = init?.body;
    let bodyText = '';
    if (typeof body === 'string') bodyText = body;
    window.__qsFetchLog.push({ url, method: init?.method || 'GET', body: bodyText.slice(0, 5000), timestamp: new Date().toISOString() });
    return window.__qsOriginalFetch(...args);
  };
}
```

After the run, inspect:

```js
(() => {
  const logs = window.__qsFetchLog || [];
  const proxyPosts = logs.filter(e => String(e.url).includes('quantsage-groq-proxy'));
  const directGroq = logs.filter(e => String(e.url).includes('api.groq.com'));
  const verifier = logs.find(e => (e.body || '').includes('dedicated SMC Corrections AI'));
  const evidence = logs.find(e => (e.body || '').includes('WEB / NEWS / SENTIMENT SOURCES') || (e.body || '').includes('EXTERNAL MARKET DATA'));
  const domText = document.body.innerText;
  return {
    totalFetches: logs.length,
    proxyPostCount: proxyPosts.length,
    directGroqCount: directGroq.length,
    verifierProxyIndex: verifier ? logs.indexOf(verifier) : -1,
    evidencePromptIndex: evidence ? logs.indexOf(evidence) : -1,
    uiHasLensSpecialistVerification: domText.includes('Lens Specialist Verification'),
    uiHasEvidenceUsed: domText.includes('Evidence Used'),
    uiHasCorrectedAnalysis: domText.includes('Corrected Analysis')
  };
})()
```

Passing evidence should include proxy POSTs, `directGroqCount: 0`, verifier prompt text for the selected lens, and UI text confirming the verifier sections.

## Recording Guidance

For browser UI tests, maximize Chrome before starting a recording. Annotate at least:

- Setup: deployed app opened.
- Test start: the Visualizer verifier flow.
- Precondition assertion: correct lens selected and `Analyze (1)` enabled after upload.
- Result assertion: `Lens Specialist Verification` visible.
- Result assertion: `Evidence Used` / `Corrected Analysis` visible.
- Network assertion: proxy POST includes verifier text and no direct Groq call.
