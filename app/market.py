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
YAHOO_SYMBOLS: dict[str, tuple[str, bool]] = {
    "XAU_USD": ("GC=F", True),
    "XAG_USD": ("SI=F", True),
    "EUR_USD": ("EURUSD=X", False),
    "GBP_USD": ("GBPUSD=X", False),
    "USD_JPY": ("USDJPY=X", False),
    "NAS100_USD": ("^NDX", False),
    "SPX500_USD": ("^GSPC", False),
}
TWELVEDATA_SYMBOLS = {
    "XAU_USD": "XAU/USD",
    "XAG_USD": "XAG/USD",
    "EUR_USD": "EUR/USD",
    "GBP_USD": "GBP/USD",
    "USD_JPY": "USD/JPY",
}
SUPPORTED_TIMEFRAMES = ("5m", "15m", "1h", "4h", "1d")
OHLCV_CANDLE_COUNT = 150
OANDA_INTERVALS = {"5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D"}
TWELVEDATA_INTERVALS = {"5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day"}
YAHOO_INTERVALS = {
    "5m": ("5m", "5d"),
    "15m": ("15m", "1mo"),
    "1h": ("60m", "3mo"),
    "1d": ("1d", "1y"),
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


@dataclass(frozen=True)
class OhlcvSeries:
    instrument: str
    timeframe: str
    source: str
    proxy: bool
    candles: list[Candle]
    context: str


def normalize_timeframe(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"[\s_-]", "", value.strip().lower())
    aliases = {
        "5m": "5m",
        "5min": "5m",
        "m5": "5m",
        "15m": "15m",
        "15min": "15m",
        "m15": "15m",
        "1h": "1h",
        "1hour": "1h",
        "h1": "1h",
        "4h": "4h",
        "4hour": "4h",
        "h4": "4h",
        "1d": "1d",
        "1day": "1d",
        "d1": "1d",
    }
    return aliases.get(normalized)


def _format_ohlcv_time(timestamp: str, timeframe: str) -> str:
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return timestamp[:10] if timeframe == "1d" else timestamp[:16].replace("T", " ")
    return parsed.strftime("%Y-%m-%d" if timeframe == "1d" else "%Y-%m-%d %H:%M")


def _build_ohlcv_context(
    instrument: str,
    timeframe: str,
    source_label: str,
    candles: list[Candle],
    proxy: bool = False,
) -> str:
    rows = "\n".join(
        f"{_format_ohlcv_time(candle.timestamp, timeframe)} | "
        f"{_format_number(candle.open)} {_format_number(candle.high)} "
        f"{_format_number(candle.low)} {_format_number(candle.close)}"
        for candle in candles
    )
    first = _format_ohlcv_time(candles[0].timestamp, timeframe)
    last = _format_ohlcv_time(candles[-1].timestamp, timeframe)
    high = max(candle.high for candle in candles)
    low = min(candle.low for candle in candles)
    proxy_note = "\nFeed note: futures proxy for spot; levels track the proxy, not spot." if proxy else ""
    return (
        f"REAL OHLCV DATA — {instrument} {timeframe} ({source_label}, {len(candles)} candles, oldest->newest)\n"
        "Columns: time | open high low close\n"
        f"{rows}\n"
        f"Window: {first} -> {last} | high {_format_number(high)} | "
        f"low {_format_number(low)} | last close {_format_number(candles[-1].close)}"
        f"{proxy_note}"
    )


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


def _build_context(
    instrument: str,
    as_of: str,
    m15: list[Candle],
    h1: list[Candle],
    source_label: str,
    verification: dict[str, Any],
    feed_note: str = "",
) -> MarketData:
    feed_note_line = f"{feed_note}\n" if feed_note else ""
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
        f"LIVE MARKET DATA ({source_label}, {instrument}, as of {as_of})\n"
        f"{feed_note_line}"
        f"Last close (M15): {_format_number(last_close)}\n"
        f"M15 window (last 24): high {_format_number(m15_high)} / low {_format_number(m15_low)}\n"
        f"H1 window (last 24): high {_format_number(h1_high)} / low {_format_number(h1_low)}\n"
        "Recent M15 candles (oldest->newest): time open high low close\n"
        f"{recent}"
    )
    return MarketData(context=context, verification=verification)


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
    return _build_context(
        instrument,
        as_of,
        candles["M15"],
        candles["H1"],
        "Oanda",
        {
            "source": "oanda",
            "instrument": instrument,
            "environment": environment,
            "lastClose": candles["M15"][-1].close,
            "asOf": as_of,
        },
    )


