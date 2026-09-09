---
name: testing-quantsage-terminal
description: How to run and end-to-end test the QuantSage institutional forecast terminal (FastAPI/Express + Vite + React 19 + Tailwind v4 + recharts 3), including OpenAI provider setup, testing the deployed Render service behind Basic Auth, verifying the live market feed (Oanda/Twelve Data/Yahoo), the headless VM's lack of hover support, and known field-mapping pitfalls in the forecast panel.
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

## Running the FastAPI backend locally (current layout)

The repo has moved to a Python backend; `package.json` scripts are the source of truth:

```bash
cd /home/ubuntu/repos/fra
npm install && uv sync            # only if node_modules / .venv missing
npm run build                     # vite build --outDir dist/client  (~2s)
# single-port production-style serve: FastAPI serves dist/client AND /api
env -u APP_PASSWORD AI_PROVIDER=claude PORT=3100 \
  uv run uvicorn app.main:app --no-proxy-headers --host 0.0.0.0 --port 3100 2>&1 | tee /tmp/qs_server.log
```

- `npm run dev` (= `scripts/dev.sh`) instead runs uvicorn on `BACKEND_PORT` (8000) plus a
  separate Vite dev server — two ports. Prefer `build` + single-port uvicorn for testing;
  it matches production and avoids HMR noise.
- **Start the server in a persistent shell session (`shell_id`).** Backgrounding it with
  `nohup ... &` from a one-shot shell silently dies — you get no process and no log file.
- **`tee` the server output to a file.** Provider-side diagnostics are logged server-side
  only and are invisible in the browser (e.g. the Claude JSON-retry excerpts below).
- **Unset `APP_PASSWORD` locally** (`env -u APP_PASSWORD`) to disable HTTP Basic auth and
  sidestep the credentialed-URL problem entirely. The server logs
  `APP_PASSWORD is not set; HTTP Basic auth is disabled.`

### Local API keys are split between two places

