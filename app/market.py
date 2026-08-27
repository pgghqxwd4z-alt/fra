from __future__ import annotations

import logging
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx


logger = logging.getLogger("quantsage")

OANDA_HOSTS = {
    "practice": "api-fxpractice.oanda.com",
    "live": "api-fxtrade.oanda.com",
}
INSTRUMENT_ALIASES = {
    "XAUUSD": "XAU_USD",
    "GOLD": "XAU_USD",
    "XAGUSD": "XAG_USD",
    "SILVER": "XAG_USD",
    "EURUSD": "EUR_USD",
    "GBPUSD": "GBP_USD",
    "USDJPY": "USD_JPY",
    "NAS100": "NAS100_USD",
    "US100": "NAS100_USD",
    "SPX500": "SPX500_USD",
    "US500": "SPX500_USD",
}


@dataclass(frozen=True)
class Candle:
    timestamp: str
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class MarketData:
    context: str
    verification: dict[str, Any]


def _instrument_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def resolve_instrument(explicit: Any, prompt: Any) -> str | None:
    if isinstance(explicit, str) and explicit.strip():
        value = explicit.strip().upper().replace("/", "_")
        alias = INSTRUMENT_ALIASES.get(_instrument_key(value))
        if alias:
            return alias
        if re.fullmatch(r"[A-Z0-9]+_[A-Z0-9]+", value):
            return value
        return None
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    key = _instrument_key(prompt)
    for alias, instrument in INSTRUMENT_ALIASES.items():
        if alias in key:
            return instrument
    return None


def _parse_candles(payload: Any, granularity: str) -> list[Candle]:
    if not isinstance(payload, dict) or not isinstance(payload.get("candles"), list):
        raise ValueError(f"Oanda {granularity} response did not contain candles.")
    candles: list[Candle] = []
    for item in payload["candles"]:
        if not isinstance(item, dict) or not isinstance(item.get("mid"), dict):
            raise ValueError(f"Oanda {granularity} response contained a malformed candle.")
        mid = item["mid"]
        values: list[float] = []
        for field in ("o", "h", "l", "c"):
            try:
                number = float(mid[field])
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(f"Oanda {granularity} candle contained an invalid {field} value.") from error
            if not math.isfinite(number):
                raise ValueError(f"Oanda {granularity} candle contained a non-finite {field} value.")
            values.append(number)
        timestamp = item.get("time")
        if not isinstance(timestamp, str) or not timestamp:
            raise ValueError(f"Oanda {granularity} candle contained an invalid time.")
        candles.append(Candle(timestamp, *values))
    if not candles:
        raise ValueError(f"Oanda {granularity} response contained no candles.")
    return candles


def _format_number(value: float) -> str:
    return f"{value:.10g}"


def _build_context(instrument: str, as_of: str, m15: list[Candle], h1: list[Candle]) -> MarketData:
    last_close = m15[-1].close
    m15_high = max(candle.high for candle in m15)
    m15_low = min(candle.low for candle in m15)
    h1_high = max(candle.high for candle in h1)
    h1_low = min(candle.low for candle in h1)
    recent = "\n".join(
        f"{candle.timestamp} {_format_number(candle.open)} {_format_number(candle.high)} "
        f"{_format_number(candle.low)} {_format_number(candle.close)}"
        for candle in m15[-12:]
    )
    context = (
        f"LIVE MARKET DATA (Oanda, {instrument}, as of {as_of})\n"
        f"Last close (M15): {_format_number(last_close)}\n"
        f"M15 window (last 24): high {_format_number(m15_high)} / low {_format_number(m15_low)}\n"
        f"H1 window (last 24): high {_format_number(h1_high)} / low {_format_number(h1_low)}\n"
        "Recent M15 candles (oldest->newest): time open high low close\n"
        f"{recent}"
    )
    return MarketData(
        context=context,
        verification={
            "source": "oanda",
            "instrument": instrument,
            "environment": _environment(),
            "lastClose": last_close,
            "asOf": as_of,
        },
    )


def _environment() -> str:
    value = os.getenv("OANDA_ENVIRONMENT", "practice").strip().lower()
    return value if value in OANDA_HOSTS else "practice"


async def _request_market_data(
    client: Any,
    instrument: str,
    environment: str,
) -> MarketData:
    endpoint = f"https://{OANDA_HOSTS[environment]}/v3/instruments/{quote(instrument, safe='')}/candles"
    candles: dict[str, list[Candle]] = {}
    for granularity in ("M15", "H1"):
        response = await client.get(
            endpoint,
            params={"granularity": granularity, "count": 24, "price": "M"},
            headers={"Authorization": f"Bearer {os.environ['OANDA_API_TOKEN']}"},
        )
        response.raise_for_status()
        candles[granularity] = _parse_candles(response.json(), granularity)
    as_of = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return _build_context(instrument, as_of, candles["M15"], candles["H1"])


async def fetch_market_data(explicit_instrument: Any, prompt: Any) -> MarketData | None:
    token = os.getenv("OANDA_API_TOKEN", "").strip()
    if not token:
        logger.warning("OANDA_API_TOKEN is not set; continuing without live market data.")
        return None
    instrument = resolve_instrument(explicit_instrument, prompt)
    if not instrument:
        logger.warning("No supported Oanda instrument was found; continuing without live market data.")
        return None
    environment_value = os.getenv("OANDA_ENVIRONMENT", "practice").strip().lower()
    if environment_value not in OANDA_HOSTS:
        logger.warning("Unknown OANDA_ENVIRONMENT=%r; using practice.", environment_value)
    environment = _environment()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            return await _request_market_data(client, instrument, environment)
    except httpx.TimeoutException:
        logger.warning("Oanda market data request timed out; continuing without live market data.")
    except httpx.HTTPStatusError as error:
        logger.warning("Oanda market data request returned HTTP %s; continuing without live market data.", error.response.status_code)
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
        logger.warning("Oanda market data was unavailable or malformed (%s); continuing without live market data.", error)
    return None
