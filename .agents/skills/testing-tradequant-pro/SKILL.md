# Testing TradeQuant Pro

## Devin Secrets Needed

- `GEMINI_API_KEY` (or `API_KEY`): required for successful Gemini-backed news, chat, image, and synthesis audit endpoints. If absent, verify that the server returns the explicit missing-key error instead of silently succeeding.

## Local Setup

1. Install dependencies from the repo root:
   ```bash
   npm install
   ```
2. Start the production-like local server:
   ```bash
   npm run serve
   ```
3. Open Chrome to `http://127.0.0.1:8787/`.

## Useful Checks

- TypeScript: `npm run typecheck`
- Production build: `npm run build`
- API missing-key check:
  ```bash
  curl -i -X POST http://127.0.0.1:8787/api/news-calendar \
    -H 'Content-Type: application/json' \
    -d '{}'
  ```
  Without `GEMINI_API_KEY`/`API_KEY`, expect HTTP `500` and JSON containing `Missing API_KEY or GEMINI_API_KEY environment variable`.

## Primary Runtime Flow

1. Confirm the landing page shows `Forex Factory Awareness.` and a `Try Demo Data` button.
2. Click `Try Demo Data`.
3. Confirm the tab bar appears with `Dashboard`, `News Terminal`, and `Transcript`.
4. Confirm dashboard cards include `Visual Assets` with value `0` and `Engine Load` with value `Idle`.
5. Click `Transcript`.
6. Confirm the transcript panel title is `Raw Transcript Log`, the subtitle is `8 messages parsed`, and `Chief Analyst` appears in the parsed messages.
7. Click `Reset Audit Context`, confirm the browser dialog, and verify the app returns to the empty landing page.

## Notes

- If a Gemini key is available, additionally refresh `News Terminal` and verify event cards render with time, currency, title, and impact marker.
- Browser testing should be recorded with annotations for the landing state, demo dashboard state, transcript assertions, and reset assertion.