`.env` holds only `OPENAI_API_KEY` / `OPENAI_MODEL`; `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`GROQ_API_KEY`, `TWELVEDATA_API_KEY`, `APP_PASSWORD` come from the **shell environment**.
So always launch the server from a shell that has them exported, or the three-engine
consensus silently degrades. Verify registration before testing:

```bash
uv run python -c "
from dotenv import load_dotenv; load_dotenv()
from app.providers import AIProvider
p=AIProvider()
print({e: p.has_engine(e) for e in ['openai','claude','gemini','groq']})"
```

(plain `python3` lacks `dotenv` — it is only in the `uv` venv.)

### Workaround when one provider's credits are exhausted

An exhausted `OPENAI_API_KEY` (`429 insufficient_quota / credit_balance_exhausted`) can
block **far more than the OpenAI engine**. In `app/main.py:annotate`, market data and
research are fault-tolerant (`asyncio.gather(..., return_exceptions=True)`) but
`knowledge = await retrieve_knowledge_with_library(...)` is not — it sits bare in the main
`try`, and `retrieve_knowledge` uses the OpenAI `web_search` tool, so a provider 429 makes
the entire `/api/annotate` return 500: no forecast, no consensus strip, no risk row, no
Track Record row. `/api/knowledge/search` 500s for the same reason.

Mitigation without touching code: `AI_PROVIDER` accepts `openai|groq|claude|gemini`
(`app/providers.py`) and selects the provider used for knowledge retrieval, research and
chat. Claude and Gemini have their own web-search tools, so `AI_PROVIDER=claude` restores
those paths. Combine with `CONSENSUS_ENGINES=claude,gemini` for a clean 2-engine consensus,
or leave `CONSENSUS_ENGINES` at its default `openai,claude,gemini` to make the dead engine
render as a real `consensus.failures` row (useful live failure-path evidence).
Note a 2-engine run can never prove `vote.total: 3` — report that as untested.

### Env defaults that matter locally

- `MARKET_FALLBACK_ENABLED` and `MARKET_RESEARCH_ENABLED` both default to `"1"`, so the
  Yahoo fallback and the research pass are **ON** locally with no extra config.
- `CONSENSUS_ENABLED` defaults on; `CONSENSUS_ENGINES` defaults to `openai,claude,gemini`.
- `GROQ_SCAN_ENABLED` is unset by default, so the "Fast scan (preliminary — not part of
  consensus)" line does **not** render even though the groq engine registers. Set it only
  when that line is what you are testing.

## Local knowledge library (`app/library.py`) — verify expectations offline first

`search_library(prompt, lenses, limit=4)` is pure and deterministic, so compute the
expected result set in-process before driving the UI:

```bash
uv run python -c "
from app.library import search_library
print([h['id'] for h in search_library('order blocks and fair value gaps', ['smc'])])"
```

Scoring is `(lens_tag_matches * 5) + prompt_token_overlap`, positive score required, ties
broken by entry id. **Trap:** every entry in `app/library/smc-pdf.json` carries the `smc`
tag and `LENS_TAGS['smc']` contains `"smc"`, so with the SMC lens on (the UI default)
*every* entry scores >= 5 from the lens alone and a totally unrelated prompt still returns
4 SMC entries. Zero hits require **no lens selected**, which `KnowledgeBase.tsx` disables
(Search is disabled when `!lenses.length`). Expect "unrelated query returns no padded
local entries" to fail until scoring is changed, and note the same padding reaches the
forecast prompt via `/api/annotate`.

Also: local hits surface only if the *web* search succeeds first, because
`merge_local_knowledge()` runs after `provider.retrieve_knowledge()`. A local-only
degraded result set is therefore NOT what happens on provider failure — you get a 500.

## Claude JSON-retry diagnostics are server-side only

`app/providers.py` logs, via `logger = logging.getLogger("quantsage.providers")`:

- `Claude initial JSON parse failed at offset <n>: <±150 char excerpt>` then **one** retry
  appending *"Return JSON only. Escape all quotes inside string values..."*; a second
  failure logs the same line with `retry` and raises
  `claude returned malformed JSON after retry`.
- `Claude <initial|retry> response truncated at max_tokens; excerpt: <last 300 chars>` when
  `stop_reason == "max_tokens"`.

The browser only ever shows `⚠ claude: <error>` in the consensus strip, so grep the teed
server log for `Claude .* JSON parse failed` to get the only evidence of the real cause.

## Testing the deployed Render service (instead of a local dev server)

The app is also deployed to a permanent Render service (e.g.
`https://quantsage-35oq.onrender.com`) behind HTTP Basic Auth. Prefer this when the
change under test depends on server env vars (market-feed API keys) that are only set
on Render.

- **Never put `user:pass@` in the URL.** Chrome then refuses the app's own
  `fetch('/api/annotate')` with *"Request cannot be constructed from a URL that
  includes credentials"*. Navigate to the bare URL and type the credentials into
  Chrome's native Basic Auth dialog instead.
- Free plan: the first request can take 30–60s to wake the service.
- Confirm which commit is actually deployed before trusting results (the deployed
  bundle can lag the branch).

## Verifying the live market feed (`app/market.py`)

Feed order is Oanda → Twelve Data → Yahoo, gated on `OANDA_API_TOKEN` /
`TWELVEDATA_API_KEY`. The forecast panel renders, inline (tiny `text-[7px]`) and in
the fullscreen modal (`text-xs`):

```
Verified vs Twelve Data XAU_USD · last 4430.3348 · 06:59 UTC
```

How to test this so a silent fallback cannot pass:

- The instrument is resolved from the **prompt text only**, never the image
  (`resolve_instrument`). So the sharpest test is an A/B on the *same uploaded image*:
  one prompt naming `XAUUSD`, one saying just `analyze this chart`. The second must
  produce a full forecast with **no** `marketVerification`/`marketResearch` keys and no
  `Verified vs` / `Research:` lines.
