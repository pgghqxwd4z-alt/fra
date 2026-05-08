import os
import time
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="QuantSage MT5 Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

kill_switch_enabled = os.environ.get("MT5_KILL_SWITCH", "false").lower() == "true"


class AccountStatus(BaseModel):
    connected: bool
    dryRun: bool
    server: str | None
    account: str | None
    killSwitchEnabled: bool
    maxRiskPercent: float
    maxLotSize: float


class OrderTicket(BaseModel):
    symbol: str = Field(min_length=3, max_length=20)
    direction: Literal["BUY", "SELL"]
    volume: float = Field(gt=0)
    entry: float = Field(gt=0)
    stopLoss: float = Field(gt=0)
    takeProfit: float = Field(gt=0)
    riskPercent: float = Field(gt=0)
    manualApproval: bool
    comment: str = Field(default="QuantSage supervised order", max_length=120)


class OrderResponse(BaseModel):
    accepted: bool
    status: Literal["dry_run", "submitted"]
    ticketId: str
    message: str


def float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def allowed_symbols() -> set[str]:
    raw_symbols = os.environ.get(
        "MT5_ALLOWED_SYMBOLS",
        "EURUSD,GBPUSD,XAUUSD,BTCUSD,BTCUSDT,ETHUSD,ETHUSDT",
    )
    return {symbol.strip().upper() for symbol in raw_symbols.split(",") if symbol.strip()}


def dry_run_enabled() -> bool:
    return os.environ.get("MT5_DRY_RUN", "true").lower() != "false"


def validate_order(ticket: OrderTicket) -> None:
    if kill_switch_enabled:
        raise HTTPException(status_code=423, detail="MT5 bridge kill switch is enabled.")
    if not ticket.manualApproval:
        raise HTTPException(status_code=400, detail="Manual approval is required before live execution.")
    if ticket.symbol.upper() not in allowed_symbols():
        raise HTTPException(status_code=400, detail="Symbol is not in MT5_ALLOWED_SYMBOLS.")
    if ticket.riskPercent > float_env("MAX_RISK_PERCENT", 0.75):
        raise HTTPException(status_code=400, detail="Risk percent exceeds MAX_RISK_PERCENT.")
    if ticket.volume > float_env("MAX_LOT_SIZE", 0.1):
        raise HTTPException(status_code=400, detail="Volume exceeds MAX_LOT_SIZE.")
    if ticket.direction == "BUY" and not ticket.stopLoss < ticket.entry < ticket.takeProfit:
        raise HTTPException(status_code=400, detail="BUY order requires stopLoss < entry < takeProfit.")
    if ticket.direction == "SELL" and not ticket.takeProfit < ticket.entry < ticket.stopLoss:
        raise HTTPException(status_code=400, detail="SELL order requires takeProfit < entry < stopLoss.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/account", response_model=AccountStatus)
def account() -> AccountStatus:
    login = os.environ.get("MT5_ACCOUNT_LOGIN")
    server = os.environ.get("MT5_SERVER")
    password = os.environ.get("MT5_PASSWORD")
    connected = bool(login and server and password) and not dry_run_enabled()
    return AccountStatus(
        connected=connected,
        dryRun=dry_run_enabled(),
        server=server,
        account=login,
        killSwitchEnabled=kill_switch_enabled,
        maxRiskPercent=float_env("MAX_RISK_PERCENT", 0.75),
        maxLotSize=float_env("MAX_LOT_SIZE", 0.1),
    )


@app.post("/orders", response_model=OrderResponse)
def create_order(ticket: OrderTicket) -> OrderResponse:
    validate_order(ticket)

    if dry_run_enabled():
        return OrderResponse(
            accepted=True,
            status="dry_run",
            ticketId=f"DRY-{int(time.time())}",
            message="Order validated only. MT5_DRY_RUN=true, so nothing was sent to a broker.",
        )

    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="MetaTrader5 package is not installed on this host.") from exc

    login = os.environ.get("MT5_ACCOUNT_LOGIN")
    password = os.environ.get("MT5_PASSWORD")
    server = os.environ.get("MT5_SERVER")
    if not login or not password or not server:
        raise HTTPException(status_code=503, detail="MT5 credentials are not configured.")

    initialized = mt5.initialize(login=int(login), password=password, server=server)
    if not initialized:
        raise HTTPException(status_code=503, detail=f"MT5 initialize failed: {mt5.last_error()}")

    order_type = mt5.ORDER_TYPE_BUY if ticket.direction == "BUY" else mt5.ORDER_TYPE_SELL
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": ticket.symbol.upper(),
        "volume": ticket.volume,
        "type": order_type,
        "price": ticket.entry,
        "sl": ticket.stopLoss,
        "tp": ticket.takeProfit,
        "deviation": int(os.environ.get("MT5_MAX_DEVIATION", "20")),
        "magic": int(os.environ.get("MT5_MAGIC_NUMBER", "20260508")),
        "comment": ticket.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(request)
    mt5.shutdown()

    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(status_code=502, detail=f"MT5 order rejected: {result}")

    return OrderResponse(
        accepted=True,
        status="submitted",
        ticketId=str(result.order),
        message="Order submitted to MT5 after manual approval.",
    )