def _parse_yahoo_candles(payload: Any, interval: str, limit: int | None = 24) -> list[Candle]:
    if not isinstance(payload, dict):
        raise ValueError(f"Yahoo {interval} response was malformed.")
    chart = payload.get("chart")
    results = chart.get("result") if isinstance(chart, dict) else None
    result = results[0] if isinstance(results, list) and results else None
    timestamps = result.get("timestamp") if isinstance(result, dict) else None
    indicators = result.get("indicators") if isinstance(result, dict) else None
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes else None
    if (
        not isinstance(timestamps, list)
        or not isinstance(quote, dict)
        or any(not isinstance(quote.get(field), list) for field in ("open", "high", "low", "close"))
    ):
        raise ValueError(f"Yahoo {interval} response contained malformed candles.")

    candles: list[Candle] = []
    for index, timestamp in enumerate(timestamps):
        if not isinstance(timestamp, int) or isinstance(timestamp, bool):
            continue
        values = []
        for field in ("open", "high", "low", "close"):
            values_list = quote[field]
            if index >= len(values_list) or values_list[index] is None:
                values = []
                break
            try:
                number = float(values_list[index])
            except (TypeError, ValueError):
                values = []
                break
            if not math.isfinite(number):
                values = []
                break
            values.append(number)
        if len(values) != 4:
            continue
        try:
            timestamp_text = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError) as error:
            raise ValueError(f"Yahoo {interval} response contained an invalid timestamp.") from error
        candles.append(Candle(timestamp_text, *values))

    if limit is not None:
        candles = candles[-limit:]
    if len(candles) < 2:
        raise ValueError(f"Yahoo {interval} response contained fewer than two valid candles.")
    return candles


async def _request_yahoo_market_data(client: Any, instrument: str) -> MarketData:
    try:
        symbol, is_proxy = YAHOO_SYMBOLS[instrument]
    except KeyError as error:
        raise ValueError(f"No Yahoo Finance symbol is configured for {instrument}.") from error
    candles: dict[str, list[Candle]] = {}
    for interval, range_value in (("15m", "1d"), ("60m", "5d")):
        endpoint = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}"
        response = await client.get(
            endpoint,
            params={"interval": interval, "range": range_value},
            headers={"User-Agent": "Mozilla/5.0 (compatible; QuantSage/1.0)"},
        )
        response.raise_for_status()
        candles[interval] = _parse_yahoo_candles(response.json(), interval)
    as_of = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    last_close = candles["15m"][-1].close
    feed_note = (
        "Feed note: COMEX futures proxy for spot; basis versus spot can differ by a few percent."
        if is_proxy
        else ""
    )
    return _build_context(
        instrument,
        as_of,
        candles["15m"],
        candles["60m"],
        "Yahoo Finance delayed",
        {
            "source": "yahoo",
            "instrument": instrument,
            "symbol": symbol,
            "proxy": is_proxy,
            "lastClose": last_close,
            "asOf": as_of,
        },
        feed_note,
    )


