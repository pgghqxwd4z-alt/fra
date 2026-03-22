# QuantSage Testing & Development

## App Overview
QuantSage is a React+Vite institutional trading intelligence platform deployed at https://trading-strategies-app-cisyyi3q.devinapps.com

## Local Development
- Source: `/home/ubuntu/quantsage`
- Git repo: `/home/ubuntu/fra-repo`
- Build: `cd /home/ubuntu/quantsage && npm run build`
- Dev server: `cd /home/ubuntu/quantsage && npm run dev`
- Deploy: Use the `deploy` tool with `frontend` command pointing to `/home/ubuntu/quantsage/dist`

## Key Files
- `src/components/Visualizer.tsx` — Deep Visualizer UI, lens buttons, legend items, canvas annotations
- `src/services/geminiService.ts` — All AI lens prompts, 3-stage pipeline (Primary → Knowledge → Validator), annotation parsing, validation rules
- `src/components/TradingSage.tsx` — AI Advisor chat
- `src/components/Backtester.tsx` — Strategy Hub backtester
- `src/components/KnowledgeBase.tsx` — Wisdom Vault

## AI Pipeline Architecture
- Uses Groq API (free tier, 30 req/min limit)
- 3-stage pipeline per lens: Primary analysis → Knowledge search → Validator correction
- Pipeline Orchestrator manages rate limiting with inter-lens delays (5s default)
- Console logs prefixed with `[Orchestrator]` show pipeline execution in real-time
- If primary vision model fails, falls back to text-only model (llama-3.1-8b-instant)

## 5 Analysis Lenses (in workflow order)
1. **Douglas/Schwager Axis** (psych) — rose color — Legend: Accepting Randomness, Risk-First Mentality, Outcome Detachment
2. **Goldman Sachs Strategy** (gs) — sky blue — Legend: Inter-market Flow, Liquidity Voids, Macro Divergence
3. **SMC Mechanics** (smc) — emerald — Legend: Order Blocks, FVG Imbalances, Institutional Flow
4. **Pure Price Action** (ppa) — amber — Legend: LTF Confirmation, CHoCH/BOS, Candlestick Triggers
5. **Inst. Synthesis** (isyn) — violet — Legend: Confluence Zone, Inst. Entry, Inst. Exit, Execution Tier

## Testing the Deep Visualizer
1. Navigate to the deployed URL and click Deep Visualizer (eye icon, 2nd in sidebar)
2. Upload a chart image (test charts at `/home/ubuntu/btc_chart.png` or `/home/ubuntu/test_chart.png`)
3. Select one or more lenses, then click Analyze
4. Analysis takes 30-60s per lens due to 3-stage pipeline + rate limit delays
5. Open browser DevTools (F12) to monitor `[Orchestrator]` console logs
6. Verify: annotations appear on chart, analysis text in Neural Insights panel, legend matches selected lens

## Common Issues
- **"Annotation engine failure"**: Usually rate limiting — wait 60s and retry, or check console for specific error
- **"Failed to fetch"**: Network timeout on Groq API — the fallback text model should kick in automatically
- **Rate limiting (429)**: Free tier allows 30 req/min. Multi-lens analysis with 3-stage pipeline uses 3 calls per lens
- **Build errors when adding new lens**: Must update the lens type union in BOTH `Visualizer.tsx` (AnalysisLens type) AND `geminiService.ts` (ChartAnnotation.lens field)

## Environment
- Groq API key stored as secret (starts with `gsk_`)
- Vite env var: `VITE_GROQ_API_KEY`
- Must rebuild and redeploy after any code changes
