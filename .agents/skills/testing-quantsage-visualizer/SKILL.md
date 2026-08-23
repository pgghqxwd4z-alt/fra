---
name: testing-quantsage-visualizer
description: Test the QuantSage Deep Visualizer flow end-to-end on a deployed frontend.
---

# QuantSage Visualizer Runtime Testing

## Devin Secrets Needed

- No frontend login secret is needed for the public Devin Apps deployment.
- Provider API keys should never be visible in browser traffic.
- If a local proxy/backend is tested, use saved server-side secrets such as `GROQ_API_KEY` only in shell/runtime environments.

## Live Test Flow

1. Open the deployed frontend in Chrome, usually `https://dist-vlkyerww.devinapps.com` unless the PR says otherwise.
2. If using the browser UI, start a screen recording and annotate route, upload, analyze, final output, and network checks.
3. Confirm the app shell loads and the sidebar includes `Deep Visualizer`.
4. Open `Deep Visualizer` and verify the upload panel shows `Ingest Asset Data` / `DROP CHART OR BROWSE`.
5. Upload a known chart, for example `/home/ubuntu/quantsage-test-chart.png` if present.
6. Confirm `Analyze (1)` is enabled, click it, and wait until `Processing...` / `Neural Scan Active` exits.
7. Capture final screenshots showing chart annotations and `Neural Insights` or fallback output.

## Provider Traffic Checks

For old-proxy deployments, expected AI host is:

```text
https://quantsage-groq-proxy-nvfxfwjk.fly.dev/api/groq/chat/completions
```

Record old Groq proxy request count, same-origin `/api/groq` count, direct OpenAI/Groq count, and fallback marker strings like `openai-fallback`.

## Route / Revert Checks

When verifying a removed help/recovery page, open the route directly, for example `/groq-capacity`. It should not render removed copy like `AI capacity recovery`, `server-side recovery proxy`, or `fallback provider`; the normal app shell should still work.

## Groq Capacity Caveat

Groq may return capacity/rate-limit failures. If the UI exits processing and shows deterministic fallback, mark fallback rendering as passed but full verifier sections as untested unless they actually render. Preserve whether the fallback wording is expected for the version under test.

## Reporting

Write a test report with inline screenshots, escalations first, pass/fail/untested bullets, network evidence, recording attachment, and one collapsed PR comment linking the Devin session.