def _parse_twelvedata_candles(payload: Any, interval: str) -> list[Candle]:
    if not isinstance(payload, dict) or payload.get("status") not in (None, "ok"):
        raise ValueError(f"Twelve Data {interval} response was not successful.")
    values = payload.get("values")
    if not isinstance(values, list) or not values:
        raise ValueError(f"Twelve Data {interval} response contained no values.")
    candles: list[Candle] = []
    for item in reversed(values):
        if not isinstance(item, dict):
            raise ValueError(f"Twelve Data {interval} response contained a malformed candle.")
        timestamp = item.get("datetime")
        if not isinstance(timestamp, str) or not timestamp:
            raise ValueError(f"Twelve Data {interval} candle contained an invalid time.")
        try:
            timestamp_text = (
                datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except ValueError as error:
            raise ValueError(f"Twelve Data {interval} candle contained an invalid time.") from error
        numbers: list[float] = []
        for field in ("open", "high", "low", "close"):
            try:
                number = float(item[field])
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(f"Twelve Data {interval} candle contained an invalid {field} value.") from error
            if not math.isfinite(number):
                raise ValueError(f"Twelve Data {interval} candle contained a non-finite {field} value.")
            numbers.append(number)
        candles.append(Candle(timestamp_text, *numbers))
    if len(candles) < 2:
        raise ValueError(f"Twelve Data {interval} response contained fewer than two valid candles.")
    return candles


async def _request_twelvedata_market_data(client: Any, instrument: str) -> MarketData:
    try:
        symbol = TWELVEDATA_SYMBOLS[instrument]
    except KeyError as error:
        raise ValueError(f"No Twelve Data symbol is configured for {instrument}.") from error
    candles: dict[str, list[Candle]] = {}
    for interval in ("15min", "1h"):
        response = await client.get(
            "https://api.twelvedata.com/time_series",
            params={
                "symbol": symbol,
                "interval": interval,
                "outputsize": 24,
                "timezone": "UTC",
                "format": "JSON",
                "apikey": os.environ["TWELVEDATA_API_KEY"],
            },
        )
        response.raise_for_status()
        candles[interval] = _parse_twelvedata_candles(response.json(), interval)
    as_of = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    last_close = candles["15min"][-1].close
    return _build_context(
        instrument,
        as_of,
        candles["15min"],
        candles["1h"],
        "Twelve Data",
        {
            "source": "twelvedata",
            "instrument": instrument,
            "symbol": symbol,
            "proxy": False,
            "lastClose": last_close,
            "asOf": as_of,
        },
    )


async def _request_ohlcv_oanda(
    client: Any,
    instrument: str,
    timeframe: str,
    environment: str,
) -> OhlcvSeries:
    granularity = OANDA_INTERVALS[timeframe]
    endpoint = f"https://{OANDA_HOSTS[environment]}/v3/instruments/{quote(instrument, safe='')}/candles"
    response = await client.get(
        endpoint,
        params={"granularity": granularity, "count": OHLCV_CANDLE_COUNT, "price": "M"},
        headers={"Authorization": f"Bearer {os.environ['OANDA_API_TOKEN']}"},
    )
    response.raise_for_status()
    candles = _parse_candles(response.json(), granularity)[-OHLCV_CANDLE_COUNT:]
    return OhlcvSeries(
        instrument,
        timeframe,
        "oanda",
        False,
        candles,
        _build_ohlcv_context(instrument, timeframe, "Oanda", candles),
    )


async def _request_ohlcv_twelvedata(
    client: Any,
    instrument: str,
    timeframe: str,
) -> OhlcvSeries:
    interval = TWELVEDATA_INTERVALS[timeframe]
    response = await client.get(
        "https://api.twelvedata.com/time_series",
        params={
            "symbol": TWELVEDATA_SYMBOLS[instrument],
            "interval": interval,
            "outputsize": OHLCV_CANDLE_COUNT,
            "timezone": "UTC",
            "format": "JSON",
            "apikey": os.environ["TWELVEDATA_API_KEY"],
        },
    )
    response.raise_for_status()
    candles = _parse_twelvedata_candles(response.json(), interval)[-OHLCV_CANDLE_COUNT:]
    return OhlcvSeries(
        instrument,
        timeframe,
        "twelvedata",
        False,
        candles,
        _build_ohlcv_context(instrument, timeframe, "Twelve Data", candles),
    )


async def _request_ohlcv_yahoo(
    client: Any,
    instrument: str,
    timeframe: str,
) -> OhlcvSeries:
    interval, range_value = YAHOO_INTERVALS[timeframe]
    symbol, proxy = YAHOO_SYMBOLS[instrument]
    endpoint = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}"
    response = await client.get(
        endpoint,
        params={"interval": interval, "range": range_value},
        headers={"User-Agent": "Mozilla/5.0 (compatible; QuantSage/1.0)"},
    )
    response.raise_for_status()
    candles = _parse_yahoo_candles(response.json(), interval, limit=None)[-OHLCV_CANDLE_COUNT:]
    return OhlcvSeries(
        instrument,
        timeframe,
        "yahoo",
        proxy,
        candles,
        _build_ohlcv_context(instrument, timeframe, "Yahoo Finance delayed", candles, proxy),
    )


