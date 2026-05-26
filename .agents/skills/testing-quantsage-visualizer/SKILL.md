---
name: testing-quantsage-visualizer
description: Test QuantSage Deep Visualizer chart-analysis flows, including Groq proxy fallback behavior and runtime network evidence.
---

# QuantSage Visualizer Testing

Use this when verifying Deep Visualizer chart upload, AI analysis, fallback copy, or Groq proxy behavior.

## Devin Secrets Needed

- No secrets are needed for browser-only testing of the public deployed frontend.
- Server/proxy debugging may require `GROQ_API_KEY` or proxy-specific deployment secrets if the task explicitly involves backend provider configuration. Do not print secret values.

## Standard UI Flow

1. Open the public deployment, e.g. `https://dist-vlkyerww.devinapps.com`.
2. Navigate to `Deep Visualizer` from the sidebar.
3. Upload the standard chart image from `/home/ubuntu/quantsage-test-chart.png` when available.
4. Confirm the chart renders and `Analyze (1)` becomes enabled.
5. Keep `SMC Mechanics` selected for focused fallback/verifier tests unless the task asks for another lens.
6. Click `Analyze (1)` and wait until `Processing...` / `Neural Scan Active` exits.

## Forced Capacity/Fallback Testing

To test fallback copy deterministically, block the Groq proxy host in the browser before clicking Analyze. One practical approach is to monkey-patch `window.fetch` from the browser console/CDP so requests containing `quantsage-groq-proxy-nvfxfwjk.fly.dev` throw a network error while logging each attempted URL.

Expected evidence for a fallback-copy test:

- Final UI renders `Neural Insights` and a `Framework Fallback` panel.
- New capacity copy appears, e.g. `Groq capacity is busy`, when that is the intended wording.
- Deprecated fallback copy such as `The live vision model is temporarily unavailable` should appear 0 times when testing its removal.
- Network evidence should show attempted POSTs to `quantsage-groq-proxy-nvfxfwjk.fly.dev`.
- Unless the task explicitly added recovery providers, verify 0 direct `api.openai.com`, 0 same-origin `/api/groq`, and 0 `openai-fallback` markers.

## Evidence to Capture

- Screen recording with annotations for setup, test start, precondition, final fallback/verifier assertion, and network assertion.
- Screenshot after upload with `Analyze (1)` enabled.
- Screenshot of final `Neural Insights` / fallback or verifier output.
- Text evidence with counts for new copy, deprecated copy, proxy attempts, same-origin API attempts, OpenAI calls, and fallback-provider markers.

## Notes

- Groq may return real `429` capacity errors. Treat this as an environmental/provider limitation, not automatically as a frontend failure, unless the task is specifically to eliminate capacity failures.
- For exact-revert tests, first clarify which behavior is expected at the target commit; old fallback copy or removed routes may be expected if the user requested an exact historical revert.
