from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import market


logger = logging.getLogger("quantsage")

LEVEL_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
STATUSES = {"pending", "tp1", "tp2", "final", "invalidated", "ambiguous", "expired", "unscorable"}


def _enabled() -> bool:
    return os.getenv("FORECAST_LOG_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def _db_path() -> Path:
    return Path(os.getenv("FORECAST_DB_PATH", "data/forecasts.db"))


def _durable() -> bool:
    return os.getenv("FORECAST_DB_DURABLE", "0").strip().lower() in {"1", "true", "yes"}


def _horizon_hours() -> int:
    try:
        return max(1, int(os.getenv("FORECAST_HORIZON_HOURS", "48")))
    except ValueError:
        return 48


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _open_db() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(f"PRAGMA synchronous={'FULL' if _durable() else 'NORMAL'}")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS forecasts (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            instrument TEXT NOT NULL,
            bias TEXT NOT NULL,
            direction TEXT NOT NULL,
            confidence INTEGER NOT NULL,
            reference_price REAL,
            feed_source TEXT,
            feed_proxy INTEGER NOT NULL DEFAULT 0,
            tp1 REAL,
            tp2 REAL,
            final_target REAL,
            invalidation REAL,
            status TEXT NOT NULL,
            unscorable_reason TEXT,
            resolved_at TEXT,
            resolved_price REAL,
            max_favorable REAL,
            max_adverse REAL,
            scored_at TEXT
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS forecasts_status_created ON forecasts (status, created_at)")
    connection.commit()
    return connection


def extract_level(text: str, reference: float) -> float | None:
    if not isinstance(text, str) or not math.isfinite(reference):
        return None
    lower = reference * 0.75
    upper = reference * 1.25
    for candidate in LEVEL_RE.findall(text):
        try:
            value = float(candidate.replace(",", ""))
        except ValueError:
            continue
        if lower <= value <= upper:
            return value
    return None


def _forecast_values(forecast: dict[str, Any], verification: dict[str, Any] | None) -> dict[str, Any]:
    entry = forecast.get("entry") if isinstance(forecast.get("entry"), dict) else {}
    targets = forecast.get("targets") if isinstance(forecast.get("targets"), dict) else {}
    direction = entry.get("direction") if isinstance(entry.get("direction"), str) else ""
    bias = forecast.get("bias") if isinstance(forecast.get("bias"), str) else "NEUTRAL"
    try:
        confidence = int(round(float(forecast.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0
    confidence = max(0, min(100, confidence))
    raw_reference = verification.get("lastClose") if isinstance(verification, dict) else None
    try:
        reference = float(raw_reference)
    except (TypeError, ValueError):
        reference = None
    if reference is not None and not math.isfinite(reference):
        reference = None
    tp1 = extract_level(targets.get("tp1", ""), reference) if reference is not None else None
    tp2 = extract_level(targets.get("tp2", ""), reference) if reference is not None else None
    final_target = extract_level(targets.get("final", ""), reference) if reference is not None else None
    invalidation = extract_level(forecast.get("invalidation", ""), reference) if reference is not None else None
    return {
        "bias": bias,
        "direction": direction,
        "confidence": confidence,
        "reference": reference,
        "feed_source": verification.get("source") if isinstance(verification, dict) else None,
        "feed_proxy": bool(verification.get("proxy")) if isinstance(verification, dict) else False,
        "tp1": tp1,
        "tp2": tp2,
        "final_target": final_target,
        "invalidation": invalidation,
    }


def record_forecast(
    forecast: dict[str, Any],
    instrument: str | None,
    verification: dict[str, Any] | None,
) -> str | None:
    if not _enabled() or instrument is None:
        return None
    values = _forecast_values(forecast, verification)
    if values["reference"] is None:
        status = "unscorable"
        reason = "no live market feed reference price"
    elif values["direction"] not in {"BUY", "SELL"}:
        status = "unscorable"
        reason = "no directional entry"
    elif values["tp1"] is None:
        status = "unscorable"
        reason = "no numeric TP1"
    elif values["invalidation"] is None:
        status = "unscorable"
        reason = "no numeric invalidation"
    else:
        status = "pending"
        reason = None
    row_id = uuid.uuid4().hex
    created_at = _iso(_utc_now())
    connection = _open_db()
    try:
        connection.execute(
            """
            INSERT INTO forecasts (
                id, created_at, instrument, bias, direction, confidence,
                reference_price, feed_source, feed_proxy, tp1, tp2, final_target,
                invalidation, status, unscorable_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                created_at,
                instrument,
                values["bias"],
                values["direction"],
                values["confidence"],
                values["reference"],
                values["feed_source"],
                int(values["feed_proxy"]),
                values["tp1"],
                values["tp2"],
                values["final_target"],
                values["invalidation"],
                status,
                reason,
            ),
        )
        connection.commit()
    finally:
        connection.close()
    return row_id


def _pending_rows(cutoff: str, limit: int) -> list[dict[str, Any]]:
    connection = _open_db()
    try:
        cursor = connection.execute(
            """
            SELECT id, created_at, instrument, direction, reference_price, tp1,
                   tp2, final_target, invalidation
            FROM forecasts
            WHERE status = 'pending' AND created_at <= ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (cutoff, limit),
        )
        columns = [description[0] for description in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        connection.close()


def _update_score(row_id: str, values: dict[str, Any]) -> None:
    connection = _open_db()
    try:
        connection.execute(
            """
            UPDATE forecasts
            SET status = ?, resolved_at = ?, resolved_price = ?,
                max_favorable = ?, max_adverse = ?, scored_at = ?,
                unscorable_reason = ?
            WHERE id = ? AND status = 'pending'
            """,
            (
                values["status"],
                values.get("resolved_at"),
                values.get("resolved_price"),
                values.get("max_favorable"),
                values.get("max_adverse"),
                values["scored_at"],
                values.get("unscorable_reason"),
                row_id,
            ),
        )
        connection.commit()
    finally:
        connection.close()


def _candle_time(timestamp: str) -> datetime:
    return _parse_timestamp(timestamp)


def _score_candles(row: dict[str, Any], candles: list[market.Candle], now: datetime) -> dict[str, Any] | None:
    created_at = _parse_timestamp(row["created_at"])
    horizon = created_at + timedelta(hours=_horizon_hours())
    end = min(now, horizon)
    filtered = [
        candle
        for candle in candles
        if created_at < _candle_time(candle.timestamp) <= end
    ]
    if not filtered:
        if candles and now >= horizon:
            return {
                "status": "expired",
                "resolved_at": None,
                "resolved_price": None,
                "max_favorable": 0.0,
                "max_adverse": 0.0,
                "scored_at": _iso(now),
            }
        return None
    reference = float(row["reference_price"])
    direction = row["direction"]
    tp1 = row["tp1"]
    tp2 = row["tp2"]
    final_target = row["final_target"]
    invalidation = row["invalidation"]
    best_status = None
    resolved_at = None
    resolved_price = None
    max_favorable = 0.0
    max_adverse = 0.0
    for candle in filtered:
        if direction == "BUY":
            max_favorable = max(max_favorable, candle.high - reference, 0.0)
            max_adverse = max(max_adverse, reference - candle.low, 0.0)
            target_levels = (
                ("tp1", tp1, candle.high >= tp1),
                ("tp2", tp2, tp2 is not None and candle.high >= tp2),
                ("final", final_target, final_target is not None and candle.high >= final_target),
            )
            invalidated = candle.low <= invalidation
        else:
            max_favorable = max(max_favorable, reference - candle.low, 0.0)
            max_adverse = max(max_adverse, candle.high - reference, 0.0)
            target_levels = (
                ("tp1", tp1, candle.low <= tp1),
                ("tp2", tp2, tp2 is not None and candle.low <= tp2),
                ("final", final_target, final_target is not None and candle.low <= final_target),
            )
            invalidated = candle.high >= invalidation
        touched = [name for name, _, hit in target_levels if hit]
        if best_status is None:
            if invalidated and "tp1" in touched:
                best_status = "ambiguous"
                resolved_at = candle.timestamp
                resolved_price = candle.close
                break
            if invalidated:
                best_status = "invalidated"
                resolved_at = candle.timestamp
                resolved_price = candle.close
                break
            if touched:
                best_status = touched[-1]
                resolved_at = candle.timestamp
                resolved_price = candle.close
                continue
        else:
            if invalidated:
                break
            status_order = {"tp1": 1, "tp2": 2, "final": 3}
            for status in touched:
                if status_order[status] > status_order[best_status]:
                    best_status = status
    if best_status is None:
        if now >= horizon:
            best_status = "expired"
        else:
            return None
    return {
        "status": best_status,
        "resolved_at": resolved_at,
        "resolved_price": resolved_price,
        "max_favorable": max_favorable,
        "max_adverse": max_adverse,
        "scored_at": _iso(now),
        "unscorable_reason": None,
    }


async def score_pending(limit: int = 20, now: datetime | None = None) -> dict[str, int]:
    current = now.astimezone(timezone.utc) if now and now.tzinfo else (now or _utc_now()).replace(tzinfo=timezone.utc)
    current = current.replace(microsecond=0)
    cutoff = _iso(current - timedelta(minutes=15))
    rows = await asyncio.to_thread(_pending_rows, cutoff, max(0, limit))
    scored = 0
    pending = 0
    skipped = 0
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["instrument"], []).append(row)
    for instrument, instrument_rows in grouped.items():
        group_start = min(_parse_timestamp(row["created_at"]) for row in instrument_rows)
        try:
            candles = await market.fetch_history(instrument, start=group_start, end=current)
        except Exception as error:
            logger.warning("Forecast history failed for %s: %s", instrument, error)
            candles = []
        for row in instrument_rows:
            result = _score_candles(row, candles, current)
            if result is None:
                created_at = _parse_timestamp(row["created_at"])
                if not candles and current >= created_at + timedelta(hours=_horizon_hours()):
                    result = {
                        "status": "unscorable",
                        "resolved_at": None,
                        "resolved_price": None,
                        "max_favorable": None,
                        "max_adverse": None,
                        "scored_at": _iso(current),
                        "unscorable_reason": "no price history available",
                    }
                else:
                    if not candles:
                        logger.warning("No forecast history returned for %s; leaving it pending.", instrument)
                        skipped += 1
                    pending += 1
                    continue
            await asyncio.to_thread(_update_score, row["id"], result)
            scored += 1
    return {"scored": scored, "pending": pending, "skipped": skipped}


def _hit_rate(wins: int, losses: int) -> float | None:
    sample = wins + losses
    return wins / sample if sample else None


def _stats_sync() -> dict[str, Any]:
    connection = _open_db()
    try:
        rows = connection.execute(
            "SELECT status, instrument, bias, confidence FROM forecasts"
        ).fetchall()
    finally:
        connection.close()
    status_counts = {status: 0 for status in STATUSES}
    by_instrument: dict[str, dict[str, int]] = {}
    by_bias: dict[str, dict[str, int]] = {}
    calibration: dict[str, dict[str, float]] = {}
    for status, instrument, bias, confidence in rows:
        status_counts[status] = status_counts.get(status, 0) + 1
        if status in {"tp1", "tp2", "final"}:
            instrument_stats = by_instrument.setdefault(instrument, {"wins": 0, "losses": 0})
            bias_stats = by_bias.setdefault(bias, {"wins": 0, "losses": 0})
            instrument_stats["wins"] += 1
            bias_stats["wins"] += 1
        elif status == "invalidated":
            instrument_stats = by_instrument.setdefault(instrument, {"wins": 0, "losses": 0})
            bias_stats = by_bias.setdefault(bias, {"wins": 0, "losses": 0})
            instrument_stats["losses"] += 1
            bias_stats["losses"] += 1
        if status in {"tp1", "tp2", "final", "invalidated"}:
            bucket_start = min(90, max(0, (int(confidence) // 10) * 10))
            bucket = f"{bucket_start}-{bucket_start + 9}" if bucket_start < 90 else "90-100"
            bucket_stats = calibration.setdefault(bucket, {"forecasts": 0, "wins": 0, "losses": 0, "confidence": 0.0})
            bucket_stats["forecasts"] += 1
            bucket_stats["confidence"] += confidence
            if status == "invalidated":
                bucket_stats["losses"] += 1
            else:
                bucket_stats["wins"] += 1
    by_instrument_result = [
        {
            "instrument": instrument,
            "wins": values["wins"],
            "losses": values["losses"],
            "hitRate": _hit_rate(values["wins"], values["losses"]),
        }
        for instrument, values in sorted(by_instrument.items())
    ]
    by_bias_result = [
        {
            "bias": bias,
            "wins": values["wins"],
            "losses": values["losses"],
            "hitRate": _hit_rate(values["wins"], values["losses"]),
        }
        for bias, values in sorted(by_bias.items())
    ]
    calibration_result = []
    for bucket, values in sorted(calibration.items(), key=lambda item: int(item[0].split("-")[0])):
        calibration_result.append(
            {
                "bucket": bucket,
                "forecasts": int(values["forecasts"]),
                "wins": int(values["wins"]),
                "losses": int(values["losses"]),
                "hitRate": _hit_rate(int(values["wins"]), int(values["losses"])),
                "meanConfidence": values["confidence"] / values["forecasts"],
            }
        )
    wins = status_counts["tp1"] + status_counts["tp2"] + status_counts["final"]
    losses = status_counts["invalidated"]
    return {
        "totals": {
            "logged": len(rows),
            "pending": status_counts["pending"],
            "unscorable": status_counts["unscorable"],
            "expired": status_counts["expired"],
            "ambiguous": status_counts["ambiguous"],
            "wins": wins,
            "losses": losses,
        },
        "hitRate": _hit_rate(wins, losses),
        "sample": wins + losses,
        "byInstrument": by_instrument_result,
        "byBias": by_bias_result,
        "calibration": calibration_result,
        "horizonHours": _horizon_hours(),
        "storage": {"path": str(_db_path()), "durable": _durable()},
    }


async def stats() -> dict[str, Any]:
    return await asyncio.to_thread(_stats_sync)


def _recent_sync(limit: int) -> list[dict[str, Any]]:
    connection = _open_db()
    try:
        cursor = connection.execute(
            "SELECT * FROM forecasts ORDER BY created_at DESC LIMIT ?",
            (max(0, limit),),
        )
        columns = [description[0] for description in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        connection.close()
    result = []
    for row in rows:
        result.append(
            {
                "id": row["id"],
                "createdAt": row["created_at"],
                "instrument": row["instrument"],
                "bias": row["bias"],
                "direction": row["direction"],
                "confidence": row["confidence"],
                "referencePrice": row["reference_price"],
                "feedSource": row["feed_source"],
                "feedProxy": bool(row["feed_proxy"]),
                "tp1": row["tp1"],
                "tp2": row["tp2"],
                "finalTarget": row["final_target"],
                "invalidation": row["invalidation"],
                "status": row["status"],
                "unscorableReason": row["unscorable_reason"],
                "resolvedAt": row["resolved_at"],
                "resolvedPrice": row["resolved_price"],
                "maxFavorable": row["max_favorable"],
                "maxAdverse": row["max_adverse"],
                "scoredAt": row["scored_at"],
            }
        )
    return result


async def recent(limit: int = 50) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_recent_sync, limit)
