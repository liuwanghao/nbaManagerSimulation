import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { advanceInjuriesByDays, applyInjuryEvents, availablePlayerCount, estimatedInjuryMissedGames, recordInjuryMissedGames } from "../simulation/injuries";
import { solveRotationSeconds } from "../simulation/minutes";
import { applyRotationPlanToPlayers, buildDefaultRotationPlan, normalizeRotationPlan, validateRotationPlan } from "../roster/RotationPlanService";
import { setRotationPlan } from "../roster/RosterService";
import { blockingEvent, executeEventCommand, nextPendingEvent } from "../events/EventService";
import type { InjuryEvent } from "../state/types";
import { advanceFreeAgencyDay } from "../freeAgency/FreeAgencyService";
import { closeFreeAgency } from "../roster/RosterService";

function majorEvent(playerId: string, teamId: string): InjuryEvent {
  return {
    injuryId: "injury-major-test",
    playerId,
    teamId,
    severity: "LONG",
    gamesOut: 25,
    gameId: "game-major-test",
    seasonId: "2026-27",
  };
}

describe("InjuryService", () => {
  it("automatically adjusts rotation and sends one notification without a depth-injury popup", () => {
    const state = createCareer("depth-injury-auto-rotation");
    const team = state.teams[state.userTeamId];
    const playerId = team.rotationPlan!.starters.PG;
    team.rotationPlan!.selectionMode = "MANUAL";
    const event = { ...majorEvent(playerId, team.id), severity: "SHORT" as const, daysOut: 7 };
    applyInjuryEvents(state, [event]);
    expect(nextPendingEvent(state)).toBeUndefined();
    expect(blockingEvent(state)).toBeUndefined();
    expect(team.rotationPlan?.selectionMode).toBe("AUTO");
    const roster = team.playerIds.map((id) => state.players[id]);
    expect(() => validateRotationPlan(roster, team.rotationPlan!)).not.toThrow();
    const seconds = solveRotationSeconds(roster, false, team.rotationPlan);
    expect(seconds[playerId] ?? 0).toBe(0);
    expect(Object.values(seconds).reduce((sum, value) => sum + value, 0)).toBe(240 * 60);
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({
      title: "轮换球员受伤", read: false,
      message: expect.stringContaining("已自动调整轮换"),
    }));
    applyInjuryEvents(state, [event]);
    expect(state.teamNotifications).toHaveLength(1);
  });

  it("offers automatic rotation adjustments for both injury and recovery", () => {
    const state = createCareer("major-injury-test");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].teamRole = "FRANCHISE_CORE";
    const event = majorEvent(playerId, state.userTeamId);
    applyInjuryEvents(state, [event]);

    expect(state.players[playerId].available).toBe(false);
    expect(state.players[playerId].health).toBe(35);
    expect(state.players[playerId].rotationRole).toBe("OUT");
    expect(state.injuryState.pendingUserMajorInjury).toBeUndefined();
    expect(nextPendingEvent(state)).toBeUndefined();
    const adjusted = state;
    const roster = adjusted.teams[adjusted.userTeamId].playerIds.map((id) => adjusted.players[id]);
    expect(adjusted.teams[adjusted.userTeamId].rotationPlan?.selectionMode).toBe("AUTO");
    expect(adjusted.teamNotifications).toContainEqual(expect.objectContaining({ title: "核心球员受伤", read: false }));
    const injuredMinutes = solveRotationSeconds(roster, false, adjusted.teams[adjusted.userTeamId].rotationPlan);
    expect(injuredMinutes[playerId] ?? 0).toBe(0);
    expect(Object.values(injuredMinutes).reduce((sum, seconds) => sum + seconds, 0)).toBe(240 * 60);
    if (!adjusted.players[playerId].injury) throw new Error("Expected injury");
    adjusted.players[playerId].injury.daysRemaining = 1;
    advanceInjuriesByDays(adjusted, 1);
    expect(adjusted.players[playerId].injury).toBeUndefined();
    expect(nextPendingEvent(adjusted)).toBeUndefined();
    const recovered = adjusted;
    expect(solveRotationSeconds(roster, false, recovered.teams[recovered.userTeamId].rotationPlan)[playerId]).toBeGreaterThan(0);
    expect(recovered.teamNotifications).toContainEqual(expect.objectContaining({ title: "伤员回归", read: false }));
  });

  it.each([
    { severity: "MINOR" as const, daysOut: 3, duration: "预计伤停约 3 天", expectedGames: 2 },
    { severity: "SHORT" as const, daysOut: 14, duration: "预计伤停约 2 周", expectedGames: 13 },
    { severity: "LONG" as const, daysOut: 60, duration: "预计伤停约 2 个月", expectedGames: 18 },
    { severity: "SEASON_ENDING" as const, daysOut: 130, duration: "赛季报销", expectedGames: 18 },
  ])("shows $duration and the actual remaining games in injury notices", ({ severity, daysOut, duration, expectedGames }) => {
    const state = createCareer(`injury-notice-${severity}`);
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.schedule = state.schedule
      .filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .slice(0, 18)
      .map((game, index) => ({ ...game, dateIndex: index + 1, status: "SCHEDULED" }));
    const event = { ...majorEvent(playerId, state.userTeamId), severity, daysOut, gamesOut: 61 };
    applyInjuryEvents(state, [event]);
    const missedGames = estimatedInjuryMissedGames(state, state.players[playerId]);
    expect(missedGames).toBe(expectedGames);
    expect(nextPendingEvent(state)).toBeUndefined();
    expect(state.teamNotifications?.[0].message).toContain(`${duration}，预计缺席 ${expectedGames} 场`);
    expect(state.teamNotifications?.[0].message).not.toContain("61 场");
  });

  it("never reports zero missed games for a short active injury with an upcoming game", () => {
    const state = createCareer("injury-two-days-one-game");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.schedule = state.schedule
      .filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .slice(0, 1)
      .map((game) => ({ ...game, dateIndex: state.calendar.currentDateIndex + 3, status: "SCHEDULED" as const }));
    applyInjuryEvents(state, [{ ...majorEvent(playerId, state.userTeamId), severity: "MINOR", daysOut: 2, gamesOut: 1 }]);
    expect(estimatedInjuryMissedGames(state, state.players[playerId])).toBe(1);
  });

  it("automatically adjusts rotation without requiring a manual injury decision", () => {
    const state = createCareer("injury-manual-rotation");
    const team = state.teams[state.userTeamId];
    const playerId = team.rotationPlan!.starters.PG;
    applyInjuryEvents(state, [majorEvent(playerId, team.id)]);
    expect(nextPendingEvent(state)).toBeUndefined();
    expect(state.teams[team.id].rotationPlan?.selectionMode).toBe("AUTO");
    expect(state.players[playerId].available).toBe(false);
    expect(state.teams[team.id].rotationPlan?.targetMinutes[playerId]).toBe(0);
  });

  it("counts missed games and restores availability after the final recovery day", () => {
    const state = createCareer("injury-recovery-test");
    const playerId = state.teams.ATL.playerIds[0];
    const event = majorEvent(playerId, "ATL");
    applyInjuryEvents(state, [event]);
    if (!state.players[playerId].injury) throw new Error("injury missing");
    state.players[playerId].injury.daysRemaining = 1;
    state.players[playerId].career = {
      seasonsPlayed: 0,
      totals: structuredClone(state.players[playerId].seasonStats),
      peakOverall: 70,
      peakImpact: 70,
      unemployedGameDays: 0,
      unemployedLeagueYears: 0,
      careerInjuryGamesMissed: 0,
    };

    recordInjuryMissedGames(state, ["ATL"]);
    advanceInjuriesByDays(state, 1);
    expect(state.players[playerId].injury).toBeUndefined();
    expect(state.players[playerId].available).toBe(true);
    expect(state.players[playerId].health).toBe(100);
    expect(state.players[playerId].career?.careerInjuryGamesMissed).toBe(1);
    expect(availablePlayerCount(state, "ATL")).toBeGreaterThanOrEqual(8);
  });

  it("recovers on rest days without counting a missed game", () => {
    const state = createCareer("injury-rest-day-recovery");
    const playerId = state.teams.ATL.playerIds[0];
    applyInjuryEvents(state, [majorEvent(playerId, "ATL")]);
    const player = state.players[playerId];
    if (!player.injury) throw new Error("injury missing");
    player.injury.daysRemaining = 2;
    advanceInjuriesByDays(state, 1);
    expect(player.injury?.daysRemaining).toBe(1);
    expect(player.available).toBe(false);
    advanceInjuriesByDays(state, 1);
    expect(player.injury).toBeUndefined();
    expect(player.available).toBe(true);
    expect(player.career?.careerInjuryGamesMissed ?? 0).toBe(0);
  });

  it("heals injuries across offseason free-agency days", () => {
    const state = createCareer("injury-offseason-recovery");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    state.freeAgency = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
    const playerId = state.teams.ATL.playerIds[0];
    applyInjuryEvents(state, [majorEvent(playerId, "ATL")]);
    if (!state.players[playerId].injury) throw new Error("injury missing");
    state.players[playerId].injury.daysRemaining = 2;
    const first = advanceFreeAgencyDay(state);
    expect(first.players[playerId].injury?.daysRemaining).toBe(1);
    const second = advanceFreeAgencyDay(first);
    expect(second.players[playerId].injury).toBeUndefined();
    expect(second.players[playerId].available).toBe(true);
  });

  it("uses the remaining offseason days when the manager closes free agency early", () => {
    const state = createCareer("injury-early-market-close");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    state.freeAgency = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
    const playerId = state.teams.ATL.playerIds[0];
    applyInjuryEvents(state, [majorEvent(playerId, "ATL")]);
    if (!state.players[playerId].injury) throw new Error("injury missing");
    state.players[playerId].injury.daysRemaining = 30;
    const closed = closeFreeAgency(state);
    expect(closed.league.currentPhase).toBe("PRESEASON");
    expect(closed.players[playerId].injury).toBeUndefined();
  });

  it("estimates missed games from scheduled dates while recovery follows days", () => {
    const state = createCareer("injury-schedule-estimate");
    const playerId = state.teams.ATL.playerIds[0];
    applyInjuryEvents(state, [{ ...majorEvent(playerId, "ATL"), daysOut: 3 }]);
    const player = state.players[playerId];
    state.schedule = state.schedule.slice(0, 2).map((game, index) => ({
      ...game, dateIndex: index === 0 ? 0 : 4, homeTeamId: "ATL", awayTeamId: "BOS", status: "SCHEDULED",
    }));
    expect(player.injury?.daysRemaining).toBe(3);
    expect(estimatedInjuryMissedGames(state, player)).toBe(1);
    advanceInjuriesByDays(state, 3);
    expect(player.injury).toBeUndefined();
  });

  it("fills a sixth rotation spot when an injury removes one of six planned players", () => {
    const state = createCareer("six-player-injury-rotation");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    if (!team.rotationPlan) throw new Error("Expected rotation plan");
    const starterIds = Object.values(team.rotationPlan.starters);
    const reserve = players.find((player) => !starterIds.includes(player.id) && player.available);
    if (!reserve) throw new Error("Expected healthy reserve");
    team.rotationPlan = {
      ...team.rotationPlan,
      selectionMode: "MANUAL",
      targetMinutes: Object.fromEntries(players.map((player) => [player.id, starterIds.includes(player.id) || player.id === reserve.id ? 40 : 0])),
    };
    validateRotationPlan(players, team.rotationPlan);
    applyRotationPlanToPlayers(players, team.rotationPlan);
    applyInjuryEvents(state, [majorEvent(reserve.id, state.userTeamId)]);
    const effective = normalizeRotationPlan(players, team.rotationPlan);
    expect(effective.targetMinutes[reserve.id]).toBe(0);
    expect(players.filter((player) => (effective.targetMinutes[player.id] ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
    expect(Object.values(effective.targetMinutes).reduce((sum, minutes) => sum + minutes, 0)).toBe(240);
  });
});
