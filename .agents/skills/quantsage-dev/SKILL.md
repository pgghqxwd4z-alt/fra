# QuantSage Development & Testing

## Build & Deploy
- Build: `npm run build` from `/home/ubuntu/quantsage`
- Deploy frontend: use `deploy_frontend` tool with `dir="/home/ubuntu/quantsage/dist"`
- Live URL: `https://trading-strategies-app-cisyyi3q.devinapps.com`
- No CI/CD configured — no GitHub Actions workflows

## Project Structure
- Frontend: React + TypeScript + Vite + Tailwind CSS
- AI backend: Groq API (Llama models) — key stored via `VITE_GROQ_API_KEY` env var
- Main AI service: `src/services/geminiService.ts` (~1700 lines, handles all AI pipeline logic)
- Components: `src/components/` — Visualizer.tsx, Backtester.tsx, TradingSage.tsx, etc.

## Testing the Deep Visualizer
1. Navigate to the live URL
2. Click "Deep Visualizer" in the left sidebar
3. Click the upload area to select a chart image (test chart at `/home/ubuntu/quantsage/test-chart.png`)
4. Select lenses (SMC Protocol, Goldman Desk, Douglas/Schwager, Price Action)
5. Click the green "Analyze" button
6. Wait ~30s for the 3-stage pipeline to complete
7. Verify: annotations drawn on chart + analysis text in right panel
8. Check browser console for `[Orchestrator]` logs — look for `Pipeline complete. Status: healthy`

## Annotation Pipeline Architecture
- 3-stage per lens: Primary Analyst → Knowledge Search → Validator
- Each lens iteration wrapped in try/catch for resilience
- Groq free tier: 30 requests/min. Each full lens = 3 API calls.
- CORS blocks Binance market data fetch in browser — this is expected and handled gracefully
- If rate limited, fallback annotations are generated instead of crashing

## Common Issues
- "Annotation engine failure" alert: Usually rate limiting. Check console for `[Orchestrator]` logs.
- Binance WebSocket 451 errors in console: Expected — some regions block Binance. Does not affect core functionality.
- CORS errors on Binance REST API: Expected in browser context. Market data fetch degrades gracefully.

## Git Workflow
- Feature branch: `devin/1774187184-quantsage-sage33-features`
- PR: `pgghqxwd4z-alt/fra#1`
- Copy updated files from `/home/ubuntu/quantsage/src/` to `/home/ubuntu/fra-repo/src/` before committing