- **Providers are distinguishable by price**: Twelve Data returns spot `XAU/USD`
  (`proxy: false`), Yahoo returns `GC=F` COMEX **futures** and must be labelled
  `(proxy)`. These differ by ~1%, so fetch both independently at test time and check
  which number the UI shows — a Yahoo fallback mislabelled as Twelve Data would
  otherwise look fine.
- Cross-check the displayed price against a third source (investing.com XAU/USD) so the
  claim "plausible live spot" is evidence-backed rather than eyeballed.
- Generate the test chart at **current** price levels. A chart drawn at stale levels
  trips the prompt's 0.5% stale-chart rule and caps confidence at 40, which muddies
  unrelated assertions. `/home/ubuntu/testdata/gen_gold_chart.py` takes a start price.

Past defect, **fixed in `98c7fea`**: `marketResearch.upcomingEvents[].whenUtc` used to
come back as a literal `2026-09-01T??:??:??Z`, so the Research line rendered unparseable
question marks. `app/providers.py::_normalize_utc_time` now coerces server-side to a full
ISO `Z` string, a date-only string, or `""`; `Visualizer.tsx` then renders
`whenUtc || 'time TBC'`. Re-verified at runtime (`2026-09-08T01:30:00Z`). It is a cheap
regression check worth repeating: assert the rendered Research line contains no `?`, and
assert the same on the raw payload, since the original failure originated server-side and
would otherwise be masked by the `time TBC` fallback.

Headline objects use `publishedAt` (not `publishedUtc`) — reading the wrong key returns
`null` and looks like a data defect when it is not.

## Capturing API fields the UI does not print

`verification.source` / `proxy` / `symbol`, raw `confidence`, and event `importance`
are not all rendered. Install a `fetch` wrapper before acting so the payload can be
asserted on afterwards:

```js
window.__netLog = [];
const of = window.fetch;
window.fetch = async (...a) => {
  const r = await of(...a);
  if (String(a[0]).includes('/api/')) {
    window.__netLog.push({ url: String(a[0]), status: r.status });
    r.clone().json().then(j => { window.__lastAnnotate = j; }).catch(() => {});
  }
  return r;
};
```

Reset `window.__lastAnnotate = null` between runs so a stale payload cannot be mistaken
for a fresh one. Screenshot coordinates are scaled relative to CSS pixels — if a click
misses (e.g. the fullscreen expand icon), read the element's `getBoundingClientRect()`
and convert rather than guessing.

## Track Record tab (`src/components/TrackRecord.tsx`, `app/forecast_log.py`)

SQLite-backed, `GET /api/forecasts` + `POST /api/forecasts/score`. Third sidebar item,
after Deep Visualizer.

**The test order is forced by the code, not a preference.** When `forecasts.length === 0`
the empty state (`no forecasts logged yet — run an analysis on a recognised instrument`)
*replaces the entire page* — the Refresh button, both warnings and all four panels do not
exist while empty. So capture the empty state **first**, then run an analysis, because the
analysis destroys it. `FORECAST_DB_DURABLE=0` on Render means a redeploy wipes the DB, so
the empty state is genuinely reachable on a fresh deploy (confirm with
`curl .../api/forecasts` → `forecasts: []`).

A row is only logged when the **prompt text** names a recognised instrument (the image is
never parsed). Status is `pending` only if all of: live feed reference price,
`entry.direction` ∈ {BUY, SELL}, numeric TP1, numeric invalidation — otherwise
`unscorable` with a reason rendered beneath the status. Levels are parsed out of free
prose and must fall within ±25% of the reference.

To reliably get a **scorable `pending`** row rather than `unscorable / no directional
entry` (a bare "forecast the next move" prompt often yields `direction: "WAIT"`), ask
explicitly for the direction and numeric levels:

> `Instrument: XAUUSD (spot gold), H1 timeframe. Forecast the most likely next price move. State the directional bias, entry direction (BUY or SELL), the entry zone, and explicit numeric price levels for TP1, TP2, final target and invalidation.`

