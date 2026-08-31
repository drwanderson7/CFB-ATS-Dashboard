"""Pure helper for PickGauge's existing api/fetch_cfbd.py.

This file deliberately does NOT define another HTTP handler, authentication
layer, Redis client, or CFBD credential path. The existing fetch_cfbd handler
should pass its already-authenticated/cached CFBD JSON fetch callable into
``build_survivor_enrichment``.

Expected fetch callable:
    fetch_json(path: str, params: dict) -> list|dict

The result is intentionally small and browser-safe: game IDs, pregame home WP,
and season betting lines only. The CFBD API key never leaves the server.
"""
from __future__ import annotations

from typing import Any, Callable
from datetime import datetime, timezone
import concurrent.futures

FetchJson = Callable[[str, dict[str, Any]], Any]


def _first(row: dict[str, Any] | None, *keys: str) -> Any:
    if not isinstance(row, dict):
        return None
    for key in keys:
        if row.get(key) is not None:
            return row.get(key)
    return None


def _number(value: Any) -> float | int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return int(number) if number.is_integer() else number


def trim_pregame(rows: Any) -> list[dict[str, Any]]:
    """Normalize CFBD PregameWinProbability rows to a stable small shape."""
    out: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        game_id = _first(row, "gameId", "game_id", "id")
        home_wp = _number(_first(row, "homeWinProbability", "home_win_probability"))
        if game_id is None or home_wp is None or not (0 <= float(home_wp) <= 1):
            continue
        out.append({
            "gameId": game_id,
            "week": _number(_first(row, "week")),
            "homeTeam": _first(row, "homeTeam", "home_team"),
            "awayTeam": _first(row, "awayTeam", "away_team"),
            "spread": _number(_first(row, "spread")),
            "homeWinProbability": float(home_wp),
        })
    return out


def trim_lines(rows: Any) -> list[dict[str, Any]]:
    """Normalize full-season CFBD betting games while retaining providers."""
    out: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        game_id = _first(row, "id", "gameId", "game_id")
        if game_id is None:
            continue
        lines: list[dict[str, Any]] = []
        for line in row.get("lines", []) if isinstance(row, dict) and isinstance(row.get("lines"), list) else []:
            spread = _number(_first(line, "spread"))
            if spread is None:
                continue
            lines.append({
                "provider": _first(line, "provider"),
                "spread": spread,
                "spreadOpen": _number(_first(line, "spreadOpen", "spread_open")),
                "overUnder": _number(_first(line, "overUnder", "over_under")),
            })
        if not lines:
            continue
        out.append({
            "gameId": game_id,
            "week": _number(_first(row, "week")),
            "homeTeam": _first(row, "homeTeam", "home_team"),
            "awayTeam": _first(row, "awayTeam", "away_team"),
            "lines": lines,
        })
    return out


def build_survivor_enrichment(year: int, fetch_json: FetchJson) -> dict[str, Any]:
    """Fetch the season-level data sets Survivor adds to PickGauge.

    Current CFBD endpoints:
      /metrics/wp/pregame?year=...&seasonType=regular
      /lines?year=...&seasonType=regular

    The caller owns authentication, retry/rate-limit behavior and shared cache.
    The two independent upstream calls run concurrently. If one provider view
    fails, the other remains useful and `unavailable` makes the degradation
    explicit; only a failure of BOTH requests is raised to the handler so its
    existing stale-cache fallback can take over.
    """
    year = int(year)
    requests = {
        "pregame": ("/metrics/wp/pregame", {"year": year, "seasonType": "regular"}),
        "lines": ("/lines", {"year": year, "seasonType": "regular"}),
    }
    raw: dict[str, Any] = {}
    unavailable: list[str] = []
    errors: list[BaseException] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(fetch_json, path, params): name for name, (path, params) in requests.items()}
        for future, name in [(future, futures[future]) for future in futures]:
            try:
                raw[name] = future.result()
            except Exception as exc:  # preserve HTTPError/URLError type if both fail
                unavailable.append(name)
                errors.append(exc)
                raw[name] = []

    if len(unavailable) == len(requests) and errors:
        raise errors[0]

    pregame = trim_pregame(raw.get("pregame"))
    lines = trim_lines(raw.get("lines"))
    return {
        "year": year,
        "pregame": pregame,
        "lines": lines,
        "coverage": {
            "pregameGames": len(pregame),
            "lineGames": len(lines),
        },
        "unavailable": unavailable,
        "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "live",
        "dataSource": "CollegeFootballData via PickGauge shared CFBD layer",
    }
