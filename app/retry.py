from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar


logger = logging.getLogger("quantsage.retry")
T = TypeVar("T")


def _status_code(error: BaseException) -> int | None:
    for candidate in (error, getattr(error, "response", None)):
        value = getattr(candidate, "status_code", None)
        if isinstance(value, int):
            return value
    return None


def _retry_reason(error: BaseException) -> str | None:
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    status = _status_code(error)
    if status == 429 or status is not None and 500 <= status <= 599:
        return f"HTTP {status}"
    return None


async def retry_with_backoff(
    operation: Callable[[], Awaitable[T]],
    engine: str,
    operation_name: str,
) -> T:
    for attempt in range(1, 4):
        try:
            return await operation()
        except Exception as error:
            reason = _retry_reason(error)
            if reason is None or attempt == 3:
                raise
            delay = 2 ** (attempt - 1)
            logger.warning(
                "Retrying %s for %s after attempt %s/%s (%s); waiting %ss.",
                operation_name,
                engine,
                attempt,
                3,
                reason,
                delay,
            )
            await asyncio.sleep(delay)
    raise RuntimeError("retry operation exhausted")
