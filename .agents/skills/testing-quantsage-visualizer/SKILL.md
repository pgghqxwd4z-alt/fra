# QuantSage Visualizer Testing

## Purpose

Use this skill when testing QuantSage Deep Visualizer runtime behavior, Groq-only proxy safety, image-analysis flows, or specialist verifier output.

## Devin Secrets Needed

- `GROQ_API_KEY`: needed only by the server-side Fly proxy, never by the browser/frontend.
- `FLY_API_TOKEN` or an app-specific Fly token: only needed when updating/restarting/deploying a Fly proxy. The token must belong to the Fly account/org that owns the target proxy app.

## Public app and proxy checks

1. Confirm the deployed app returns HTTP 200:
   ```bash
   curl -I https://dist-vlkyerww.devinapps.com
   ```
2. Confirm the active Groq proxy health endpoint returns `groq_configured: true`:
   ```bash
   curl -s https://quantsage-groq-proxy-nvfxfwjk.fly.dev/health
   ```
3. If a newly deployed Fly proxy returns 502, check whether the Fly account trial/billing is inactive before debugging frontend code. A 502 from Fly can happen before Groq is reached.

## Browser flow

1. Open `https://dist-vlkyerww.devinapps.com`.
2. Click `Deep Visualizer` in the sidebar.
3. Upload `/home/ubuntu/quantsage-test-chart.png` for the normal chart path.
4. Keep only `SMC Mechanics` selected unless explicitly testing multi-lens behavior. One lens reduces Groq capacity pressure.
5. Click `Analyze (1)`.
6. During processing, verify `Processing...` and `Neural Scan Active` are visible.
7. Final output should render under `Neural Insights`. For verifier-era testing, look for `Lens Specialist Verification`, `Annotation Decision Log`, and `Evidence Used`.

## Runtime network instrumentation

Before clicking `Analyze (1)`, instrument browser fetch from the Chrome console or CDP so requests can be summarized without exposing secrets:

```js
(() => {
  const originalFetch = window.__qsOriginalFetch || window.fetch.bind(window);
  window.__qsOriginalFetch = originalFetch;
  window.__qsTest = { requests: [], startedAt: new Date().toISOString() };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch (_) {}
    const record = {
      url,
      method: init?.method || 'GET',
      bodyChars: body.length,
      model: parsed?.model,
      max_tokens: parsed?.max_tokens,
      hasImage: body.includes('image_url') || body.includes('data:image'),
      startedAt: new Date().toISOString()
    };
    try {
      const response = await originalFetch(input, init);
      record.status = response.status;
      record.ok = response.ok;
      window.__qsTest.requests.push(record);
      return response;
    } catch (error) {
      record.error = String(error?.message || error);
      window.__qsTest.requests.push(record);
      throw error;
    }
  };
})();
```

After the run, summarize:

```js
(() => {
  const text = document.body.innerText || '';
  const reqs = window.__qsTest?.requests || [];
  return {
    hasNeuralInsights: /Neural Insights/i.test(text),
    hasLensSpecialistVerification: /Lens Specialist Verification/i.test(text),
    hasAnnotationDecisionLog: /Annotation Decision Log/i.test(text),
    hasEvidenceUsed: /Evidence Used/i.test(text),
    oldUnavailablePhraseCount: (text.match(/the live vision model is temporarily unavailable/gi) || []).length,
    aiProxyPosts: reqs.filter(r => r.url.includes('/api/groq/chat/completions')).length,
    directGroq: reqs.filter(r => r.url.includes('api.groq.com')).length,
    directOpenAI: reqs.filter(r => r.url.includes('api.openai.com')).length,
    fallbackProxy: reqs.filter(r => r.url.includes('fallback')).length,
    requests: reqs.map(r => ({ url: r.url, status: r.status, model: r.model, max_tokens: r.max_tokens, bodyChars: r.bodyChars, hasImage: r.hasImage }))
  };
})();
```

## Expected request pattern

- Browser AI requests should go only to the configured proxy URL, usually `https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions`.
- There should be 0 browser calls to `api.groq.com`, `api.openai.com`, or fallback proxy URLs.
- Current compact token caps are expected to be around: primary vision `1536`, text stage `768`, validator/verifier `1024`.
- Market data/search calls may go to public data/search APIs and are separate from AI provider calls.

## Capacity caveats

- Groq 429/413 responses can prevent validator/verifier stages from finishing even when the app code is correct.
- If Groq capacity is busy, retry after a cooldown with one lens selected.
- If the test goal is verifier output and Groq returns a fallback before Stage 3, mark verifier runtime completion as inconclusive rather than failed unless the UI crashes/hangs.
- A successful verifier response may only contain `PASS` decisions. That proves the decision log path but does not directly exercise removal of low-confidence annotations unless the model emits REMOVED or sub-threshold items.

## Reporting

For UI tests, record the browser session and annotate setup, test start, processing state, final verifier state, and network-safety assertion. Include screenshots of uploaded chart, processing state, and final output. In PR comments, keep one concise comment with collapsible details and link the Devin session.
