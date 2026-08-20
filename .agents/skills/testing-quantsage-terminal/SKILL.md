---
name: testing-quantsage-terminal
description: How to run and end-to-end test the QuantSage institutional forecast terminal (Express + Vite middleware + React 19 + Tailwind v4 + recharts 3), including the OpenAI provider setup, the headless VM's lack of hover support, and known field-mapping pitfalls in the forecast panel.
---

# Testing the QuantSage terminal

## Running the app

```bash
cd /home/ubuntu/repos/fra
npm install                  # only if node_modules is missing
npm run dev                  # = tsx server.ts, Express + Vite in middleware mode, port 3000
PORT=3100 npx tsx server.ts  # server reads process.env.PORT — use this to avoid clobbering
                             # an instance someone else is already running / tunnelling
```

- Binds `0.0.0.0`. There is no separate Vite port.
- `npm run lint` is `tsc --noEmit`. There is no unit test suite.
- A harmless `WebSocket server error: Port 24678 is already in use` appears when a
  second instance starts (Vite HMR socket). It does not affect serving.
- Production layout: `vite build --outDir dist/client`; Express serves only `dist/client`.

## Devin Secrets Needed

- `OPENAI_API_KEY` — read server-side in `server.ts` (loaded from a root `.env` via
  dotenv). Optional `OPENAI_MODEL`, default `gpt-4o`. Startup logs `[OpenAI] model=...`.
- Without it the server still starts and the SPA loads, but `POST /api/annotate`,
  `POST /api/chat` and `POST /api/knowledge/search` return HTTP 500
  `{"error":"OPENAI_API_KEY environment variable is not set."}`.

Graceful-failure strings when the key is absent (useful as assertions):
- Chat: `Error: Terminal link failed. Please check connection.`
- Visualizer: browser `alert("Forecast engine failure. Check API logs.")`

Gemini was fully removed (commit `add0ea8`); `geminiModelResolver.ts` is gone and
`src/services/geminiService.ts` → `src/services/aiService.ts` with export
`geminiService` → `aiService`.

## API timings and shapes (for planning waits)

- `POST /api/chat` ≈ 5–10s. Returns `{ text, grounding }`.
- `POST /api/annotate` ≈ 10–30s. Returns `{ analysis, forecast, knowledge }`.
  It makes **three** OpenAI calls (web search + structured knowledge pass, then the
  vision forecast), so it is slow — allow 60s+ before calling it hung.

## Known field-mapping pitfalls in the forecast panel

Confirmed against the live API — check these explicitly, they are easy to miss:

- **`confidence`**: the model returns a 0–1 fraction (e.g. `0.7`) but
  `Visualizer.tsx` renders `{forecast.confidence}% CONF`. Since `8b83ce9` the
  server normalises it to an integer 0–100, so the panel should print `70%`.
  Verify what the panel actually prints, not just that a number appeared — a
  regression here shows up as `0.7% CONF`.
- **`analysis` is `result.output_text`**, which under strict `json_schema`
  structured output is the raw JSON string. The "Neural Insights" panel renders it
  verbatim, so it displays a raw JSON dump rather than prose.
