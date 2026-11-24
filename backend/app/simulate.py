"""Parser for the X-Simulate-Failure request header.

    X-Simulate-Failure: key_1=429
    X-Simulate-Failure: key_1=429,key_2=500
    X-Simulate-Failure: *=429
"""

from __future__ import annotations

ALLOWED_STATUSES = {429, 500, 502, 503}


def parse_simulation(header: str | None) -> dict[str, int] | None:
    """Return {key_id or "*": status}, or None when the header holds nothing usable.

    Malformed pairs and unsupported statuses are ignored, so a bad header never
    turns into an error for the caller.
    """
    if not header:
        return None
    parsed: dict[str, int] = {}
    for pair in header.split(","):
        key, sep, raw = pair.partition("=")
        key, raw = key.strip(), raw.strip()
        if not sep or not key or not raw.isdigit():
            continue
        status = int(raw)
        if status in ALLOWED_STATUSES:
            parsed[key] = status
    return parsed or None


def status_for(sim: dict[str, int] | None, key_id: str) -> int | None:
    """A named key wins over the `*` wildcard."""
    if not sim:
        return None
    return sim.get(key_id, sim.get("*"))
