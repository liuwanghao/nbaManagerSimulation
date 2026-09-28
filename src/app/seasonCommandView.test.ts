import { describe, expect, it } from "vitest";
import type { GameResult } from "../game/state/types";
import { hasRemainingScheduledDay, visibleRecentGames } from "./seasonCommandView";

describe("season command view", () => {
  it("allows the final scheduled day and stops after its games finish", () => {
    const schedule = [{ dateIndex: 172, status: "FINAL" as const }, { dateIndex: 173, status: "SCHEDULED" as const }];
    expect(hasRemainingScheduledDay(schedule, 173, 173)).toBe(true);
    schedule[1].status = "FINAL";
    expect(hasRemainingScheduledDay(schedule, 173, 173)).toBe(false);
    expect(hasRemainingScheduledDay([{ dateIndex: 173, status: "SCHEDULED" }], 174, 173)).toBe(false);
  });

  it("shows completed animation results one game at a time", () => {
    const saved = { old: { gameId: "old" } as GameResult };
    const frames = [{ game: { gameId: "first" } as GameResult }, { game: { gameId: "second" } as GameResult }];
    expect(visibleRecentGames(saved, frames, 0).map((game) => game.gameId)).toEqual(["old"]);
    expect(visibleRecentGames(saved, frames, 1).map((game) => game.gameId)).toEqual(["first", "old"]);
    expect(visibleRecentGames(saved, frames, 2).map((game) => game.gameId)).toEqual(["second", "first", "old"]);
    expect(visibleRecentGames({ ...saved, first: frames[0].game }, frames, 2).map((game) => game.gameId)).toEqual(["second", "first", "old"]);
  });
});
