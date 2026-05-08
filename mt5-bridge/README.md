# QuantSage MT5 Bridge

This bridge is the server-side contract for connecting QuantSage Robot Trader to MetaTrader 5.

## Safety model

- Live orders require manual approval from the UI.
- The bridge rejects requests unless `manualApproval` is `true`.
- A global kill switch can disable order submission immediately.
- Risk caps are enforced before an order reaches MT5:
  - `MAX_RISK_PERCENT` defaults to `0.75`
  - `MAX_LOT_SIZE` defaults to `0.1`
  - stop loss and take profit are required

## Environment

```bash
MT5_ACCOUNT_LOGIN=12345678
MT5_SERVER=YourBroker-Real
MT5_PASSWORD=your-password
MT5_DRY_RUN=true
MAX_RISK_PERCENT=0.75
MAX_LOT_SIZE=0.1
MT5_ALLOWED_SYMBOLS=EURUSD,GBPUSD,XAUUSD,BTCUSD,BTCUSDT,ETHUSD,ETHUSDT
```

`MT5_DRY_RUN=true` is the default and returns accepted order tickets without sending to a broker. Set `MT5_DRY_RUN=false` only when a real MT5 terminal/bridge is configured and supervised.

## Run locally

```bash
cd mt5-bridge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8787
```

Then set the frontend environment variable:

```bash
VITE_MT5_BRIDGE_URL=http://127.0.0.1:8787
```

## Linux note

The official MetaTrader5 Python package needs a running MetaTrader 5 terminal, typically on Windows. On Linux, use this bridge in dry-run mode, or point it at a Windows-hosted MT5 bridge/terminal before enabling real live execution.