async def fetch_ohlcv_series(instrument: str | None, timeframe: str | None) -> OhlcvSeries | None:
    if not instrument or not timeframe:
        return None
    normalized_timeframe = normalize_timeframe(timeframe)
    if not normalized_timeframe:
        return None

    oanda_token = os.getenv("OANDA_API_TOKEN", "").strip()
    if oanda_token and normalized_timeframe in OANDA_INTERVALS:
        environment = _environment()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_ohlcv_oanda(client, instrument, normalized_timeframe, environment)
        except Exception as error:
            logger.warning("Oanda OHLCV data failed (%s); trying the next configured feed.", error)

    twelvedata_key = os.getenv("TWELVEDATA_API_KEY", "").strip()
    if twelvedata_key and instrument in TWELVEDATA_SYMBOLS and normalized_timeframe in TWELVEDATA_INTERVALS:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_ohlcv_twelvedata(client, instrument, normalized_timeframe)
        except Exception as error:
            logger.warning("Twelve Data OHLCV data failed (%s); trying the next configured feed.", error)

    if os.getenv("MARKET_FALLBACK_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        return None
    if instrument not in YAHOO_SYMBOLS or normalized_timeframe not in YAHOO_INTERVALS:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            return await _request_ohlcv_yahoo(client, instrument, normalized_timeframe)
    except Exception as error:
        logger.warning("Yahoo Finance OHLCV data failed (%s).", error)
    return None


def _filter_history(candles: list[Candle], start: datetime, end: datetime) -> list[Candle]:
    start_utc = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_utc = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    filtered = []
    for candle in candles:
        try:
            timestamp = datetime.fromisoformat(candle.timestamp.replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            timestamp = timestamp.astimezone(timezone.utc)
        except ValueError:
            continue
        if start_utc < timestamp <= end_utc:
            filtered.append(candle)
    return filtered


async def _request_oanda_history(client: Any, instrument: str, start: datetime, end: datetime, environment: str) -> list[Candle]:
    endpoint = f"https://{OANDA_HOSTS[environment]}/v3/instruments/{quote(instrument, safe='')}/candles"
    response = await client.get(
        endpoint,
        params={
            "granularity": "M15",
            "price": "M",
            "from": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "to": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
        headers={"Authorization": f"Bearer {os.environ['OANDA_API_TOKEN']}"},
    )
    response.raise_for_status()
    return _filter_history(_parse_candles(response.json(), "M15"), start, end)


async def _request_twelvedata_history(client: Any, instrument: str, start: datetime, end: datetime) -> list[Candle]:
    symbol = TWELVEDATA_SYMBOLS[instrument]
    response = await client.get(
        "https://api.twelvedata.com/time_series",
        params={
            "symbol": symbol,
            "interval": "15min",
            "start_date": start.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "end_date": end.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "outputsize": 5000,
            "timezone": "UTC",
            "format": "JSON",
            "apikey": os.environ["TWELVEDATA_API_KEY"],
        },
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        raise ValueError("Twelve Data 15min response was not successful.")
    return _filter_history(_parse_twelvedata_candles(payload, "15min"), start, end)


async def _request_yahoo_history(client: Any, instrument: str, start: datetime, end: datetime) -> list[Candle]:
    symbol, _ = YAHOO_SYMBOLS[instrument]
    endpoint = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}"
    response = await client.get(
        endpoint,
        params={
            "interval": "15m",
            "period1": int(start.timestamp()),
            "period2": int(end.timestamp()),
        },
        headers={"User-Agent": "Mozilla/5.0 (compatible; QuantSage/1.0)"},
    )
    response.raise_for_status()
    return _filter_history(_parse_yahoo_candles(response.json(), "15m", limit=None), start, end)


async def fetch_history(instrument: str, start: datetime, end: datetime) -> list[Candle]:
    if not instrument:
        return []
    start_utc = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_utc = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    token = os.getenv("OANDA_API_TOKEN", "").strip()
    if token:
        environment = _environment()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_oanda_history(client, instrument, start_utc, end_utc, environment)
        except Exception as error:
            logger.warning("Oanda forecast history failed (%s); trying the next configured feed.", error)
    twelvedata_key = os.getenv("TWELVEDATA_API_KEY", "").strip()
    if twelvedata_key and instrument in TWELVEDATA_SYMBOLS:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_twelvedata_history(client, instrument, start_utc, end_utc)
        except Exception as error:
            logger.warning("Twelve Data forecast history failed (%s); trying Yahoo Finance.", error)
    if os.getenv("MARKET_FALLBACK_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        return []
    if instrument not in YAHOO_SYMBOLS:
        return []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            return await _request_yahoo_history(client, instrument, start_utc, end_utc)
    except Exception as error:
        logger.warning("Yahoo Finance forecast history failed (%s).", error)
        return []


async def fetch_market_data(instrument: str | None) -> MarketData | None:
    if not instrument:
        logger.warning("No supported Oanda instrument was found; continuing without live market data.")
        return None
    token = os.getenv("OANDA_API_TOKEN", "").strip()
    if token:
        environment_value = os.getenv("OANDA_ENVIRONMENT", "practice").strip().lower()
        if environment_value not in OANDA_HOSTS:
            logger.warning("Unknown OANDA_ENVIRONMENT=%r; using practice.", environment_value)
        environment = _environment()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_market_data(client, instrument, environment)
        except httpx.TimeoutException:
            logger.warning("Oanda market data request timed out; trying the next configured feed.")
        except httpx.HTTPStatusError as error:
            logger.warning("Oanda market data request returned HTTP %s; trying the next configured feed.", error.response.status_code)
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
            logger.warning("Oanda market data was unavailable or malformed (%s); trying the next configured feed.", error)
        except Exception as error:
            logger.warning("Oanda market data failed unexpectedly (%s); trying the next configured feed.", error)
    else:
        logger.warning("OANDA_API_TOKEN is not set; trying the next configured feed.")

    twelvedata_key = os.getenv("TWELVEDATA_API_KEY", "").strip()
    if twelvedata_key and instrument in TWELVEDATA_SYMBOLS:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                return await _request_twelvedata_market_data(client, instrument)
        except httpx.TimeoutException:
            logger.warning("Twelve Data market data request timed out; trying Yahoo Finance fallback.")
        except httpx.HTTPStatusError as error:
            logger.warning("Twelve Data market data request returned HTTP %s; trying Yahoo Finance fallback.", error.response.status_code)
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
            logger.warning("Twelve Data market data was unavailable or malformed (%s); trying Yahoo Finance fallback.", error)
        except Exception as error:
            logger.warning("Twelve Data market data failed unexpectedly (%s); trying Yahoo Finance fallback.", error)
    elif twelvedata_key:
        logger.warning("No Twelve Data symbol is configured for %s; trying Yahoo Finance fallback.", instrument)

    if os.getenv("MARKET_FALLBACK_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        logger.warning("Yahoo Finance market fallback is disabled; continuing without live market data.")
        return None
    if instrument not in YAHOO_SYMBOLS:
        logger.warning("No Yahoo Finance symbol is configured for %s; continuing without live market data.", instrument)
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            return await _request_yahoo_market_data(client, instrument)
    except httpx.TimeoutException:
        logger.warning("Yahoo Finance market data request timed out; continuing without live market data.")
    except httpx.HTTPStatusError as error:
        logger.warning("Yahoo Finance market data request returned HTTP %s; continuing without live market data.", error.response.status_code)
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
        logger.warning("Yahoo Finance market data was unavailable or malformed (%s); continuing without live market data.", error)
    except Exception as error:
        logger.warning("Yahoo Finance market data failed unexpectedly (%s); continuing without live market data.", error)
    return None
