# Testing QuantSage

## Overview
QuantSage is an institutional trading intelligence platform built with React + TypeScript + Vite + Tailwind CSS. It uses Groq (Llama 3.3 70B for chat, Llama 3.2 90B Vision for chart analysis) as the AI backend.

## Devin Secrets Needed
- `GROQ_API_KEY` — Groq API key (starts with `gsk_...`). Free tier allows 30 requests/min.

## Local Dev Setup
```bash
cd /home/ubuntu/quantsage
npm install
npm run dev
# App runs at http://localhost:5173
```

## Build & Deploy
```bash
npm run build 2>&1  # Check for TypeScript errors
# Deploy using: deploy_frontend dir="/home/ubuntu/quantsage/dist"
```

## Key Testing Paths

### AI Advisor (Chat)
- Navigate: Click "AI Advisor" in left sidebar
- Search Grounding triggers on market keywords (BTC, ETH, crypto, trading, price, etc.)
- Console logs: `[Search Grounding] Found N results` confirms live data fetch
- Console logs: `[Orchestrator]` prefix shows pipeline health
- Loading indicator shows "SEARCHING LIVE SOURCES & PROCESSING..." when grounding is active

### Deep Visualizer (Chart Analysis)
- Navigate: Click "Deep Visualizer" in left sidebar
- Upload a chart image via drag-drop or click "Ingest Asset Data"
- Select lenses (SMC Protocol, Goldman Desk, Douglas/Schwager, Price Action)
- Click "Analyze (N)" to trigger analysis
- Neural Scan overlay appears during processing with: dual scan lines, grid pulse, corner brackets, dual spinner, ping indicators
- Analysis completes with annotations drawn on the chart canvas + text analysis in Neural Insights panel
- The 3-stage pipeline (primary analysis -> knowledge search -> validator) may take 15-30 seconds

### Strategy Hub (Monte Carlo Backtester)
- Navigate: Click "Strategy Hub" in left sidebar
- Click "Launch Backtester" on any strategy card (SMC, Goldman Desk, Price Action)
- Backtester panel appears with 4 sliders: Win Probability (30-85%), Reward:Risk (0.5-5R), Risk/Trade (0.25-5%), Sample Size (50-500)
- Click "Execute Monte Carlo" to run 1000 simulations
- Verify: Recharts equity curve with percentile bands, stat cards (Win Rate, Profit Factor, Expectancy, Sharpe, etc.), Final Equity Distribution
- Results auto-save to LocalStorage under key `quantsage_backtest_results`

### LocalStorage Persistence
- Chat history: `quantsage_chat_history` key
- Backtest results: `quantsage_backtest_results` key
- Test by reloading page and verifying data persists

## Known Issues / Gotchas
- Binance WebSocket may fail with 451 error in some deployment environments (CORS/geo-blocking) — this only affects the live ticker in the header, not core functionality
- Binance REST API calls for market data may be blocked by CORS in deployed environments — the search grounding (DuckDuckGo + CryptoCompare) still works
- Groq API has 30 req/min rate limit — the Pipeline Orchestrator handles this with delays between stages
- The API key might be hardcoded in `src/services/geminiService.ts` — check for `gsk_` if it needs to be rotated
- Neural Scan overlay requires both `neural-scan` and `neural-scan-reverse` CSS animations defined in the Visualizer component's `<style>` block

## Deployment
- Live URL pattern: `https://trading-strategies-app-cisyyi3q.devinapps.com`
- Deploy with: `deploy_frontend dir="/home/ubuntu/quantsage/dist"`
- No CI/CD configured on the GitHub repo
