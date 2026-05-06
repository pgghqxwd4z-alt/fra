---
name: testing-robot-trader
description: Test the QuantSage Robot Trader UI end-to-end. Use when verifying Robot Trader live quote, invalid symbol recovery, correction engine, or pause/resume changes.
---

# Robot Trader Testing

## Devin Secrets Needed

None for the core Robot Trader UI flow. The app path is local and unauthenticated; quote checks use public Binance and CoinGecko APIs.

## Local setup

1. Install dependencies if needed: `npm install`.
2. Run static checks before browser testing: `npm run lint` and `npm run build`.
3. Start the app with `npm run dev` and open `http://localhost:5173/` in Chrome.

## Browser flow

1. Click the left sidebar item labeled **Robot Trader**.
2. Confirm the heading reads **QuantSage Robot Trader**.
3. Wait for BTCUSDT to resolve. A valid run should show a dollar-formatted **Live Price**, a `%` **24h Change**, and a source line ending in either `via Binance 24h ticker` or `via CoinGecko simple price`.
4. Type `BADPAIR999` in the symbol input and press Enter. Confirm **Live Price** reads `Unavailable`, the recoverable quote error appears, and the button remains **Pause Bot**.
5. Type `ETHUSDT` and press Enter. Confirm the quote error disappears and live price/24h change return.
6. Click **Pause Bot**, then **Resume Bot**. Confirm the status pill changes to **Paused** and then exits Paused.

## Notes

- Binance may return HTTP 451 in some environments. This is expected in restricted locations; the Robot Trader should fall back to CoinGecko for mapped major symbols such as BTCUSDT and ETHUSDT.
- If both public APIs are unavailable, mark valid-symbol live-data checks as blocked/untested rather than passing them.
- Record browser testing with annotations when validating UI changes, and post one consolidated PR comment with assertions plus screenshots/recording.
