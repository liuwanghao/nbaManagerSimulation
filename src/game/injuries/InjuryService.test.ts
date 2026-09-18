import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { advanceInjuriesAfterGames, applyInjuryEvents, availablePlayerCount } from "../simulation/injuries";
import type { InjuryEvent } from "../state/types";
import { executeInjuryCommand } from "./InjuryService";

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
  it("pauses for a franchise-core major injury and acknowledges it idempotently", () => {
    const state = createCareer("major-injury-test");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].teamRole = "FRANCHISE_CORE";
    const event = majorEvent(playerId, state.userTeamId);
    applyInjuryEvents(state, [event]);

    expect(state.players[playerId].available).toBe(false);
    expect(state.players[playerId].health).toBe(35);
    expect(state.players[playerId].rotationRole).toBe("OUT");
    expect(state.injuryState.pendingUserMajorInjury?.injuryId).toBe(event.injuryId);
    expect(state.teams[state.userTeamId].playerIds.filter((id) => state.players[id].rotationRole === "STARTER")).toHaveLength(5);

    const command = { commandId: "ack-major", type: "ACKNOWLEDGE_MAJOR_INJURY" as const, payload: { injuryId: event.injuryId } };
    const acknowledged = executeInjuryCommand(state, command);
    expect(acknowledged.injuryState.pendingUserMajorInjury).toBeUndefined();
    expect(executeInjuryCommand(acknowledged, command)).toEqual(acknowledged);
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
});
