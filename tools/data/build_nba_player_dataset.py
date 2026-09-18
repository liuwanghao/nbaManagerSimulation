#!/usr/bin/env python3
"""Build the versioned NBA player JSON consumed by the H5.

Network access is confined to this offline tool. The built game never calls
stats.nba.com. Optional Hupu IDs are merged from hupu-player-id-map.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from nba_api import __version__ as NBA_API_VERSION
from nba_api.stats.endpoints import (
    commonteamroster,
    leaguedashplayerbiostats,
    leaguedashplayerstats,
    leaguedashptdefend,
    leaguedashptstats,
    leaguehustlestatsplayer,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "src/data/nba-player-dataset.json"
DEFAULT_HUPU_MAP = Path(__file__).with_name("hupu-player-id-map.json")
DEFAULT_2K_RATINGS = ROOT / "src/data/nba2k27-top100-ratings.json"
ATTRIBUTE_KEYS = (
    "shooting", "finishing", "playmaking", "perimeterDefense",
    "interiorDefense", "rebounding", "athleticism", "basketballIq",
)


def clamp(value: float, low: int = 25, high: int = 99) -> int:
    return max(low, min(high, round(value)))


def number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def production_overall(base: dict[str, Any]) -> int:
    """Calibrate the UI summary to the source season's on-court production.

    This follows the proven noRegrets H5 approach: box-score production sets
    the player's tier, while the percentile attributes keep describing how the
    player creates that value and remain the simulation inputs.
    """
    return clamp(
        64
        + number(base.get("PTS")) * 0.72
        + number(base.get("REB")) * 0.36
        + number(base.get("AST")) * 0.45
        + number(base.get("MIN")) * 0.13,
        61,
        96,
    )


def normalize_name(value: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", ascii_name.lower())


def result_rows(endpoint: Any) -> list[dict[str, Any]]:
    result = endpoint.get_dict()["resultSets"][0]
    return [dict(zip(result["headers"], row, strict=True)) for row in result["rowSet"]]


def request(label: str, factory: Callable[[], Any], retries: int = 3) -> list[dict[str, Any]]:
    for attempt in range(retries):
        try:
            rows = result_rows(factory())
            print(f"{label}: {len(rows)} rows", flush=True)
            time.sleep(0.65)
            return rows
        except Exception as error:  # nba.com intermittently closes connections
            if attempt + 1 == retries:
                raise RuntimeError(f"{label} failed after {retries} attempts") from error
            time.sleep(2.0 * (attempt + 1))
    return []


def indexed(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row["PLAYER_ID"]): row for row in rows if row.get("PLAYER_ID") is not None}


def percentile(values: list[float], target: float) -> float:
    if not values:
        return 0.5
    ordered = sorted(values)
    below = sum(1 for value in ordered if value < target)
    equal = sum(1 for value in ordered if value == target)
    return (below + equal * 0.5) / len(ordered)


def infer_position(base: dict[str, Any], bio: dict[str, Any]) -> str:
    height = number(bio.get("PLAYER_HEIGHT_INCHES"), 78)
    reb = number(base.get("REB"))
    ast = number(base.get("AST"))
    if height <= 74 or (height <= 77 and ast >= 5):
        return "PG"
    if height <= 78:
        return "SG"
    if height <= 81:
        return "SF"
    if height <= 83 and reb < 9:
        return "PF"
    return "C"


def season_projection(
    base_rows: list[dict[str, Any]],
    advanced_rows: list[dict[str, Any]],
    bio_rows: list[dict[str, Any]],
    extras: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    extras = extras or {}
    advanced = indexed(advanced_rows)
    bios = indexed(bio_rows)
    usable = [row for row in base_rows if number(row.get("GP")) > 0 and number(row.get("MIN")) > 0]
    metrics: dict[str, list[float]] = defaultdict(list)

    def feature(row: dict[str, Any], key: str) -> float:
        pid = str(row["PLAYER_ID"])
        adv = advanced.get(pid, {})
        hustle = extras.get("hustle", {}).get(pid, {})
        drives = extras.get("drives", {}).get(pid, {})
        catch_shoot = extras.get("catchShoot", {}).get(pid, {})
        defense = extras.get("defense", {}).get(pid, {})
        minutes = max(1.0, number(row.get("MIN")))
        games = max(1.0, number(row.get("GP")))
        values = {
            "ts": number(adv.get("TS_PCT"), number(row.get("FG_PCT"))),
            "three": number(row.get("FG3_PCT")),
            "three_volume": number(row.get("FG3A")) / minutes,
            "catch_three": number(catch_shoot.get("CATCH_SHOOT_FG3_PCT"), number(row.get("FG3_PCT"))),
            "finish_eff": (number(row.get("FGM")) - number(row.get("FG3M"))) / max(1.0, number(row.get("FGA")) - number(row.get("FG3A"))),
            "free_throw_rate": number(row.get("FTA")) / max(1.0, number(row.get("FGA"))),
            "drive_pts": number(drives.get("DRIVE_PTS")) / games,
            "ast_pct": number(adv.get("AST_PCT"), number(row.get("AST")) / minutes),
            "ast_tov": number(row.get("AST")) / max(0.5, number(row.get("TOV"))),
            "stl_rate": number(row.get("STL")) / minutes,
            "deflections": number(hustle.get("DEFLECTIONS")) / games,
            "defg": -number(defense.get("PCT_PLUSMINUS")),
            "blk_rate": number(row.get("BLK")) / minutes,
            "dreb_pct": number(adv.get("DREB_PCT"), number(row.get("DREB")) / max(1.0, number(row.get("REB")) + 5)),
            "oreb_pct": number(adv.get("OREB_PCT"), number(row.get("OREB")) / max(1.0, number(row.get("REB")) + 5)),
            "minutes": minutes / games,
            "plus_minus": number(row.get("PLUS_MINUS")) / games,
            "net_rating": number(adv.get("NET_RATING")),
            "turnover_inverse": -number(adv.get("TM_TOV_PCT"), number(row.get("TOV")) / minutes),
        }
        return values[key]

    keys = (
        "ts", "three", "three_volume", "catch_three", "finish_eff", "free_throw_rate", "drive_pts",
        "ast_pct", "ast_tov", "stl_rate", "deflections", "defg", "blk_rate", "dreb_pct", "oreb_pct",
        "minutes", "plus_minus", "net_rating", "turnover_inverse",
    )
    for row in usable:
        for key in keys:
            metrics[key].append(feature(row, key))

    projected: list[dict[str, Any]] = []
    for row in usable:
        pid = str(row["PLAYER_ID"])
        bio = bios.get(pid, {})
        pct = {key: percentile(metrics[key], feature(row, key)) for key in keys}
        games = number(row.get("GP"))
        reliability = min(1.0, games / 40.0)

        def score(weighted: list[tuple[str, float]]) -> int:
            raw = sum(pct[key] * weight for key, weight in weighted) / sum(weight for _, weight in weighted)
            shrunk = 0.5 + (raw - 0.5) * (0.35 + reliability * 0.65)
            return clamp(42 + shrunk * 52)

        attributes = {
            "shooting": score([("ts", 0.3), ("three", 0.3), ("three_volume", 0.2), ("catch_three", 0.2)]),
            "finishing": score([("finish_eff", 0.45), ("free_throw_rate", 0.25), ("drive_pts", 0.15), ("ts", 0.15)]),
            "playmaking": score([("ast_pct", 0.6), ("ast_tov", 0.4)]),
            "perimeterDefense": score([("stl_rate", 0.42), ("deflections", 0.33), ("defg", 0.25)]),
            "interiorDefense": score([("blk_rate", 0.5), ("defg", 0.25), ("dreb_pct", 0.25)]),
            "rebounding": score([("dreb_pct", 0.65), ("oreb_pct", 0.35)]),
            "athleticism": score([("minutes", 0.45), ("drive_pts", 0.25), ("stl_rate", 0.15), ("blk_rate", 0.15)]),
            "basketballIq": score([("net_rating", 0.35), ("plus_minus", 0.25), ("ast_tov", 0.2), ("turnover_inverse", 0.2)]),
        }
        overall = production_overall(row)
        age = round(number(bio.get("AGE"), number(row.get("AGE"), 25)))
        potential = clamp(overall + max(0, 26 - age) * 1.8, 50, 99)
        durability = clamp(42 + min(1, games / 82) * 55)
        quality = []
        if not extras.get("hustle", {}).get(pid):
            quality.append("NO_HUSTLE_FALLBACK")
        if not extras.get("defense", {}).get(pid):
            quality.append("NO_TRACKING_DEFENSE_FALLBACK")
        projected.append({
            "playerId": pid,
            "name": str(row.get("PLAYER_NAME") or bio.get("PLAYER_NAME") or pid),
            "teamAbbreviation": str(row.get("TEAM_ABBREVIATION") or "FA"),
            "position": infer_position(row, bio),
            "age": age,
            "heightCm": round(number(bio.get("PLAYER_HEIGHT_INCHES"), 78) * 2.54),
            "weightKg": round(number(bio.get("PLAYER_WEIGHT"), 215) * 0.453592),
            "base": row,
            "advanced": advanced.get(pid, {}),
            "attributes": attributes,
            "overall": overall,
            "potential": potential,
            "durability": durability,
            "qualityFlags": quality,
        })
    return projected


def load_season(season: str, detailed: bool) -> tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]]:
    common = dict(season=season, season_type_all_star="Regular Season", timeout=35)
    base = request(f"{season} base", lambda: leaguedashplayerstats.LeagueDashPlayerStats(measure_type_detailed_defense="Base", per_mode_detailed="PerGame", **common))
    advanced = request(f"{season} advanced", lambda: leaguedashplayerstats.LeagueDashPlayerStats(measure_type_detailed_defense="Advanced", per_mode_detailed="PerGame", **common))
    bios = request(f"{season} bio", lambda: leaguedashplayerbiostats.LeagueDashPlayerBioStats(per_mode_simple="PerGame", **common))
    extras: dict[str, dict[str, dict[str, Any]]] = {}
    if detailed:
        optional = {
            "hustle": lambda: leaguehustlestatsplayer.LeagueHustleStatsPlayer(per_mode_time="PerGame", **common),
            "drives": lambda: leaguedashptstats.LeagueDashPtStats(player_or_team="Player", pt_measure_type="Drives", per_mode_simple="PerGame", **common),
            "catchShoot": lambda: leaguedashptstats.LeagueDashPtStats(player_or_team="Player", pt_measure_type="CatchShoot", per_mode_simple="PerGame", **common),
            "defense": lambda: leaguedashptdefend.LeagueDashPtDefend(defense_category="Overall", per_mode_simple="PerGame", **common),
        }
        for key, factory in optional.items():
            try:
                extras[key] = indexed(request(f"{season} {key}", factory, retries=2))
            except RuntimeError as error:
                print(f"warning: {error}; deterministic fallback will be used", flush=True)
                extras[key] = {}
    return season_projection(base, advanced, bios, extras), extras


def trait_from(attributes: dict[str, int]) -> list[str]:
    mapping = {
        "shooting": "SPACER", "finishing": "SLASHER", "playmaking": "PRIMARY_CREATOR",
        "perimeterDefense": "WING_STOPPER", "interiorDefense": "RIM_PROTECTOR",
        "rebounding": "REBOUNDER", "athleticism": "RIM_RUNNER", "basketballIq": "TWO_WAY",
    }
    return [mapping[max(attributes, key=attributes.get)]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current-season", default="2025-26")
    parser.add_argument("--historical-seasons", default="")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--hupu-map", type=Path, default=DEFAULT_HUPU_MAP)
    parser.add_argument("--nba2k-ratings", type=Path, default=DEFAULT_2K_RATINGS)
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--history-limit", type=int, default=96)
    args = parser.parse_args()
    history_seasons = [item.strip() for item in args.historical_seasons.split(",") if item.strip()]
    hupu_map = json.loads(args.hupu_map.read_text()) if args.hupu_map.exists() else {}
    nba2k_payload = json.loads(args.nba2k_ratings.read_text()) if args.nba2k_ratings.exists() else {"ratings": []}
    nba2k_ratings = {normalize_name(item["name"]): int(item["overall"]) for item in nba2k_payload["ratings"]}
    nba2k_aliases = {"jimmybutleriii": "jimmybutler"}

    current, current_extras = load_season(args.current_season, detailed=True)
    current_ids = {player["playerId"] for player in current}
    current_rosters: dict[str, dict[str, Any]] = {}
    team_ids = sorted({str(round(number(player["base"].get("TEAM_ID")))) for player in current if number(player["base"].get("TEAM_ID")) > 0})
    for team_id in team_ids:
        for row in request(f"{args.current_season} roster {team_id}", lambda team_id=team_id: commonteamroster.CommonTeamRoster(team_id=team_id, season=args.current_season, timeout=35)):
            if row.get("PLAYER_ID") is not None:
                current_rosters[str(row["PLAYER_ID"])] = row
    by_historical_player: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for season in history_seasons:
        rows, _ = load_season(season, detailed=False)
        for player in rows:
            by_historical_player[player["playerId"]].append((season, player))

    players = []
    for player in sorted(current, key=lambda item: int(item["playerId"])):
        source_id = f"nba:{player['playerId']}"
        mapping = hupu_map.get(player["playerId"], {})
        normalized_name = normalize_name(player["name"])
        official_overall = nba2k_ratings.get(normalized_name)
        if official_overall is None and normalized_name in nba2k_aliases:
            official_overall = nba2k_ratings.get(nba2k_aliases[normalized_name])
        overall = official_overall if official_overall is not None else player["overall"]
        potential = clamp(overall + max(0, 26 - player["age"]) * 1.8, 50, 99)
        quality_flags = list(player["qualityFlags"])
        if official_overall is not None:
            quality_flags.append("NBA_2K27_TOP_100_OVR")
        players.append({
            "canonicalPlayerId": source_id,
            "nbaPlayerId": player["playerId"],
            "hupuPlayerId": str(mapping.get("hupuPlayerId")) if mapping.get("hupuPlayerId") else None,
            "fullName": player["name"],
            "aliases": mapping.get("aliases", []),
            "teamAbbreviation": player["teamAbbreviation"],
            "jerseyNumber": str(current_rosters.get(player["playerId"], {}).get("NUM") or "") or None,
            "position": player["position"],
            "age": player["age"],
            "heightCm": player["heightCm"],
            "weightKg": player["weightKg"],
            "season": args.current_season,
            "stats": {
                "base": player["base"],
                "advanced": player["advanced"],
                **{key: current_extras.get(key, {}).get(player["playerId"], {}) for key in ("hustle", "drives", "catchShoot", "defense")},
            },
            "projection": {
                "attributes": player["attributes"],
                "overall": overall,
                "potential": potential,
                "durability": player["durability"],
                "personalitySeed": hashlib.sha256(f"nba-personality:{player['playerId']}".encode()).hexdigest()[:16],
                "qualityFlags": quality_flags,
            },
        })

    templates = []
    candidates = []
    for player_id, seasons in by_historical_player.items():
        if player_id in current_ids or len(seasons) < 3:
            continue
        ordered = sorted(seasons, key=lambda item: item[0])
        peak_season, peak = max(ordered, key=lambda item: item[1]["overall"])
        if peak["overall"] < 77:
            continue
        candidates.append((peak["overall"], player_id, ordered, peak_season, peak))
    for _, player_id, ordered, peak_season, peak in sorted(candidates, reverse=True)[: args.history_limit]:
        source_season, rookie = ordered[0]
        base = rookie["base"]
        minutes = max(1.0, number(base.get("MIN")))
        templates.append({
            "sourcePlayerId": f"nba:{player_id}",
            "sourceName": peak["name"],
            "sourceSeason": source_season,
            "peakSeason": peak_season,
            "era": source_season[:4] + "s",
            "position": rookie["position"],
            "heightCm": rookie["heightCm"],
            "weightKg": rookie["weightKg"],
            "rookieAttributes": rookie["attributes"],
            "peakOverall": clamp(peak["overall"]),
            "durability": round(sum(item[1]["durability"] for item in ordered) / len(ordered)),
            "tendencies": {
                "threeRate": round(max(0.12, min(0.7, number(base.get("FG3A")) / max(1.0, number(base.get("FGA"))))), 4),
                "assistRate": round(max(0.05, min(0.45, number(base.get("AST")) / minutes)), 4),
                "rimRate": round(max(0.12, min(0.7, 0.58 - number(base.get("FG3A")) / max(1.0, number(base.get("FGA"))) * 0.5)), 4),
                "usageTendency": clamp(42 + number(base.get("PTS")) * 1.6, 35, 95),
            },
            "traits": trait_from(peak["attributes"]),
            "eligible": True,
        })

    generated_at = args.generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    payload = {
        "schemaVersion": 1,
        "datasetVersion": f"nba-api-{args.current_season}-{generated_at[:10]}",
        "generatedAt": generated_at,
        "ratingModelVersion": "nba2k27-top100+production-tier-v3",
        "source": {
            "nbaApiVersion": NBA_API_VERSION,
            "currentSeason": args.current_season,
            "historicalSeasons": history_seasons,
            "endpoints": ["LeagueDashPlayerStats/Base", "LeagueDashPlayerStats/Advanced", "LeagueDashPlayerBioStats", "LeagueHustleStatsPlayer", "LeagueDashPtStats/Drives", "LeagueDashPtStats/CatchShoot", "LeagueDashPtDefend/Overall", "CommonTeamRoster"],
            "hupuMappingVersion": args.hupu_map.name if hupu_map else "unmapped",
        },
        "players": players,
        "historicalTemplates": sorted(templates, key=lambda item: item["sourcePlayerId"]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {len(players)} current players and {len(templates)} historical templates to {args.output}")


if __name__ == "__main__":
    main()
