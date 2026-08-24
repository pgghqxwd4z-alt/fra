# TradeQuant Pro Testing

Use this skill when testing the TradeQuant Pro React/Node app in this repo.

## Setup

- Install dependencies with `npm install`.
- Required secret for AI tests: `GROQ_API_KEY`.
- Start the full app with `GROQ_API_KEY=$GROQ_API_KEY npm run serve` from the repo root. The server listens on port `8787` and serves both static frontend assets and `/api/*` routes.
- Expose the running app with the Devin deploy expose tool on port `8787` when the user needs a public URL.
- The exposed tunnel uses basic auth. If testing through a URL with embedded `user:password@...` credentials, verify frontend API calls still work; the app strips credentials from fetch URLs and forwards the basic auth header.

## Auth/admin data

- Local auth data lives in `.tradequant-data/auth.json`.
- The first registered user becomes admin automatically. Later registrations are `pending` until approved by an admin.
- For controlled tests, register a temporary user through `/api/auth/register`, then promote it in `.tradequant-data/auth.json` to:
  - `role: "admin"`
  - `status: "approved"`
  - all permissions true: `demoData`, `newsTerminal`, `transcriptAudit`, `chartUpload`, `masterAudit`
- Do not commit `.tradequant-data/` or temporary screenshots/test images.

## Checks

Run before pushing code changes:

```bash
npm run typecheck
npm run build
npm run lint
```

## Browser test paths

### Admin/access

1. Register first admin or use a prepared approved admin.
2. Register a second user and confirm pending login shows `Account pending admin approval`.
3. Approve/suspend/toggle permissions in Admin Control Center.
4. Confirm restricted users see clean messages like `Account suspended` and disabled feature controls.

### AI detection

1. Sign in as an approved user with `newsTerminal`, `transcriptAudit`, and `chartUpload` permissions.
2. Click `Try Demo Data`.
3. Verify News Terminal renders `Forex Factory Calendar` with event cards.
4. Run `Audit Messages` and verify `SESSION MACRO AUDIT`, `Discipline Rating:`, and macro impacts render.
5. Upload a chart image and verify chart analysis completes without `Chart AI detection failed`.

### Chart annotation coverage

1. Sign in as approved admin.
2. Click `Bulk Import` / `Bulk Import Files` and upload a chart screenshot.
3. Wait for the Charts view to finish analysis.
4. Verify `Audit Objects` count is greater than the old model-only visual detection count (previously `3` in testing).
5. Verify visible numbered overlays appear directly on the chart.
6. Verify the side panel includes annotation sources from `Visual detection`, `Grounding Matrix`, `Macro Impact`, and `Suggested Action`.
7. Hover a derived item such as `Action 1`; the matching chart overlay should highlight and the bottom insight card should show the same number, source, and insight text.
