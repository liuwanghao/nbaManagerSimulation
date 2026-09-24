#!/usr/bin/env python3
"""Convert the approved 2026-27 Hupu salary workbook into the offline contract snapshot.

This importer is intentionally conservative: it only binds a workbook player to an
NBA player when the Chinese-name/team matcher produces one unique result, or when
the player is listed in MANUAL_PLAYER_ID_OVERRIDES.  Unmatched source rows remain
in the generated report instead of being assigned to a same-surname player.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = Path("/Users/uwa/Downloads/虎扑球员薪资合同0923.xlsx")
DEFAULT_OUTPUT = ROOT / "src/data/nba-2026-27-contracts.json"

# These are source IDs whose short display names are inherently ambiguous, but
# whose amount and listed team identify one player unambiguously. Keep this map
# keyed by the source ID, never by a short Chinese surname.
MANUAL_PLAYER_ID_OVERRIDES = {
    # 2026-09-23 workbook: abbreviated Chinese names that do not uniquely
    # identify a player without the source ID and listed team.
    "1125706735911174144": "1641712",  # Rayan Rupert, PHI
    "1121463824277307392": "1641715",  # Cam Whitmore, DEN
    "880449721515114496": "1630245",  # Ayo Dosunmu, MIN
    "1387404373033746432": "1642866",  # Joan Beringer, MIN
    "1398243442718408704": "1643024",  # Chris Mañon, LAL
    "981254044985065472": "1631114",  # Jalen Williams, OKC; $41.24m
    "981256494471184384": "1631119",  # Jaylin Williams, OKC; $7.77m
    "1519326284331614208": "1642892",  # Bennett Stirtz, OKC
    "1519688673233207296": "1643717",  # Josh Dix, OKC
    "1519326309480660992": "1642865",  # Yaxel Lendeborg, GSW
    "1519688645034901504": "1641759",  # Dillon Mitchell
    "1901000000469196": "1627742",  # Brandon Ingram
    "1121468653783482368": "1641711",  # Gradey Dick
    "1901000000469215": "1627759",  # Jaylen Brown
    "1901000000473199": "1628976",  # Wendell Carter Jr.
    "1901000000473478": "1628975",  # Jevon Carter
    "1519688656015589376": "1643552",  # Braden Smith
    "1901000000443105": "202695",  # Kawhi Leonard
    "1125706747349041152": "1641757",  # Jordan Miller
    "1519688708645715968": "1642394",  # Baba Miller
    "1901000000442301": "201939",  # Stephen Curry
    "924527372818972672": "1630314",  # Brandon Williams
    "1901000000442016": "201599",  # DeAndre Jordan
    "1125706731259691008": "1641748",  # Andre Jackson Jr.
    "1519326304690765824": "1643516",  # Morez Johnson Jr.
    "1519688693407809536": "1643576",  # Maliq Brown
    "1519688654484668416": "1643509",  # Meleek Thomas
    "1901000000447661": "203484",  # Kentavious Caldwell-Pope
    "1125706722682339328": "1630592",  # Jalen Wilson
    "981588435095519232": "1631157",  # Ryan Rollins
    "1387382386311823360": "1642852",  # Derik Queen
    "1519688691906248704": "1643551",  # Ja'Kobi Gillespie
    "880449752901091328": "1629674",  # Neemias Queta
    "1251529022051975168": "1631248",  # Baylor Scheierman
    "1519326254912765952": "1643416",  # Chris Cenac Jr.
    "880449718004482048": "1630573",  # Sam Hauser
    "1901000000448486": "203952",  # Andrew Wiggins
    "1519688629880881152": "1643553",  # Ryan Conwell
    "1256937675525455872": "1641796",  # Pelle Larsson
    "1901000000447722": "203507",  # Giannis Antetokounmpo
    "1251528042300309504": "1642359",  # Pacôme Dadiet
    "1901000000471468": "1628384",  # OG Anunoby
    "998525741144473600": "1631288",  # Jamal Cain
    "1387402195170754560": "1642869",  # Noah Penda
    "981571817179185152": "1630574",  # Ariel Hukporti
    "1251525952307986432": "1642267",  # Bub Carrington
    "1519688631613128704": "1643590",  # Felix Okpara
    "1519326249481142272": "1642889",  # Labaron Philon
    "880449719149527040": "1630551",  # Justin Champagnie
    "1901000000473118": "1629027",  # Trae Young
    "1125706715786903552": "1631243",  # Mouhamed Gueye
    "1519326234369064960": "1643544",  # Zuby Ejiofor
    "880449732831346688": "1630598",  # Aaron Wiggins
    "1519688625334255616": "1643539",  # Henri Veesaar
    "1519326263087464448": "1643410",  # Caleb Wilson
    "1288827396165730304": "1641772",  # Nae'Qwan Tomlin
    "981252718343487488": "1631215",  # Khalifa Diop
    "787405150745526272": "1630198",  # Isaiah Joe
    "1294974868621623296": "1641989",  # Elijah Harkless
    "1290953203197673472": "1642449",  # Tolu Smith
    "1519688636025536512": "1642391",  # Ugonna Onyenso
    "1901000000473703": "1628989",  # Kevin Huerter
    "1251524986116505600": "1642277",  # Johnny Furphy
    "880449702191955968": "1630643",  # Jay Huff
    "1121477045176500224": "1631170",  # Jaime Jaquez Jr.
    "1519326276144332800": "1643417",  # Nate Ament
    "1290330612430798848": "1642504",  # Cormac Ryan
    "1901000000479294": "1629627",  # Zion Williamson
    "1901000000480021": "1629673",  # Jordan Poole
    "1519688690706677760": "1643555",  # Jaron Pierre Jr.
    "1387402793907650560": "1642857",  # Kasparas Jakučionis
    "787405163395547136": "1630180",  # Saddiq Bey
    "981187035370881024": "1631097",  # Bennedict Mathurin
    "1901000000469362": "1627749",  # Dejounte Murray
    "1901000000448263": "203937",  # Kyle Anderson
    "1901000000469225": "1627750",  # Jamal Murray
    "1901000000471673": "203992",  # Bogdan Bogdanović
    "1901000000470386": "1627832",  # Fred VanVleet
    "1251135627013914624": "1641744",  # Zach Edey
    "1256922427552694272": "1642285",  # Cam Spencer
    "1901000000479677": "1629660",  # Ty Jerome
    "1256933021890641920": "1642377",  # Jaylen Wells
    "1121477692571516928": "1631200",  # Kris Murray
    "981615811208675328": "1630577",  # Julian Champagnie
    "1519326303889653760": "1643519",  # Jayden Quaintance
    "1901000000476700": "1629162",  # Jordan McLaughlin
    "1121482436916543488": "1641729",  # Brice Sensabaugh
    "1389863207807483904": "1642926",  # Tamar Bates
    "1387462611041255424": "1642910",  # John Tonje
    "1901000000442390": "201959",  # Taj Gibson
    "1387399026189533184": "1642363",  # Nique Clifford
    "1390316209458642944": "1642928",  # Dylan Cardwell
    "1519326324290748416": "1643411",  # Darius Acuff Jr.
    "1018312348626059264": "1631342",  # Daeqwon Plowden
    "1253408042364436480": "1642367",  # Jonathan Mogbo
    "981217376362037248": "1631117",  # Walker Kessler
    "1901000000467889": "1626172",  # Kevon Looney
    "880449712333783040": "1629656",  # Quentin Grimes
    "1387459048529461248": "1642876",  # Adou Thiero
    "1901000000479752": "1629680",  # Matisse Thybulle
    "880449728037257216": "1630572",  # Sandro Mamukelashvili
    "1478738868676067328": "1643257",  # Jayson Kent
    "990965014699442176": "1631221",  # Collin Gillespie
    "1387401047596597248": "1642863",  # Khaman Maluach
    "1121479388039217152": "1641764",  # Brandin Podziemski
    "1901000051664767": "1629622",  # Max Strus
    "1901000000442013": "201572",  # Brook Lopez
    "1387399913876226048": "1642851",  # Kon Knueppel
    "1901000000479692": "1629684",  # Grant Williams
    "1121484272348168192": "1641730",  # Noah Clowney
    "1901000000480199": "1629611",  # Terance Mann
    "1519326251699929088": "1643538",  # Joshua Jefferson
    "1421436246701375488": "1643052",  # Chaney Johnson
    "1901000040064319": "1629723",  # John Konchar, NYK; workbook NYK salary row
    "981250938406699008": "1631207",  # Dalen Terry, GSW; workbook GSW salary row
    "1125706726490767360": "1641763",  # Julian Phillips, HOU; workbook HOU salary row
    "1397428056414486528": "1642461",  # Spencer Jones, DEN; exact $6m/$5.75m two-year contract
}

# The workbook has a blank 2030-31 row between Wembanyama's 2029-30 salary
# and his 2031-32 player option. The user supplied the missing 2030-31 amount.
MANUAL_SALARY_OVERRIDES = {
    ("996105644471746560", "2030-31赛季"): 53_940_000,
}


def normalized_name(value: str | None) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value or "").replace("小", "").replace("二世", "").replace("三世", "").lower()


def parse_yuan(value: Any) -> int:
    if not isinstance(value, str) or not value.endswith("万"):
        return 0
    return round(float(value.removesuffix("万")) * 10_000)


def salary_for(row: dict[str, Any]) -> int:
    source_salary = parse_yuan(row["seasonSalary"])
    override = MANUAL_SALARY_OVERRIDES.get((str(row["playerId"]), str(row["season"])))
    if override is not None and source_salary > 0 and source_salary != override:
        raise ValueError(f"Salary override conflicts with workbook for {row['playerId']} {row['season']}")
    return override if override is not None else source_salary


def option_for(value: Any) -> str:
    text = str(value or "")
    if "球队" in text:
        return "TEAM_OPTION"
    if "球员" in text:
        return "PLAYER_OPTION"
    return "NONE"


def guarantee_for(salary: int, option: str, source_option: Any) -> int:
    # The source explicitly calls out non-guaranteed and option seasons. Do not
    # convert an optional/non-guaranteed future salary into guaranteed dead money.
    if option != "NONE" or "非完全保障" in str(source_option or ""):
        return 0
    return salary


def fallback_chinese_name(english_name: str, full: dict[str, str], parts: dict[str, str]) -> str:
    lowered = " ".join(english_name.lower().split())
    if lowered in full:
        return full[lowered]
    words = re.findall(r"[A-Za-z]+", english_name)
    significant = [word for word in words if word.lower() not in {"jr", "sr", "ii", "iii", "iv"}]
    return "·".join(parts[word.lower()] for word in significant) if significant and all(word.lower() in parts for word in significant) else ""


def score_name(source_name: str, candidate_name: str) -> int:
    source = normalized_name(source_name)
    candidate = normalized_name(candidate_name)
    if source == candidate:
        return 100
    if len(source) >= 2 and (source in candidate or candidate in source):
        return min(len(source), len(candidate)) * 10
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    dataset = json.loads((ROOT / "src/data/nba-player-dataset.json").read_text(encoding="utf-8"))["players"]
    dataset.extend(json.loads((ROOT / "src/data/nba-supplemental-player-projections.json").read_text(encoding="utf-8")))
    roster = json.loads((ROOT / "src/data/nba-current-roster.json").read_text(encoding="utf-8"))["players"]
    chinese_names = json.loads((ROOT / "src/data/nba-player-names-zh.json").read_text(encoding="utf-8"))["namesByNbaPlayerId"]
    projections = {player["nbaPlayerId"]: player for player in dataset}
    roster = [player for player in roster if player["nbaPlayerId"] in projections]
    team_text = (ROOT / "src/data/teamBranding.ts").read_text(encoding="utf-8")
    team_by_source = {source_id: abbreviation for abbreviation, source_id in re.findall(r'\s([A-Z]{3}): \{ sourceTeamId: "(\d+)"', team_text)}
    ui_text = (ROOT / "src/app/playerNameZh.ts").read_text(encoding="utf-8")
    ui_pairs = dict(re.findall(r'\s*"([^\"]+)": "([^\"]+)",', ui_text))
    full_name_overrides = {key: value for key, value in ui_pairs.items() if " " in key or "'" in key or "." in key}
    common_name_parts = {key: value for key, value in ui_pairs.items() if key not in full_name_overrides}
    candidate_labels = {
        player["nbaPlayerId"]: [
            chinese_names.get(player["nbaPlayerId"], ""),
            fallback_chinese_name(player["fullName"], full_name_overrides, common_name_parts),
        ]
        for player in roster
    }

    workbook = load_workbook(args.input, read_only=True, data_only=True)
    sheet = workbook["球员历年薪资"]
    headers = [str(value) for value in next(sheet.values)]
    rows = [dict(zip(headers, values)) for values in sheet.values if values[2] is not None]
    by_source_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_source_player[str(row["playerId"])].append(row)

    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for player in roster:
        by_team[player["teamAbbreviation"]].append(player)

    def match(row: dict[str, Any]) -> tuple[str | None, str]:
        source_id = str(row["playerId"])
        if source_id in MANUAL_PLAYER_ID_OVERRIDES:
            target = MANUAL_PLAYER_ID_OVERRIDES[source_id]
            return (target, "manual") if target in projections else (None, "manual_missing_projection")
        source_team = team_by_source.get(str(row["teamId"]))
        candidates: list[tuple[int, dict[str, Any]]] = []
        for player in roster:
            labels = candidate_labels[player["nbaPlayerId"]]
            score = max((score_name(str(row["playerName"]), label) for label in labels), default=0)
            if score:
                # Keep team agreement as a tiebreaker only. The game roster and
                # workbook are both 2026-27 snapshots but can differ after trades.
                candidates.append((score + (2 if player["teamAbbreviation"] == source_team else 0), player))
        best = max((score for score, _ in candidates), default=0)
        winners = [player for score, player in candidates if score == best]
        return (winners[0]["nbaPlayerId"], "auto") if len(winners) == 1 else (None, "ambiguous" if winners else "unmatched")

    contracts = []
    unmatched = []
    source_salary_gaps = []
    used_nba_ids: set[str] = set()
    for source_id, player_rows in sorted(by_source_player.items()):
        player_rows.sort(key=lambda row: str(row["season"]))
        current = next((row for row in player_rows if row["season"] == "2026-27赛季" and salary_for(row) > 0), None)
        if not current:
            continue
        nba_player_id, match_type = match(current)
        if not nba_player_id or nba_player_id in used_nba_ids:
            unmatched.append({
                "sourcePlayerId": source_id,
                "sourcePlayerName": current["playerName"],
                "sourceTeamId": str(current["teamId"]),
                "sourceTeamName": current["team_name"],
                "reason": "duplicate_target" if nba_player_id in used_nba_ids else match_type,
            })
            continue
        # Contract arrays represent consecutive seasons. The source currently
        # has one salary after a blank season; packing that later amount into
        # the blank year would silently put the salary and option in 2030-31.
        salary_rows = []
        future_rows = [row for row in player_rows if str(row["season"]) >= "2026-27赛季"]
        for row in future_rows:
            if salary_for(row) <= 0:
                if any(salary_for(later) > 0 for later in future_rows[len(salary_rows) + 1:]):
                    source_salary_gaps.append({"sourcePlayerId": source_id, "sourcePlayerName": current["playerName"], "season": row["season"]})
                break
            salary_rows.append(row)
        salaries = [salary_for(row) for row in salary_rows]
        options = [option_for(row["salaryOption"]) for row in salary_rows]
        guarantees = [guarantee_for(salary, option, row["salaryOption"]) for salary, option, row in zip(salaries, options, salary_rows)]
        future_status = next((str(row["restrictedType"]) for row in player_rows if row["restrictedType"] in {"UFA", "RFA"}), None)
        projection = projections[nba_player_id]
        contracts.append({
            "canonicalPlayerId": projection["canonicalPlayerId"],
            "nbaPlayerId": nba_player_id,
            "sourcePlayerId": source_id,
            "sourcePlayerName": current["playerName"],
            "sourceTeamId": str(current["teamId"]),
            "matchType": match_type,
            "salaryByYear": salaries,
            "guaranteedByYear": guarantees,
            "optionByYear": options,
            "futureFreeAgencyStatus": future_status,
        })
        used_nba_ids.add(nba_player_id)

    payload = {
        "schemaVersion": 1,
        "season": "2026-27",
        "source": {
            "provider": "user-provided workbook",
            "fileName": args.input.name,
            "sheet": "球员历年薪资",
            "currency": "USD",
            "unit": "yuan",
        },
        "contracts": sorted(contracts, key=lambda item: item["canonicalPlayerId"]),
        "unmatchedSourcePlayers": sorted(unmatched, key=lambda item: (item["sourceTeamId"], item["sourcePlayerName"], item["sourcePlayerId"])),
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"contracts": len(contracts), "unmatched": len(unmatched), "sourceSalaryGaps": source_salary_gaps, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