- Fields the server returns that the **UI never renders**: `currentState`,
  `retracement.{expected,zone,reason}`, `structuralEvidence[]`,
  `liquidityTarget.reason`, and the entire `knowledge` payload (dropped in
  `aiService.ts`'s `AnnotateResponse`).
- `entry.confirmation` appears **only** in the fullscreen forecast modal
  (expand icon in the Forecast panel header).
- The fullscreen modal in turn omits `liquidityTarget`, `invalidation`,
  `primaryScenario`, `alternativeScenario` and `warnings`.
- `knowledge.items` is usually `[]` because `safeSourceUrl` drops any URL outside a
  small per-book domain allowlist; expect a warning string instead. Not user-visible.

## Always test chat with at least TWO messages (history request shape)

A single message can pass while the feature is broken. `TradingSage.tsx` seeds the
transcript with a `role: 'model'` welcome bubble and sends the whole transcript back
as `history`, and the OpenAI Responses API only accepts `output_text` / `refusal`
content for `role: "assistant"` turns — mapping assistant turns to `input_text`
(the original port did) makes every UI request fail with HTTP 500 and the UI shows
`Error: Terminal link failed. Please check connection.`:

```
400 Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.
```

Fixed in `8b83ce9` (content type chosen per role). A `history: []` probe (e.g. plain
curl) returns 200 either way, which is why this is easy to miss — always reproduce
through the UI with a follow-up message.

## Chat text is rendered as plain text, not Markdown

`TradingSage.tsx` prints `msg.content` directly, so OpenAI's Markdown leaks verbatim
into the bubble: literal `**bold**` asterisks and `([domain](url))` inline links.
Raw hosted-tool citation markers spelled `citeturn0finance0` (with private-use-area
delimiter glyphs that render as tofu boxes) used to leak too; `8b83ce9` strips them
server-side, so their reappearance is a regression. The emerald grounding chips
render fine alongside this. Assert on the bubble text, not just on the chip.

## Chat grounding

`/api/chat` passes the hosted `web_search` tool and maps `url_citation`
annotations into `{ web: { uri, title } }`; `TradingSage.tsx` renders them as
emerald link chips under the message.

Grounding is **prompt-dependent, not dead** — a generic question ("what is the next
move on BTC?") returns `grounding: []` and no chips, while a prompt that clearly
needs current information ("search the web for today's date and the latest Bitcoin
spot price, and cite your sources") reliably returns 3+ citations. Always probe with
a current-information prompt before concluding grounding is broken.

## Critical gotcha: hover-only controls are invisible in this VM

This headless environment reports `matchMedia('(hover: hover)').matches === false`.
Tailwind v4 compiles `hover:` / `group-hover:` utilities inside
`@media (hover: hover)`, so **any control revealed only on hover never becomes
visible**, even when the element genuinely matches `:hover`.

Known affected controls:
- `Visualizer.tsx` zoom/reset toolbar (`opacity-0 group-hover:opacity-100`).
- `Backtester.tsx` archive-card delete/trash button (same pattern).

Workarounds that do work:
- The buttons are still in the DOM and `opacity: 0` elements still receive clicks —
  compute the element's rect and click its coordinates directly. For the trash
  icon this is `absolute top-4 right-4` of the history card.
- Zoom/pan can be exercised without the toolbar: use `scroll` over the image for
  wheel zoom, and `mouse_move` → `left_mouse_down` (no coordinate arg!) →
  `mouse_move` → `left_mouse_up` for drag-pan.
- Do not "fix" this in product code during testing; report it as a real
  touch-device/UX risk instead.

`left_mouse_down` rejects a `coordinate` argument — move the mouse first, then press.

## App shell scrolling and sidebar (fixed in 39dd0af — previously broken)

Commit `39dd0af` fixed two blockers found in earlier testing. Expect them to work now:
- `App.tsx` content wrapper is `flex-1 relative overflow-y-auto p-2` (was
  `overflow-hidden`), so tall tabs like Framework/Synthesis Workflow (~3000px) now
  scroll and all 6 steps are reachable.
- `Sidebar.tsx` is always mounted and slides via `-translate-x-full`, and gained a
  `lg:hidden` backdrop (`fixed inset-0 z-40 bg-black/60`), an `aria-label="Close
  sidebar"` X button, and auto-close on nav when `window.innerWidth < 1024`.

If a regression is suspected, verify by walking the ancestor chain comparing
`scrollHeight` vs `clientHeight` and checking for `overflow-y: auto|scroll`, and use
`elementFromPoint` on the header toggle's center to prove whether it is occluded.

## localStorage keys worth clearing between runs

- `quantsage_backtest_history` — Backtester archive.
- `quantsage_chat_history` — chat transcript (persists across reloads, so a prior
  test's error bubble will still be there after F5; clear it if it confuses a test).

## Narrow-viewport / mobile sidebar

Chrome for Testing will not resize narrower than ~532 real px (≈500 CSS px here),
which is still below Tailwind's `lg` (1024px) breakpoint that gates the mobile
sidebar behavior, so it is adequate for mobile checks. Resize with:

```bash
wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz
wmctrl -r :ACTIVE: -e 0,0,0,532,760
# restore:
wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
```

## Generating a candlestick chart for the Visualizer

matplotlib is available. Build OHLC bars as wick lines plus body rectangles on a
dark background and label swing-high/swing-low liquidity lines — the model reads
those labels and returns a far richer forecast than it does for a plain line chart.
A working generator lives at `/tmp/gen_chart.py` during a session; ~1540x880 PNG.

## Useful navigation coordinates (maximized, 1024x768 screenshot space)

Sidebar toggle `(23, 70)`; nav items: AI Advisor `(62, 117)`, Deep Visualizer
`(62, 144)`, Synthesis Workflow `(74, 171)`, Strategy Hub `(62, 198)`,
Wisdom Vault `(74, 225)`. Backtester modal: history/archive icon `(813, 117)`,
close `(846, 117)`. Re-screenshot after resizing since these shift.
