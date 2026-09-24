#!/usr/bin/env python3
"""Fetch official NBA player bios for offline roster enrichment."""

from __future__ import annotations

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen


def fetch_profile(player_id: str) -> tuple[str, dict]:
    url = f"https://www.nba.com/player/{player_id}"
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=20) as response:
                html = response.read().decode("utf-8")
            match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
            if not match:
                raise ValueError("NBA profile payload is missing")
            player = json.loads(match.group(1))["props"]["pageProps"]["player"]
            info = player["info"]
            if str(info["PERSON_ID"]) != player_id:
                raise ValueError("NBA profile ID mismatch")
            regular_season_starts = sorted({
                int(season[1:])
                for raw_season in info.get("SEASONS") or []
                if (season := str(raw_season)).startswith("2")
                and re.fullmatch(r"2\d{4}", season)
                and int(season[1:]) <= 2025
            })
            published_experience = info.get("SEASON_EXP")
            opening_service_years = (
                min(published_experience, 2026 - regular_season_starts[0])
                if isinstance(published_experience, int) and regular_season_starts
                else 0
            )
            return player_id, {
                "birthDate": str(info.get("BIRTHDATE") or "")[:10] or None,
                "seasonExperience": published_experience,
                "regularSeasonStartYears": regular_season_starts,
                "completedRegularSeasons": len(regular_season_starts),
                "openingServiceYears": opening_service_years,
                "stats": player.get("stats") or {},
                "sourceUrl": url,
            }
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", type=Path, required=True, help="JSON array of NBA player IDs")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    ids = [str(player_id) for player_id in json.loads(args.ids.read_text())]
    if len(ids) != len(set(ids)) or any(not player_id.isdigit() for player_id in ids):
        raise ValueError("Profile IDs must be unique numeric NBA IDs")
    profiles: dict[str, dict] = {}
    failures: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_profile, player_id): player_id for player_id in ids}
        for future in as_completed(futures):
            player_id = futures[future]
            try:
                _, profiles[player_id] = future.result()
            except Exception as error:
                failures[player_id] = str(error)
    args.output.write_text(json.dumps({"profiles": profiles, "failures": failures}, indent=2) + "\n")
    print(f"Fetched {len(profiles)}/{len(ids)} official NBA profiles; failures: {failures}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
