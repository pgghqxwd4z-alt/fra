# QuantSage Visualizer Testing

Use this skill when deploying or testing the QuantSage Deep Visualizer / Groq-backed chart analysis flow.

## Safety rules

- Public frontend builds must use `VITE_GROQ_PROXY_URL`; never use `VITE_GROQ_API_KEY` for public deployment because Vite embeds `VITE_*` values in the browser bundle.
- Before public builds, remove or ignore any root `.env.local` that may contain frontend API keys.
- Runtime browser AI traffic should go only to the configured Groq proxy endpoint `/api/groq/chat/completions`.
- Confirm there are zero direct browser references/calls to `api.groq.com`, `api.openai.com`, fallback proxy URLs, `VITE_GROQ_API_KEY`, or `OPENAI_API_KEY`.

## Deployment checks

1. Verify the intended proxy health first:
   - `curl -i https://<proxy>.fly.dev/health`
   - Expected: HTTP 200 and `groq_configured: true`.
2. Build with the proxy URL:
   - `VITE_GROQ_PROXY_URL=https://<proxy>.fly.dev npm run build`
3. Deploy `dist/` to the static frontend host.
4. Check the deployed app returns HTTP 200.
5. Search built assets for safety:
   - exactly one intended proxy reference
   - zero old/unintended proxy references
   - zero direct provider/API key strings
   - verifier-era strings present when testing d20f306-like builds: `Specialist Verification`, `Lens Specialist Verification`

## Live Deep Visualizer test

Use a normal chart fixture and an oversized chart fixture.

1. Open the deployed app and navigate to `Deep Visualizer`.
2. Upload the normal chart.
3. Verify `SMC Mechanics` is selected and `Analyze (1)` is enabled.
4. Click `Analyze (1)` and verify `Neural Scan Active` / `Processing...` appears.
5. Wait for processing to end.
6. Pass conditions:
   - UI exits processing.
   - `Neural Insights` appears.
   - If Groq capacity allows, verifier-era output includes `Lens Specialist Verification` and correction/evidence text.
   - If Groq capacity blocks, UI should show a clear Groq-capacity fallback and must not hang.
   - The old phrase `the live vision model is temporarily unavailable` should not appear in fixed builds.

## Network assertions

Instrument `fetch` in the browser or inspect DevTools network:

- Every AI POST URL should be the intended proxy `/api/groq/chat/completions`.
- There should be 0 direct calls to `api.groq.com`, `api.openai.com`, or fallback proxies.
- Expected reduced token budgets for the capacity-fix build:
  - primary vision: `max_tokens: 1536`
  - text/fallback stage: `max_tokens: 768`
  - validator/verifier: `max_tokens: 1024`

## Oversized chart compression test

1. Upload an oversized chart fixture (multi-MB image).
2. Run `Analyze (1)`.
3. Compare raw data URL size to the first Groq request body size.
4. Pass condition: the request is substantially compressed before Groq; for the current fixture, ~7.6M raw chars should shrink to well under 650k chars in the first Groq body.

## Common blockers

- HTTP 502 from Fly before Groq is reached usually means proxy infrastructure/billing/boot failure, not a Groq model failure. Check Fly logs/status and `/health`.
- Groq `429` or `413` means Groq quota/token capacity pressure. Reduce lenses, retry later, compress images, cap tokens/retries, or use a higher-capacity Groq key on the proxy.
- Fly API access only manages/restarts/sets secrets on the proxy; it does not add Groq AI capacity.
