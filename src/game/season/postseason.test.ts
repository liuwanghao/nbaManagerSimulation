import { beforeAll, describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import type { GameState } from "../state/types";
import {
  createCareer,
  enterPostseason,
  isUserPostseasonQualified,
  simulatePostseason,
  simulatePostseasonGame,
  simulateRegularSeason,
  standingsForConference,
} from "./career";

let completed: GameState;

beforeAll(() => {
  completed = simulateRegularSeason(createCareer("interactive-postseason"), {
    autoAcknowledgeMajorInjuries: true,
    autoResolveEmergencyRosters: true,
    autoResolveEvents: true,
  });
  completed.userTeamId = standingsForConference(completed, "WEST")[0].teamId;
}, 120_000);

describe("interactive postseason", () => {
  it("requires a settled season and a top-ten conference finish", () => {
    expect(() => enterPostseason(createCareer("unfinished"))).toThrow("REGULAR_SEASON_NOT_COMPLETE");
    const outOfContention = structuredClone(completed);
    outOfContention.userTeamId = standingsForConference(outOfContention, "WEST")[10].teamId;
    expect(isUserPostseasonQualified(outOfContention)).toBe(false);
    expect(() => enterPostseason(outOfContention)).toThrow("USER_NOT_POSTSEASON_QUALIFIED");
  });

  it("persists one result at a time, advances rounds, and archives the completed bracket", () => {
    const entered = enterPostseason(completed);
    expect(entered.league.currentPhase).toBe("PLAY_IN");
    expect(entered.postseason?.series.map((series) => series.id)).toEqual([
      "WEST-PLAYIN-A", "WEST-PLAYIN-B", "EAST-PLAYIN-A", "EAST-PLAYIN-B",
    ]);
    expect(entered.postseason?.schedule).toHaveLength(4);
    expect(entered.postseason?.schedule.every((game) => /^\d{4}-\d{2}-\d{2}$/.test(game.date))).toBe(true);
    const first = simulatePostseasonGame(entered);
    expect(first.postseason?.schedule.filter((game) => game.status === "FINAL")).toHaveLength(1);
    expect(Object.keys(first.postseason?.gameDetails ?? {})).toHaveLength(1);
    expect(entered.postseason?.schedule.every((game) => game.status === "SCHEDULED")).toBe(true);
    expect(first.calendar.currentDateIndex).toBeGreaterThan(entered.calendar.currentDateIndex);
    const replay = simulatePostseasonGame(entered);
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(replay)));
    const reloaded = JSON.parse(JSON.stringify(first)) as GameState;
    expect(stableHash(stableSerialize(simulatePostseasonGame(first))))
      .toBe(stableHash(stableSerialize(simulatePostseasonGame(reloaded))));

    const finished = simulatePostseason(first);
    expect(finished.league.currentPhase).toBe("OFFSEASON");
    expect(finished.postseason?.series.filter((series) => series.round === "R1")).toHaveLength(8);
    expect(finished.postseason?.series.filter((series) => series.bestOf === 7)).toHaveLength(15);
    expect(finished.postseason?.series.every((series) => series.winnerTeamId)).toBe(true);
    expect(finished.postseason?.schedule.every((game) => game.status === "FINAL")).toBe(true);
    expect(Object.keys(finished.postseason?.gameDetails ?? {})).toHaveLength(finished.postseason!.schedule.length);
    expect(finished.postseason?.series.filter((series) => series.bestOf === 7).every((series) =>
      series.gameIds.length >= 4 && series.gameIds.length <= 7 && Math.max(series.winsA, series.winsB) === 4)).toBe(true);
    expect(finished.history.champions).toHaveLength(1);
    expect(finished.history.seasons[0].championTeamId).toBe(finished.postseason?.series.find((series) => series.id === "FINALS")?.winnerTeamId);
    expect(finished.history.seasons[0].lotteryContext?.sevenEightLoserTeamIds).toHaveLength(2);
    expect(Object.keys(finished.history.seasons[0].postseasonGameDetails)).toHaveLength(finished.postseason!.schedule.length);
    expect(finished.history.seasonAwards[0].winners.FINALS_MVP).toBeTruthy();
    expect(finished.standings).toEqual(completed.standings);
  }, 120_000);
});
