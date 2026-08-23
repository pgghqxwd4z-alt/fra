---
name: testing-quantsage-visualizer
description: Test QuantSage frontend, Deep Visualizer, and AI-status/help-page flows end-to-end. Use when verifying Visualizer UI changes, Groq capacity handling, or public frontend deployments.
---

# QuantSage Visualizer Testing

## Devin Secrets Needed

- `GROQ_API_KEY` — required by the server-side Groq proxy, never set as `VITE_GROQ_API_KEY` for public frontend builds.
- `OPENAI_API_KEY` — optional proxy-side fallback if testing the combined proxy/fallback flow.
- `FLY_EXISTING_GROQ_PROXY_TOKEN` / `FLY_API_TOKEN` — only needed when deploying or inspecting Fly proxy apps.

## Public frontend

- Current public frontend has been deployed at `https://dist-vlkyerww.devinapps.com`.
- For public frontend builds that call the existing healthy Groq proxy, build with:
  ```bash
  VITE_GROQ_PROXY_URL=https://quantsage-groq-proxy-nvfxfwjk.fly.dev npm run build
  ```
- Do not set `VITE_GROQ_API_KEY`; Vite embeds `VITE_*` variables into the browser bundle.

## Local checks

Run these before deploying UI changes:

```bash
npm run lint
VITE_GROQ_PROXY_URL=https://quantsage-groq-proxy-nvfxfwjk.fly.dev npm run build
```

## Browser testing flow

1. Maximize Chrome before recording:
   ```bash
   sudo apt-get install -y wmctrl 2>/dev/null; wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
   ```
2. Open the deployed app in Chrome.
3. For help/status pages, test direct route access first, then any in-app links back to the main QuantSage shell.
4. For Deep Visualizer testing:
   - Click `Deep Visualizer` in the sidebar.
   - Upload a chart image from the home directory if available, such as `quantsage-test-chart.png`.
   - Keep a single lens selected first, usually `SMC Mechanics`, to reduce AI capacity load.
   - Click `Analyze (1)` and wait for processing to finish.
5. Verify visible UI text, link targets, and absence of old fallback phrases from the rendered page.
6. If Groq capacity is busy, treat the fallback as a valid runtime state and verify the app exits processing, shows the capacity fallback, and exposes any relevant help link.

## Evidence to capture

- Full-page screenshots of the public route or Visualizer result.
- A screen recording with annotations for setup, each test start, and each pass/fail assertion.
- A compact PR comment with screenshots and the Devin session link.
