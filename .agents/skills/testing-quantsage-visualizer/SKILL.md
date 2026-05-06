# QuantSage Visualizer Runtime Testing

Use this skill when testing QuantSage Deep Visualizer deployments, especially after changes to Groq routing, Stable/Full verification mode, Annotation Guard, lens verifier behavior, or provider fallback code.

## Devin Secrets Needed

- `GROQ_API_KEY` — required only for server-side proxy deployment/health work. Never expose it in frontend bundles.
- `OPENAI_API_KEY` — not needed for the current Groq-only deployment. Only use if the user explicitly asks to re-enable an additional fallback provider.
- Do not use `FLY_API_TOKEN` unless the user explicitly re-authorizes Fly changes in the current session.

## Standard Deployed App Checks

1. Open the deployed frontend, usually `https://dist-vlkyerww.devinapps.com`.
2. Navigate to **Deep Visualizer** from the left sidebar.
3. Confirm the best-version UI when applicable:
   - `Live Vision Mode`
   - `Stable Groq — fewer vision calls`
   - Toggle button text `Stable`
   - Helper text mentions Annotation Guard and Lens Specialist Verifier.
4. Confirm there is no visible `OpenAI`, `GPT-4o`, or fallback-proxy text for Groq-only deployments.
5. Use `/home/ubuntu/quantsage-test-chart.png` for chart-upload tests if present.

## Browser Fetch Logger

Install this before clicking Analyze:

```js
window.__qsFetchLog=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async (...args)=>{
  const url=String(args[0]?.url || args[0]);
  const method=(args[1]?.method || 'GET').toUpperCase();
  const entry={url,method,status:null,ok:null,error:null,ts:new Date().toISOString()};
  window.__qsFetchLog.push(entry);
  try {
    const response=await originalFetch(...args);
    entry.status=response.status;
    entry.ok=response.ok;
    return response;
  } catch (error) {
    entry.error=String(error);
    throw error;
  }
};
console.log('[TestHarness] Groq-only fetch logger installed');
```

Summarize after analysis:

```js
(() => {
  const log = window.__qsFetchLog || [];
  return {
    total: log.length,
    aiPosts: log.filter(e=>e.method==='POST').length,
    groqProxyPosts: log.filter(e=>e.method==='POST' && e.url === 'https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions').length,
    directGroq: log.filter(e=>e.url.includes('api.groq.com')).length,
    openaiCalls: log.filter(e=>e.url.includes('api.openai.com')).length,
    fallbackProxy: log.filter(e=>e.url.includes('quantsage-fallback-proxy-francis')).length,
    entries: log.map(e=>({method:e.method,url:e.url,status:e.status,ok:e.ok,error:e.error}))
  };
})();
```

Expected Groq-only runtime behavior:
- Every AI POST goes to `https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions`.
- `directGroq` is `0` in browser fetches.
- `openaiCalls` is `0`.
- `fallbackProxy` is `0`.

## Primary UI Flow

1. Click **Deep Visualizer**.
2. Click **Ingest Asset Data** and upload `/home/ubuntu/quantsage-test-chart.png`.
3. Confirm chart renders and `Analyze (1)` is enabled.
4. Click `Analyze (1)` in Stable mode.
5. Expected final visible state is either:
   - chart annotations plus `Neural Insights`, or
   - a clear Groq rate-limit/framework fallback if Groq returns 429.
6. Report Groq 429s as caveats. Do not claim full AI verification when required stages hit rate limits.

## Bundle Safety Verification

Run after deployment:

```bash
python3 - <<'PY'
import re, urllib.request, json
base='https://dist-vlkyerww.devinapps.com'
health_url='https://quantsage-groq-proxy-nvfxfwjk.fly.dev/health'
html_resp=urllib.request.urlopen(base, timeout=20)
html=html_resp.read().decode('utf-8')
assets=re.findall(r'/assets/[^"\\']+\\.js', html)
content=''
for asset in assets:
    content += urllib.request.urlopen(base+asset, timeout=20).read().decode('utf-8', errors='ignore')
health_resp=urllib.request.urlopen(health_url, timeout=20)
health=health_resp.read().decode('utf-8')
print(json.dumps({
  'frontend_status': html_resp.status,
  'proxy_health_status': health_resp.status,
  'proxy_health_body': health,
  'assets': assets,
  'groq_proxy': content.count('https://quantsage-groq-proxy-nvfxfwjk.fly.dev'),
  'fallback_proxy': content.count('quantsage-fallback-proxy-francis'),
  'api_openai_refs': content.count('api.openai.com'),
  'openai_api_key_refs': content.count('OPENAI_API_KEY'),
  'gpt4o_refs': content.count('gpt-4o') + content.count('GPT-4o'),
  'gsk_key_fragments': content.count('gsk_'),
  'openai_key_fragments': content.count('sk-proj-'),
  'stable_groq': content.count('Stable Groq'),
  'annotation_guard': content.count('Annotation Guard'),
  'groq_openai_compatible_path': content.count('api.groq.com/openai/v1/chat/completions'),
}, indent=2))
PY
```

Expected for Groq-only best-version deployment:
- `frontend_status` = 200.
- `groq_proxy` >= 1.
- `fallback_proxy` = 0.
- `api_openai_refs` = 0.
- `openai_api_key_refs` = 0.
- `gpt4o_refs` = 0.
- `gsk_key_fragments` = 0.
- `openai_key_fragments` = 0.
- `stable_groq` >= 1.
- `annotation_guard` >= 1.
- `groq_openai_compatible_path` may be 1 because Groq exposes an OpenAI-compatible endpoint; this is not an OpenAI provider/fallback reference.

## Reporting

When testing PR #7 or similar changes:
- Post one PR comment only.
- Lead with escalations/caveats.
- Include one concise bullet per assertion.
- Include screenshots in markdown tables and link the recording.
- Attach a local `test-artifacts/*test-report.md` to the final user message.
