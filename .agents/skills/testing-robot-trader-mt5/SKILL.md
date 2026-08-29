---
name: testing-robot-trader-mt5
description: Test QuantSage Robot Trader's supervised MT5 bridge flow. Use when verifying MT5 dry-run/live bridge UI gating, manual approval, kill switch, and backend safety validation.
---

# Robot Trader MT5 Testing

## Devin Secrets Needed

- `MT5_ACCOUNT_LOGIN` — MT5 account login for live bridge testing.
- `MT5_SERVER` — MT5 broker server name for live bridge testing.
- `MT5_PASSWORD` — MT5 trading password for live bridge testing.

Live broker execution should stay untested unless these secrets are available, `MT5_DRY_RUN=false` is intentionally set, and a reachable MT5 terminal/bridge is running. Prefer a dedicated low-balance account or subaccount with broker-side risk limits.

## Local Dry-Run Setup

1. Install dependencies if needed:
   ```bash
   npm install
   python3 -m venv mt5-bridge/.venv
   mt5-bridge/.venv/bin/pip install -r mt5-bridge/requirements.txt
   ```
2. Start the MT5 bridge in dry-run mode:
   ```bash
   cd mt5-bridge
   MT5_DRY_RUN=true .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8787
   ```
3. Start the Vite app with the bridge URL configured:
   ```bash
   VITE_MT5_BRIDGE_URL=http://127.0.0.1:8787 npm run dev -- --host 127.0.0.1
   ```
4. Open `http://localhost:5173/` in Chrome. Use `localhost`, not `127.0.0.1`, unless `ALLOWED_ORIGINS` is changed; the bridge default CORS origin is `http://localhost:5173`.

## UI Assertions

- Click **Robot Trader** in the sidebar.
- Confirm the page header reads **QuantSage Robot Trader** and the live trade state reaches **Armed** with **Verified** market data.
- Scroll to **Supervised MT5 Live Execution**.
- Before approval, confirm the status pill reads **Dry Run**, bridge status says orders validate but are not sent to a broker, and the button reads **Execution Blocked**.
- Check **Manual approval** and confirm the button changes to **Approve & Send MT5 Ticket**.
- Check **Kill switch** and confirm the status pill reads **Kill Switch On** and the button returns to **Execution Blocked**.
- Turn kill switch off, submit, and confirm bridge status contains `Order validated only. MT5_DRY_RUN=true` plus a `DRY-` ticket ID; manual approval should reset unchecked.

## Backend Safety Spot Checks

Use direct requests only for bridge safety checks, not for browser-authenticated app flows. In dry-run mode, verify:

- `manualApproval: false` returns HTTP 400 with `Manual approval is required before live execution.`
- `riskPercent` above `MAX_RISK_PERCENT` returns HTTP 400 with `Risk percent exceeds MAX_RISK_PERCENT.`
- A valid approved order returns HTTP 200 with `status: "dry_run"` and a `DRY-` ticket ID.

## Known Testing Notes

- Binance may be blocked from Devin VMs; Robot Trader can still satisfy live quote preconditions through the CoinGecko fallback for supported symbols.
- On Linux, the official `MetaTrader5` Python package typically requires a running MT5 terminal elsewhere (often Windows). Treat Linux sessions as dry-run bridge tests unless a separate live bridge/terminal is provided.
