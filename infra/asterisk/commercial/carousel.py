"""Pure, deterministic SashaTel Caller ID selection logic.

Database transaction and idempotency are REQUIRED outside this module.
Caller ID must be authorized by provider and bound to given tenant/trunk;
the caller cannot supply it. Caller ID rotation is per trunk, UTC event
timestamps are persisted elsewhere. Business-day boundary is configured
by backend, not hard-coded here.
"""
from dataclasses import dataclass
from datetime import datetime, date
from math import ceil
from typing import Sequence

DAILY_LIMIT = 8
FIRST_QUALITY_SAMPLE = 80
RESERVE_FACTOR = 1.5


@dataclass(frozen=True)
class Caller:
    e164: str
    organization_id: str
    trunk_id: str
    active: bool
    provider_approved: bool
    held_today: int
    committed_today: int
    last_dispatch_at: datetime | None = None


def eligible(callers: Sequence[Caller], *, organization_id: str, trunk_id: str) -> list[Caller]:
    """Return only approved active numbers with free daily capacity.

    Snapshot MUST be loaded and locked by backend, then reservation updated
    atomically in the same DB transaction. This helper alone is not a lock.
    """
    result = []
    for caller in callers:
        if caller.organization_id != organization_id or caller.trunk_id != trunk_id:
            continue
        if not caller.active or not caller.provider_approved:
            continue
        if caller.held_today < 0 or caller.committed_today < 0:
            raise ValueError("negative daily usage")
        if caller.held_today + caller.committed_today < DAILY_LIMIT:
            result.append(caller)
    return result


def select(callers: Sequence[Caller], *, organization_id: str, trunk_id: str) -> Caller | None:
    """Least-loaded Caller ID with deterministic least-recently-used tie-break."""
    pool = eligible(callers, organization_id=organization_id, trunk_id=trunk_id)
    if not pool:
        return None
    # datetime-aware timestamps only; None means never called.
    return min(pool, key=lambda c: (
        c.committed_today + c.held_today,
        c.last_dispatch_at.isoformat() if c.last_dispatch_at else "",
        c.e164,
    ))


def human_reach(human_answers: int, initiated: int) -> float | None:
    """Confirmed human answer rate; None for no initiated calls."""
    if initiated < 0 or human_answers < 0 or human_answers > initiated:
        raise ValueError("invalid counts")
    return human_answers / initiated if initiated else None


def capacity(monthly_initiations: int, calling_days: int, *, active_provisioned: int = 0,
             ordered_pending: int = 0) -> dict:
    """+50% number capacity; no growth extrapolation.

    Calling days must reflect planned dial days (e.g. 22 working days), not
    an automatic assumption of 30. Existing provisioned active and pending
    orders are subtracted; pending are never assumed usable for dispatch.
    """
    if monthly_initiations < 0 or not 1 <= calling_days <= 31:
        raise ValueError("invalid forecast")
    if min(active_provisioned, ordered_pending) < 0:
        raise ValueError("invalid inventory")
    main = ceil(monthly_initiations / (DAILY_LIMIT * calling_days))
    target = ceil(monthly_initiations / (DAILY_LIMIT * calling_days) * RESERVE_FACTOR)
    return {
        "primary": main,
        "reserve": target - main,
        "target": target,
        "order": max(0, target - active_provisioned - ordered_pending),
    }
