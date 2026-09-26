import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { advanceInjuriesAfterGames, applyInjuryEvents, availablePlayerCount } from "../simulation/injuries";
import { solveRotationSeconds } from "../simulation/minutes";
import { applyRotationPlanToPlayers, normalizeRotationPlan, validateRotationPlan } from "../roster/RotationPlanService";
import type { InjuryEvent } from "../state/types";

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
  it("notifies a franchise-core major injury and automatically adjusts the rotation", () => {
    const state = createCareer("major-injury-test");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].teamRole = "FRANCHISE_CORE";
    const event = majorEvent(playerId, state.userTeamId);
    const originalPlan = structuredClone(state.teams[state.userTeamId].rotationPlan);
    applyInjuryEvents(state, [event]);

    expect(state.players[playerId].available).toBe(false);
    expect(state.players[playerId].health).toBe(35);
    expect(state.players[playerId].rotationRole).toBe("OUT");
    expect(state.injuryState.pendingUserMajorInjury).toBeUndefined();
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({
      title: "核心球员受伤", message: expect.stringContaining("首发与轮换已自动调整"), read: false,
    }));
    expect(state.teams[state.userTeamId].playerIds.filter((id) => state.players[id].rotationRole === "STARTER")).toHaveLength(5);
    expect(state.teams[state.userTeamId].rotationPlan).toEqual(originalPlan);
    const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const injuredMinutes = solveRotationSeconds(roster, false, state.teams[state.userTeamId].rotationPlan);
    expect(injuredMinutes[playerId] ?? 0).toBe(0);
    expect(Object.values(injuredMinutes).reduce((sum, seconds) => sum + seconds, 0)).toBe(240 * 60);
    if (!state.players[playerId].injury) throw new Error("Expected injury");
    state.players[playerId].injury.gamesRemaining = 1;
    advanceInjuriesAfterGames(state, [state.userTeamId], new Set());
    expect(state.players[playerId].injury).toBeUndefined();
    expect(state.teams[state.userTeamId].rotationPlan).toEqual(originalPlan);
    expect(solveRotationSeconds(roster, false, state.teams[state.userTeamId].rotationPlan)[playerId]).toBeGreaterThan(0);
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({
      title: "伤员回归", message: expect.stringContaining("已自动重新调整"), read: false,
    }));
  });

  it("counts missed games and restores availability after the final missed game", () => {
    const state = createCareer("injury-recovery-test");
    const playerId = state.teams.ATL.playerIds[0];
    const event = majorEvent(playerId, "ATL");
    applyInjuryEvents(state, [event]);
    if (!state.players[playerId].injury) throw new Error("injury missing");
    state.players[playerId].injury.gamesRemaining = 1;
    state.players[playerId].career = {
      seasonsPlayed: 0,
      totals: structuredClone(state.players[playerId].seasonStats),
      peakOverall: 70,
      peakImpact: 70,
      unemployedGameDays: 0,
      unemployedLeagueYears: 0,
      careerInjuryGamesMissed: 0,
    };

    advanceInjuriesAfterGames(state, ["ATL"], new Set());
    expect(state.players[playerId].injury).toBeUndefined();
    expect(state.players[playerId].available).toBe(true);
    expect(state.players[playerId].health).toBe(100);
    expect(state.players[playerId].career?.careerInjuryGamesMissed).toBe(1);
    expect(availablePlayerCount(state, "ATL")).toBeGreaterThanOrEqual(8);
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
    expect(players.filter((player) => (effective.targetMinutes[player.id] ?? 0) > 0)).toHaveLength(6);
    expect(Object.values(effective.targetMinutes).reduce((sum, minutes) => sum + minutes, 0)).toBe(240);
  });
});
