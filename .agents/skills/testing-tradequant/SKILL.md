# TradeQuant Pro Testing

Use this skill when testing the TradeQuant Pro / QuantSage app in this repo.

## Devin Secrets Needed

- `GROQ_API_KEY` — server-side Groq key for AI/news/audit endpoints. Do not use `VITE_*` keys for public testing because Vite embeds them into browser bundles.

## Local setup

1. Install dependencies if needed:
   ```bash
   npm install
   ```
2. Run static checks before browser testing:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```
3. Start the server with an isolated auth database so first-user admin bootstrap is deterministic:
   ```bash
   TRADEQUANT_DATA_DIR="/home/ubuntu/repos/fra/test-artifacts/admin-e2e-data-$(date +%s)" \
   PORT=8791 \
   GROQ_API_KEY="$GROQ_API_KEY" \
   node server.mjs
   ```
4. Open `http://127.0.0.1:8791` in Chrome. If sharing a live preview, expose the port with Devin's `deploy expose` tool rather than sending localhost URLs.

## Admin access-control flow

- The first registered user becomes `admin` / `approved` automatically.
- Later registrations become `user` / `pending` and cannot sign in until approved.
- Use the `Admin` button in the header to open `Admin Control Center`.
- The admin panel can approve, deny, suspend, and toggle feature permissions for each user.
- User activity appears in `User Monitoring`; check it after status and permission changes.

## Assertions to prefer

For a focused admin runtime test, verify exact visible text and state changes:

- Auth gate shows `TradeQuant Access`, `Approval required`, and the first-user-admin explanation.
- First registration shows `Admin account created. You can sign in now.`
- Pending user login shows `Account pending admin approval`.
- After approval, the regular user can enter the `TradeQuant Pro` app.
- Disabling `Demo data` makes `Try Demo Data` visibly disabled and clicking it should not load transcript/dashboard content.
- Suspending a user blocks login with `Account suspended`.
- `User Monitoring` logs `admin.user_status` and `admin.permission` entries for admin actions.

## Notes

- If auth errors render as raw JSON, check the client error parsing in `src/services/authService.ts`.
- The app stores local auth data in `TRADEQUANT_DATA_DIR` or `.tradequant-data`; never commit auth data.
- Keep browser test recordings short and annotate each key assertion.