import { describe, expect, it } from "vitest";
import { emptyPlayerSeasonStats, type PlayerBoxScore } from "../game/state/types";
import { POSTGAME_HIGHLIGHT_STATS, postgameStatLeaders, sortPostgameBoxRows } from "./postgameStats";

const stat = (playerId: string, values: Partial<PlayerBoxScore>): PlayerBoxScore => ({ ...emptyPlayerSeasonStats(), playerId, ...values });

describe("postgame team stat leaders", () => {
  it("selects exactly one team leader for each highlighted category", () => {
    const rows = [
      stat("scorer", { seconds: 1200, pts: 25, reb: 5, ast: 2, stl: 0, blk: 0 }),
      stat("playmaker", { seconds: 1700, pts: 18, reb: 11, ast: 9, stl: 3, blk: 0 }),
      stat("rim-protector", { seconds: 1400, pts: 12, reb: 8, ast: 1, stl: 1, blk: 4 }),
    ];
    expect(postgameStatLeaders(rows)).toEqual({ pts: "scorer", reb: "playmaker", ast: "playmaker", stl: "playmaker", blk: "rim-protector" });
  });

  it("breaks ties by existing table order and handles an empty box score", () => {
    const rows = [stat("shorter", { seconds: 600, pts: 20 }), stat("longer", { seconds: 1500, pts: 20 })];
    expect(sortPostgameBoxRows(rows).map((row) => row.playerId)).toEqual(["longer", "shorter"]);
    expect(postgameStatLeaders(rows).pts).toBe("longer");
    expect(Object.values(postgameStatLeaders([]))).toHaveLength(POSTGAME_HIGHLIGHT_STATS.length);
    expect(Object.values(postgameStatLeaders([])).every((id) => id === undefined)).toBe(true);
  });
});
