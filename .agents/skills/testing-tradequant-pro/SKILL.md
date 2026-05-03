# TradeQuant Pro Testing

## Purpose

Use this skill when testing the TradeQuant Pro app in this repository, especially the admin access-control flow or Groq-backed AI/news/chart audit features.

## Devin Secrets Needed

- `GROQ_API_KEY` — required for `/api/analyze-chat`, `/api/analyze-image`, and `/api/synthesize-audit`. The news calendar endpoint uses the public Forex Factory feed, but the AI audit flows need Groq.

## Local Setup

1. Install dependencies if needed:
   ```bash
   npm install
   ```
2. Start the full app through the Node server so `/api/*` routes work:
   ```bash
   GROQ_API_KEY=$GROQ_API_KEY npm run serve
   ```
3. Open the app in Chrome at `http://127.0.0.1:8787/` unless the server logs show a different port.
4. If you need a clean admin/user state, start with a separate data directory:
   ```bash
   TRADEQUANT_DATA_DIR=/home/ubuntu/tradequant-test-data GROQ_API_KEY=$GROQ_API_KEY npm run serve
   ```
   The first registered account becomes the admin; later registrations remain pending until approved.

## AI Detection Browser Test Flow

1. Sign in as an approved admin or approved user with `demoData`, `newsTerminal`, `transcriptAudit`, and `chartUpload` permissions.
2. From the landing screen, click `Try Demo Data`. This reveals the tab bar; the News tab is not visible on the empty landing screen.
3. Open `News Terminal` and verify `Forex Factory Calendar` renders live event cards with currency codes and source links.
4. Open `Transcript`, verify `Raw Transcript Log` shows `8 messages parsed`, then click `Audit Messages`.
5. Verify the audit renders `SESSION MACRO AUDIT`, `Discipline Rating:`, `Macro Impact Analysis`, and `Grounding Matrix` without a red AI error banner.
6. Upload a realistic chart image through `Bulk Import`; wait for the spinner to disappear.
7. Verify the Charts view shows AI objects and chart analysis such as `Strategic Briefing`, `Discipline Rating:`, and macro impact cards.

## Admin Access-Control Browser Test Flow

1. With a clean data directory, register the first user and confirm the success message indicates the admin account was created.
2. Register a second user and confirm login is blocked with `Account pending admin approval`.
3. Sign in as admin, open `Admin Control Center`, approve the second user, and verify the activity log records the status change.
4. Toggle a feature permission such as `Demo data`, sign in as the regular user, and confirm the corresponding UI control is disabled.
5. Suspend the regular user and confirm login is blocked with `Account suspended`.

## Notes

- Do not build a static-only frontend for public testing unless a separate backend/proxy is deployed; static deployments cannot serve `/api/*` Groq routes.
- Do not set `VITE_GROQ_API_KEY` for public builds because Vite embeds `VITE_*` values into the browser bundle.
- A Recharts width/height warning can appear in Chrome console during dashboard rendering; treat it as unrelated unless chart rendering breaks visually.
