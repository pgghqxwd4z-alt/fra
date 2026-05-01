# QuantSage Runtime Testing

Use this skill when testing QuantSage UI/runtime behavior in this repository.

## Devin Secrets Needed

- `GROQ_API_KEY` or a local `.env.local` value for `VITE_GROQ_API_KEY` is required for AI Advisor and Deep Visualizer Groq-backed flows.
- Do not print or commit real Groq keys. Keep them in `.env.local` or Devin secrets only.

## Local setup

1. Install dependencies from the repo root:
   ```bash
   npm install
   ```
2. Ensure `.env.local` contains:
   ```bash
   VITE_GROQ_API_KEY=<secret>
   ```
3. Run the app locally:
   ```bash
   npm run dev -- --host 0.0.0.0
   ```
4. Open Chrome to `http://localhost:5173/`.

## Standard checks

Before or after runtime testing, use the project scripts:

```bash
npm run lint
npm run build
```

The build may emit a Vite large chunk-size warning; that is not necessarily a failure.

## Deep Visualizer runtime flow

Use the UI rather than direct API calls:

1. Open `Deep Visualizer` from the sidebar.
2. Upload a chart image via the `Ingest Asset Data` dropzone.
3. Keep `SMC Mechanics` selected by default and add `Goldman Sachs Strategy`.
4. Confirm the button reads `Analyze (2)`.
5. Use a prompt like:
   ```text
   BTC/USDT institutional confluence analysis with live pivot levels
   ```
6. Click `Analyze (2)` and wait for completion.
7. Verify the chart annotations render and `Neural Insights` includes both SMC and Goldman/GS-style analysis.

## Evidence to collect

For browser testing, start a screen recording after setup is complete and annotate:

- market feed rendered,
- chart uploaded,
- two lenses selected,
- processing state,
- final analysis / degraded skip behavior.

Use Chrome CDP at `http://localhost:29229` to collect network/console evidence when needed. Useful assertions:

- Market feed should connect to `wss://data-stream.binance.vision/stream?streams=...`.
- Visualizer live market data should request `https://data-api.binance.vision/api/v3/ticker/24hr?...` and/or `https://data-api.binance.vision/api/v3/klines?...`.
- There should be no old Binance REST/CORS signature for `https://api.binance.com/api/v3`.
- There should be no old WebSocket signature for `stream.binance.com:9443/ws`.
- There should be no `data.s`/`TypeError` from the market feed handler.
- There should be no `R1: NaN`, `S1: NaN`, or raw `NaN` in analysis output or console evidence.

## Groq rate-limit behavior

Groq can become rate-limited or degraded during multi-lens runs. If this happens, the Stage 4 synthesis may be intentionally skipped.

Valid outcomes for a two-lens run:

- Healthy path: console logs `Stage 4: Probabilistic Entry Analysis` and output includes `PROBABILISTIC ENTRY ANALYSIS — Institutional Synthesis`.
- Degraded path: console logs `Skipping Probabilistic Entry Analysis — API status is degraded` and individual lens analyses still render.

Do not mark healthy Stage 4 synthesis as passed unless the synthesis section is actually visible or the relevant console/output evidence is captured. If Groq remains degraded after a cooldown retry, report healthy synthesis as untested and explicitly note that degraded gating was verified.
