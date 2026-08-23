# QuantSage Deep Visualizer Runtime Testing

Use this skill when testing the QuantSage Deep Visualizer chart-upload and Groq live-vision pipeline.

## Devin Secrets Needed

- `GROQ_API_KEY` — only needed for proxy/server smoke tests or deployment updates. Never expose it in the frontend or write it into `VITE_*` variables for public builds.
- `FLY_API_TOKEN` / `FLY_EXISTING_GROQ_PROXY_TOKEN` / `FLY_QUANTSAGE_GROQ_PROXY_TOKEN` — only needed if updating or checking Fly proxy configuration. Tokens must have access to the target Fly app.

## Public Deployment Rules

- For public frontend builds, use `VITE_GROQ_PROXY_URL=<proxy-url>`.
- Do not use `VITE_GROQ_API_KEY` in public builds because Vite embeds `VITE_*` values into the browser bundle.
- Before public build/deploy, ensure root `.env.local` cannot accidentally inject a frontend Groq key.
- Healthy known proxy may be `https://quantsage-groq-proxy-nvfxfwjk.fly.dev`; verify `/health` before testing because proxy ownership/billing can change.

## Fixtures

Common chart fixtures on Devin machines may include:

- `/home/ubuntu/quantsage-test-chart.png` — normal chart for full verifier-path testing.
- `/home/ubuntu/quantsage-oversized-chart.jpg` — oversized chart for image-compression testing.

If fixtures are missing, create a non-secret synthetic chart image rather than using private user data.

## Runtime Test Procedure

1. Open the deployed app in Chrome.
2. Start a screen recording if using the GUI.
3. Install browser fetch instrumentation before clicking Analyze so each request records:
   - URL
   - method/status
   - model
   - `max_tokens`
   - request body length
   - inline base64 image length
4. Navigate to `Deep Visualizer`.
5. Confirm upload state shows `Ingest Asset Data` / `DROP CHART OR BROWSE`.
6. Upload the normal chart fixture.
7. Confirm `SMC Mechanics` is selected and the button says `Analyze (1)`.
8. Click `Analyze (1)` and confirm `Processing...` plus `Neural Scan Active`.
9. Wait until processing exits.
10. Confirm final output includes `Neural Insights`. If Groq capacity allows the full path, confirm `Lens Specialist Verification` and `Evidence Used`.
11. Inspect captured requests:
    - All AI POSTs should go to the configured Groq proxy `/api/groq/chat/completions`.
    - No browser request should go directly to `api.groq.com` or `api.openai.com`.
    - No request should go to an unintended fallback proxy.
    - Primary vision should use compact `max_tokens` such as `1536`.
    - Validator/verifier should use compact `max_tokens` such as `1024`; text stages should use compact caps such as `768`.
12. Repeat with the oversized chart fixture.
13. Confirm first AI request inline image payload is compressed below the configured threshold (for the current build, below about `650,000` chars).
14. If Groq returns `429`, treat it as a capacity caveat, not a UI failure, if the app exits processing and renders fallback/partial `Neural Insights` without the old unavailable phrase.

## Evidence To Save

- Full-screen screenshots for normal-chart final state and oversized-chart final state.
- Runtime JSON evidence containing captured fetch records and visible-text checks.
- Recording with annotations for setup, test starts, and assertions.
- PR test comment with one concise summary and collapsed evidence sections.

## Bundle Safety Checks

After build/deploy, search the deployed bundle for:

- `api.groq.com` — should be `0` in public frontend bundles.
- `api.openai.com` — should be `0` unless an intentional public-safe provider proxy was added.
- `GROQ_API_KEY`, `OPENAI_API_KEY`, `VITE_GROQ_API_KEY` — should be `0`.
- The active proxy URL — should be present once or as expected.
- Old fallback wording such as `the live vision model is temporarily unavailable` — should be `0` if the current task is the Groq-capacity wording/failure-path fix.

## Reporting Guidance

- Put escalations first. If any stage returns `429`, say so clearly.
- Do not claim the full specialist verifier passed unless `Lens Specialist Verification` and `Evidence Used` rendered at runtime.
- It is acceptable to mark recovery as passed if the UI exits processing, stays proxy-only, and shows `Neural Insights`/fallback without hanging or exposing keys.
