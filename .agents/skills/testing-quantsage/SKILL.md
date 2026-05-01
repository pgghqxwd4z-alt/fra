# QuantSage Testing Skill

## Purpose

Use this skill when testing QuantSage runtime flows, especially public deployments that must use the server-side Groq proxy instead of embedding a Groq key in the Vite frontend bundle.

## Devin Secrets Needed

- `GROQ_API_KEY`: Required for backend/proxy deployments and any Groq-backed local API validation. Do not expose this in frontend `VITE_*` variables for public builds.

## Setup and Commands

- Install dependencies: `npm install`
- Lint: `npm run lint`
- Build frontend for a secure public deployment:
  ```bash
  VITE_GROQ_API_KEY= VITE_GROQ_PROXY_URL="https://<proxy-host>" npm run build
  ```
- Build artifacts should be scanned before deployment:
  - The bundle should contain the proxy hostname.
  - The bundle should not contain `gsk_` or known key fragments.
- Watch for root `.env.local`: Vite automatically loads it and can embed `VITE_GROQ_API_KEY` into public frontend bundles. Remove or rename local frontend `.env.local` before public proxy builds. A `proxy/.env` file is server-side only and should remain ignored.

## Public Groq Proxy Test Flow

1. Verify proxy health before UI testing:
   - `GET https://<proxy-host>/health`
   - Expected: HTTP `200` with `{"ok":true,"groq_configured":true}`.
2. Verify a minimal proxy completion if Groq rate limits are suspected. Use a small `max_tokens` value to avoid token/day failures.
3. Open the deployed frontend in Chrome.
4. Clear `quantsage_chat_history` from LocalStorage before a clean AI Advisor run.
5. Start CDP network/console capture before submitting the prompt. Capture request URLs, response statuses, console/log entries, and summarized POST payload fields such as `model`, `max_tokens`, and message count. Do not record or store full prompts if they might contain secrets.
6. In AI Advisor, submit a short prompt such as:
   - `In one short sentence, confirm the QuantSage proxy deployment works.`
7. Required assertions:
   - A `QuantSage_Core` model response appears.
   - The response is not `Error: Terminal link failed. Please check connection and API key.`
   - No visible or console text includes `Missing Groq configuration`, `Missing VITE_GROQ`, or `Server missing GROQ_API_KEY`.
   - Browser network shows POST `https://<proxy-host>/api/groq/chat/completions` with HTTP `200`.
   - Browser network does not show direct requests to `https://api.groq.com/openai/v1/chat/completions`.
   - AI Advisor chat payload uses a bounded completion budget, currently `max_tokens: 1024`, not the higher visualizer analysis budget.
8. If Groq returns HTTP `429`, distinguish rate limiting from deployment wiring:
   - If the browser did POST to the proxy, the proxy wiring is present but the AI result still failed.
   - Wait for the reported/cooldown interval and retry once only after a minimal proxy request returns HTTP `200`.

## Reporting

- For GUI tests, record the focused browser interaction and annotate:
  - deployed page loaded,
  - prompt submitted,
  - model response rendered,
  - proxy network evidence captured.
- Include screenshots for before-submit and after-response states.
- Post one concise PR comment with assertions and CDP evidence. Include the Devin session link.
- If PR is still draft and CLI/browser GitHub auth is unavailable, report that the user must click **Ready for review** manually.