That produced `XAU_USD / BEARISH / 55% / TP1 4420 / invalidation 4450 / pending`, with
TP1 and invalidation correctly parsed out of prose (`"A sustained break above 4450
would invalidate..."` → `4450`).

Expect with a single forecast: `Hit rate — · 0 resolved forecasts`, `sample: 0` (only
*resolved* rows count toward the sample, so both the "too small" and ephemeral warnings
show), and `Calibration` / `By instrument` / `By bias` rendering **headings with empty
bodies** and no placeholder text. That is not a crash. `POST /api/forecasts/score`
returns `{scored, pending, skipped}` — all zeros for a fresh row is normal, since
nothing has reached its horizon (`horizonHours: 48`).

## Devin Secrets Needed

- `OPENAI_API_KEY` — read server-side (loaded from a root `.env` via dotenv).
  Optional `OPENAI_MODEL`, default `gpt-4o`.
- `APP_PASSWORD` (+ `APP_USERNAME`, typically `user`) — Basic Auth gate on the
  deployed service.
- `TWELVEDATA_API_KEY` — enables the spot market feed. `OANDA_API_TOKEN` takes
  priority if set. `MARKET_RESEARCH_ENABLED=1` / `MARKET_FALLBACK_ENABLED=1` toggle
  the research pass and the Yahoo fallback. These are set on Render, not locally —
  which is why feed testing must target the deployed service.
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

## Chat Markdown rendering

Chat bubbles previously printed `msg.content` as plain text, leaking literal `**bold**`
asterisks, `([domain](url))` links, and raw hosted-tool citation markers spelled
`citeturn0finance0` (private-use-area delimiters that render as tofu boxes). As of
`0903ed5` Markdown is rendered properly (headings, lists, bold, inline links) and the
markers are stripped server-side — their reappearance is a regression, so assert on the
bubble text and not just on the chips.

**Markdown tables** were fixed in `98c7fea` — `remarkPlugins={[remarkGfm]}` plus
`[&_th]:border [&_td]:border` cell borders and `overflow-x-auto` on the bubble. Verified
rendering real `<table>/<thead>/<th>/<td>` at runtime. The discriminator vs the old build
is structural, so assert on it rather than on looks: the pre-gfm build produced **zero**
`<table>` elements and a text node full of `|`.

A reliable table-producing prompt:
`compare XAUUSD, EURUSD and NAS100 in a markdown table with columns instrument, typical daily range, main session`

That 3-column table *fits* the bubble, so it does **not** exercise the overflow path. To
test scrolling you must force a genuinely wide table — ask a follow-up adding ~6 more
columns (`average spread, typical stop distance, best entry window, correlated
instrument, liquidity profile, typical weekly range`). Observed at a 500px CSS viewport:
bubble `clientWidth` 358 vs table `scrollWidth` 560, bubble scrolls, and
`document.documentElement.scrollWidth` stays 500 — i.e. containment works. Note
`[&_table]:w-full` means a wide table may *shrink to fit* instead of scrolling; both are
acceptable as long as the page gains no horizontal scrollbar, so measure and report
which actually happens instead of assuming.

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

## Typing long prompts into the Visualizer textarea drops characters

A single long `type` action into the `Directives...` textarea silently loses characters
(observed `H1` → `1` and `Give` → `ive`). This matters because instrument resolution
reads the prompt — a mangled `XAUUSD` means no market verification and no Track Record
row, which looks like a product bug. Type in ~30-character chunks (several `type` actions
in one call) and **always verify the textarea's `text=` attribute in the returned DOM
before clicking Analyze**.

## The `browser_console` tool needs explicit `console.log`

A bare trailing expression evaluates to `undefined` in the returned result. Wrap every
value you want to see in `console.log(...)`, and remember the tool only returns logs
produced by *your* script unless you call it again with no argument.

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
