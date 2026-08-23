# QuantSage Testing

Use this skill when testing the QuantSage React/Vite trading UI in this repository.

## Devin Secrets Needed

- `GROQ_API_KEY`: Groq API key used only for local/API-backed validation. Write it to an ignored `.env.local` as `VITE_GROQ_API_KEY=<secret value>`; never commit or print the value.

## Local setup

1. From the repo root, run `npm install` if dependencies are not already installed.
2. Create/update ignored `.env.local` with `VITE_GROQ_API_KEY` sourced from the `GROQ_API_KEY` Devin secret.
3. Run `npm run dev -- --host 0.0.0.0` and open `http://localhost:5173/` in Chrome.
4. Before code-change PR completion, run `npm run lint` and `npm run build`.

## Useful test assets

- A synthetic chart PNG is sufficient for Visualizer testing. Use an image with visible candlesticks, order-block zones, FVG/liquidity labels, and clear price structure so generated annotations can be visually distinguished from the source chart.

## API-backed UI smoke flow

1. AI Advisor: send a short market query and verify a model response appears instead of the API-key failure text.
2. Deep Visualizer: upload the chart image, select exactly `SMC Mechanics` and `Goldman Sachs Strategy`, verify the button reads `Analyze (2)`, then run analysis.
3. Visualizer pass criteria:
   - processing overlay shows `Neural Scan Active` / `Multi-Lens AI Pipeline Processing`;
   - result shows chart annotations and `Hold for Original`;
   - `Neural Insights` includes both SMC/Smart Money and Goldman/GS content;
   - Stage 4 header `PROBABILISTIC ENTRY ANALYSIS — Institutional Synthesis` appears.
4. Strategy Hub: open the first `Launch Backtester`, run or re-run Monte Carlo, and verify `Probabilistic Equity Curve — 1,000 Simulations`, `Median`, `P10-P90 Band`, `Worst Case`, `Win Rate`, `Profit Factor`, `Expectancy`, `Total Trades`, `Avg Win`, `Avg Loss`, and `Final Equity Distribution (1,000 paths)`.
5. Persistence: reload, reopen the same backtester, and verify saved results return with `Re-run Simulation`.

## Caveats

- Stage 4 synthesis depends on another Groq call after individual lenses. It may be timing/API-sensitive; if individual lens output appears but the synthesis header is absent, wait 30-60 seconds and retry once, then report the missing header as a failed assertion if it repeats.
- Binance WebSocket or REST market-data calls might show CORS/network errors in browser console. Capture these logs separately; they do not necessarily block Groq chart analysis.
- Monte Carlo simulation can complete too quickly to visually capture the transient running-state text. Prefer asserting the final result and persistence unless specifically testing loading states.
