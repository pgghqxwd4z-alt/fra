# QuantSage Visualizer Runtime Testing

Use this skill when testing QuantSage deployed UI flows, especially Deep Visualizer AI analysis, proxy-backed Groq calls, GS fallback, per-lens specialist verification, and Annotation Guard behavior.

## Devin Secrets Needed

- `GROQ_API_KEY`: Needed only when redeploying or running the backend Groq proxy locally/server-side. Never expose it in frontend bundles.

## Public Deployment Targets

- Frontend is commonly deployed at `https://dist-vlkyerww.devinapps.com`.
- Groq proxy is commonly deployed at `https://quantsage-groq-proxy-nvfxfwjk.fly.dev`.
- For public frontend builds, use `VITE_GROQ_PROXY_URL` and leave `VITE_GROQ_API_KEY` empty so no Groq key is bundled into browser JavaScript.

## Test Chart

- Use `/home/ubuntu/quantsage-test-chart.png` if present.
- The chart can be uploaded through Deep Visualizer by clicking the chart ingestion area and choosing the image from the file picker.

## Browser Test Practices

1. Maximize Chrome before recording. F11 fullscreen works reliably if normal maximize leaves Chrome at 1024x768.
2. Use the deployed UI for end-to-end tests; avoid curl for authenticated/browser-visible behavior.
3. Install browser fetch instrumentation before clicking Analyze when verifying network routing:
   - Record all POSTs to the Fly proxy.
   - Record any direct `api.groq.com` browser calls as a failure.
   - Do not log or print secrets.
4. For proxy-only checks, assert browser POSTs go to `/api/groq/chat/completions` on the Fly proxy and direct Groq count is zero.
5. Record UI tests and add annotations for setup, test start, and pass/fail assertions.

## Annotation Guard Harness Notes

When forcing weak Goldman Sachs annotations to verify the Annotation Guard:

- Classify the real guard request from the first/system message only.
- Require both markers:
  - `final Goldman Sachs Institutional Flow Annotation Guard AI`
  - `ANNOTATION GUARD MANDATE`
- Intercept only pre-guard GS stages and return HTTP 200 with text that has no fenced JSON block so `parseAnnotations()`/`parseVerifiedAnnotations()` cannot produce verified coverage.
- Pre-guard stages commonly include:
  - `primary-gs`: system prompt includes `Goldman Sachs managing director running the institutional flow desk`.
  - `knowledge-gs`: market research assistant prompt for Goldman/institutional flow evidence.
  - `validator-gs`: system prompt includes `STRICT Goldman Sachs / Institutional Flow framework validator`.
  - `verifier-gs`: system prompt includes `dedicated Goldman Sachs Institutional Flow Corrections AI` and `SPECIALIST VERIFICATION MANDATE`.
- Synthetic pre-guard response text must avoid `guard`, `trigger`, and `Annotation Guard`, because previous analysis text is copied into later validator/verifier prompts and can contaminate broad text matching.
- Pass criteria:
  - Exactly one `annotation-guard-gs` proxy request.
  - Guard response status 200.
  - UI shows `Annotation Guard Verification`.
  - Guard response contains at least 3 `lens: "gs"` annotations.
  - Guard annotations are not exactly the default GS placeholder set.
  - Direct browser calls to `api.groq.com` remain zero.

## GS Fallback Testing Notes

To verify the degraded Goldman Sachs fallback path:

- Force the first 3 GS primary vision proxy calls to synthetic 429s.
- Use a directive that does not contain raw internal terms like `primary-gs` or `max retries exceeded`, otherwise absence checks can become inconclusive.
- Pass criteria:
  - UI shows `GS Analysis — Framework Fallback`.
  - UI shows `Institutional Flow Checklist`.
  - UI shows sanitized `Fallback status` text.
  - UI does not show `GS Analysis — Temporary Failure`, `max retries exceeded`, `primary-gs`, or placeholder text.
  - Direct browser calls to `api.groq.com` remain zero.

## Reporting

- Post one consolidated GitHub PR comment per runtime test procedure.
- Include a short escalation section first, then pass/fail bullets.
- Attach or link the recording, key screenshots, and harness summary JSON.
- Write a separate `test-report.md` with inline screenshots before messaging the user.