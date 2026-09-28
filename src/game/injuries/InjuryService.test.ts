import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { advanceInjuriesAfterGames, applyInjuryEvents, availablePlayerCount } from "../simulation/injuries";
import { solveRotationSeconds } from "../simulation/minutes";
import { applyRotationPlanToPlayers, buildDefaultRotationPlan, normalizeRotationPlan, validateRotationPlan } from "../roster/RotationPlanService";
import { setRotationPlan } from "../roster/RosterService";
import { executeEventCommand, nextPendingEvent } from "../events/EventService";
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
  it("offers automatic rotation adjustments for both injury and recovery", () => {
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
    const injuryChoice = nextPendingEvent(state);
    expect(injuryChoice?.definitionId).toBe("injury_core_major_001");
    expect(injuryChoice?.choices.map((choice) => choice.id)).toEqual(["auto_adjust", "manual_adjust"]);
    expect(state.teams[state.userTeamId].playerIds.filter((id) => state.players[id].rotationRole === "STARTER")).toHaveLength(5);
    expect(state.teams[state.userTeamId].rotationPlan).toEqual(originalPlan);
    const adjusted = executeEventCommand(state, { commandId: "injury-auto", type: "RESOLVE_EVENT", payload: { eventInstanceId: injuryChoice!.eventInstanceId, choiceId: "auto_adjust" } });
    const roster = adjusted.teams[adjusted.userTeamId].playerIds.map((id) => adjusted.players[id]);
    expect(adjusted.teams[adjusted.userTeamId].rotationPlan?.selectionMode).toBe("AUTO");
    expect(adjusted.teamNotifications).toContainEqual(expect.objectContaining({ title: "核心球员受伤", read: false }));
    const injuredMinutes = solveRotationSeconds(roster, false, adjusted.teams[adjusted.userTeamId].rotationPlan);
    expect(injuredMinutes[playerId] ?? 0).toBe(0);
    expect(Object.values(injuredMinutes).reduce((sum, seconds) => sum + seconds, 0)).toBe(240 * 60);
    if (!adjusted.players[playerId].injury) throw new Error("Expected injury");
    adjusted.players[playerId].injury.gamesRemaining = 1;
    advanceInjuriesAfterGames(adjusted, [adjusted.userTeamId], new Set());
    expect(adjusted.players[playerId].injury).toBeUndefined();
    const recoveryChoice = nextPendingEvent(adjusted);
    expect(recoveryChoice?.definitionId).toBe("injury_recovery_001");
    expect(recoveryChoice?.choices.map((choice) => choice.id)).toEqual(["auto_adjust", "manual_adjust"]);
    const recovered = executeEventCommand(adjusted, { commandId: "recovery-auto", type: "RESOLVE_EVENT", payload: { eventInstanceId: recoveryChoice!.eventInstanceId, choiceId: "auto_adjust" } });
    expect(solveRotationSeconds(roster, false, recovered.teams[recovered.userTeamId].rotationPlan)[playerId]).toBeGreaterThan(0);
    expect(recovered.teamNotifications).toContainEqual(expect.objectContaining({ title: "伤员回归", read: false }));
  });

  it("keeps an injury decision pending until a manual rotation is saved", () => {
    const state = createCareer("injury-manual-rotation");
    const team = state.teams[state.userTeamId];
    const playerId = team.rotationPlan!.starters.PG;
    applyInjuryEvents(state, [majorEvent(playerId, team.id)]);
    const event = nextPendingEvent(state)!;
    expect(() => executeEventCommand(state, {
      commandId: "manual-before-save", type: "RESOLVE_EVENT",
      payload: { eventInstanceId: event.eventInstanceId, choiceId: "manual_adjust" },
    })).toThrow();
    const roster = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(roster);
    const benchOrder = [...plan.benchOrder!];
    [benchOrder[0], benchOrder[1]] = [benchOrder[1], benchOrder[0]];
    const saved = setRotationPlan(state, { ...plan, benchOrder, selectionMode: "MANUAL" });
    const resolved = executeEventCommand(saved, {
      commandId: "manual-after-save", type: "RESOLVE_EVENT",
      payload: { eventInstanceId: event.eventInstanceId, choiceId: "manual_adjust" },
    });
    expect(resolved.teams[team.id].rotationPlan?.selectionMode).toBe("MANUAL");
    expect(resolved.eventState.queue).toEqual([]);
    expect(resolved.players[playerId].available).toBe(false);
    expect(resolved.teams[team.id].rotationPlan?.targetMinutes[playerId]).toBe(0);
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
