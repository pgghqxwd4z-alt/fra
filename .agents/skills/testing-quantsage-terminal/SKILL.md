---
name: testing-quantsage-terminal
description: How to run and end-to-end test the QuantSage institutional forecast terminal (Express + Vite middleware + React 19 + Tailwind v4 + recharts 3), including working around the headless VM's lack of hover support and the app's overflow-hidden shell.
---

# Testing the QuantSage terminal

## Running the app

```bash
cd /home/ubuntu/repos/fra
npm install          # only if node_modules is missing
npm run dev          # = tsx server.ts, Express + Vite in middleware mode
```

- Serves on `http://localhost:3000`, binds `0.0.0.0`. There is no separate Vite port.
- `npm run lint` is `tsc --noEmit`. There is no unit test suite.

## Devin Secrets Needed

- `GEMINI_API_KEY` — read server-side in `server.ts`. Without it the server still
  starts and the SPA loads fine, but `POST /api/annotate` and `POST /api/chat`
  both return HTTP 500 `{"error":"GEMINI_API_KEY environment variable is not set."}`.
  Set it in a root `.env` or export it before `npm run dev` if you need to test the
  actual forecast/chat rendering paths (`ForecastResult` panel in `Visualizer.tsx`
  is only reachable with a working key).

Expected graceful-failure strings when the key is absent (useful as assertions):
- Chat: `Error: Terminal link failed. Please check connection.`
- Visualizer: browser `alert("Forecast engine failure. Check API logs.")`

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

## Critical gotcha: the app shell is entirely overflow-hidden

`App.tsx` wraps content in `flex h-screen ... overflow-hidden` → `main ... overflow-hidden`
→ `flex-1 relative overflow-hidden p-2`, and the inner `h-full w-full` div is
`overflow: visible`. **No ancestor is scrollable.** Any tab whose content is taller
than the viewport is permanently unreachable — mouse scrolling does nothing.

Verify quickly with a console walk of the ancestor chain comparing
`scrollHeight` vs `clientHeight` and checking whether any ancestor has
`overflow-y: auto|scroll`. Framework/Synthesis Workflow is ~3065px tall and only
steps 01–02 are reachable at a 1005px-tall viewport. Tabs that happen to fit
(Wisdom, Strategies) will clip the same way on shorter viewports, so always
check content height rather than trusting a single screenshot.

## localStorage keys worth clearing between runs

- `quantsage_backtest_history` — Backtester archive.
- `quantsage_chat_history` — chat transcript (persists across reloads, so a prior
  test's error bubble will still be there after F5; clear it if it confuses a test).

## Narrow-viewport / mobile sidebar

Chrome for Testing will not resize narrower than ~532 real px (≈500 CSS px here),
which is still below Tailwind's `sm`/`md` breakpoints, so it is adequate for
mobile checks. Resize with:

```bash
wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz
wmctrl -r :ACTIVE: -e 0,0,0,532,760
# restore:
wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
```

Note the sidebar is `position: fixed; z-index: 50` and the header toggle is
`z-index: 40`, with no backdrop and no in-sidebar close button — once opened at a
narrow width the sidebar may be impossible to close. Check `elementFromPoint` on
the toggle's center to prove whether it is occluded.

## Useful navigation coordinates (maximized, 1024x768 screenshot space)

Sidebar toggle `(23, 70)`; nav items: AI Advisor `(62, 117)`, Deep Visualizer
`(62, 144)`, Synthesis Workflow `(74, 171)`, Strategy Hub `(62, 198)`,
Wisdom Vault `(74, 225)`. Backtester modal: history/archive icon `(813, 117)`,
close `(846, 117)`. Re-screenshot after resizing since these shift.
