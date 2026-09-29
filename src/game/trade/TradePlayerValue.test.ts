import { describe, expect, it } from "vitest";
import { publicPlayerValue } from "../ai/AIValueService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { rolloverLeagueYear } from "../contracts/ContractLifecycleService";
import { createCareer } from "../season/career";
import { emptyPlayerSeasonStats, type Player, type PlayerSeasonStats } from "../state/types";
import { tradePerformanceAdjustment, tradePlayerValue } from "./TradePlayerValue";

function ratedPlayer(): Player {
  const state = createCareer("trade-performance-value");
  const player = structuredClone(state.players[state.teams[state.userTeamId].playerIds[0]]);
  player.overallAdjustment = 80 - calculatePlayerOverall(player);
  player.age = 28;
  player.scoutedPotentialGrade = "C";
  player.career = undefined;
  return player;
}

function season(games: number, points: number, attempts = 16): PlayerSeasonStats {
  return {
    games, seconds: games * 30 * 60, pts: games * points,
    fgm: games * Math.round(attempts * 0.5), fga: games * attempts,
    threePm: games * 2, threePa: games * 5, ftm: games * 3, fta: games * 4,
    reb: games * 6, ast: games * 5, stl: games, blk: games, tov: games * 2,
  };
}

describe("trade player value", () => {
  it("keeps contract and expansion value unchanged while rewarding a sustained surplus season", () => {
    const player = ratedPlayer();
    const baseline = publicPlayerValue(player);
    player.seasonStats = season(25, 22);
    expect(tradePerformanceAdjustment(player)).toBeGreaterThan(0);
    expect(tradePlayerValue(player)).toBeGreaterThan(baseline);
    expect(publicPlayerValue(player)).toBe(baseline);
  });

  it("shrinks short samples and accounts for scoring efficiency", () => {
    const player = ratedPlayer();
    player.seasonStats = season(4, 22);
    const shortSample = tradePerformanceAdjustment(player);
    player.seasonStats = season(25, 22);
    const fullSample = tradePerformanceAdjustment(player);
    expect(shortSample).toBeGreaterThan(0);
    expect(shortSample).toBeLessThan(fullSample);
    player.seasonStats = season(25, 22, 21);
    expect(tradePerformanceAdjustment(player)).toBeLessThan(fullSample);
  });

  it("uses recent form as a smaller in-season signal", () => {
    const player = ratedPlayer();
    player.seasonStats = season(25, 22);
    const baseline = tradePerformanceAdjustment(player);
    player.form = 2;
    expect(tradePerformanceAdjustment(player) - baseline).toBeCloseTo(1);
    player.seasonStats = emptyPlayerSeasonStats();
    expect(tradePerformanceAdjustment(player)).toBe(0);
  });

  it("carries real prior-season form through a new season and ignores synthetic opening stats", () => {
    const player = ratedPlayer();
    player.career = { seasonsPlayed: 1, totals: season(25, 22), peakOverall: 80, peakImpact: 80,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
      lastSeasonStats: season(25, 22) };
    expect(tradePerformanceAdjustment(player)).toBeGreaterThan(0);
    player.career.lastSeasonStatsSource = "SYNTHETIC_OPENING";
    expect(tradePerformanceAdjustment(player)).toBe(0);
    delete player.career.lastSeasonStatsSource;
    player.seasonStats = season(25, 8);
    expect(tradePerformanceAdjustment(player)).toBeLessThan(0);
  });

  it("retains completed-season evidence after league rollover and save reload", () => {
    const state = createCareer("trade-performance-rollover");
    state.league.currentPhase = "OFFSEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].seasonStats = season(25, 22);
    const rolled = rolloverLeagueYear(state);
    expect(rolled.players[playerId].career?.lastSeasonStats?.games).toBe(25);
    rolled.players[playerId].seasonStats = emptyPlayerSeasonStats();
    const loaded = JSON.parse(JSON.stringify(rolled)) as typeof rolled;
    expect(tradePerformanceAdjustment(loaded.players[playerId])).toBeGreaterThan(0);
  });

  it("bounds performance changes and is deterministic without mutating stats", () => {
    const player = ratedPlayer();
    player.seasonStats = season(82, 60);
    const before = structuredClone(player);
    expect(tradePerformanceAdjustment(player)).toBe(8);
    expect(tradePlayerValue(player)).toBe(tradePlayerValue(player));
    expect(player).toEqual(before);
  });
});
