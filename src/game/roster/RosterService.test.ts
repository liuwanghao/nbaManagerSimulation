import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { lockOpeningRoster, setTeamRole, setTrainingFocus, waivePlayer } from "./RosterService";

describe("RosterService", () => {
  it("waives a player into UFA and records guaranteed salary as dead money", () => {
    const state = createCareer("waive-test");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    const playerId = state.teams[state.userTeamId].playerIds.find((id) => state.players[id].contract.status === "STANDARD") as string;
    const next = waivePlayer(state, playerId);
    expect(next.teams[next.userTeamId].playerIds).not.toContain(playerId);
    expect(next.players[playerId].teamId).toBe("FREE_AGENT");
    expect(next.players[playerId].birdYears).toBe(0);
    expect(next.capState.deadMoney.some((entry) => entry.teamId === next.userTeamId)).toBe(true);
  });

  it("requires minimum-fill confirmation and opens a valid 82-game schedule", () => {
    let state = createCareer("roster-lock-test");
    state.league.currentPhase = "PRESEASON";
    for (let index = 0; index < 2; index += 1) state = waivePlayer(state, state.teams[state.userTeamId].playerIds[0]);
    const before = stableHash(stableSerialize(state));
    expect(() => lockOpeningRoster(state, false)).toThrow(/MINIMUM_FILL_CONFIRMATION_REQUIRED/);
    expect(stableHash(stableSerialize(state))).toBe(before);
    const locked = lockOpeningRoster(state, true);
    expect(locked.league.currentPhase).toBe("REGULAR_PRE_DEADLINE");
    expect(locked.teams[locked.userTeamId].playerIds.length).toBeGreaterThanOrEqual(14);
    expect(locked.schedule).toHaveLength(1312);
    expect(locked.eventState.queue.map((event) => event.definitionId)).toContain("franchise_season_opening_001");
  });

  it("limits the user to two preseason development assignments", () => {
    let state = createCareer("training-limit-test");
    state.league.currentPhase = "PRESEASON";
    const [first, second, third] = state.teams[state.userTeamId].playerIds;
    state = setTrainingFocus(state, first, "SHOOTING");
    state = setTrainingFocus(state, second, "DEFENSE");
    expect(state.trainingPlan?.assignments).toEqual({ [first]: "SHOOTING", [second]: "DEFENSE" });
    expect(() => setTrainingFocus(state, third, "ATHLETICISM")).toThrow(/TRAINING_FOCUS_LIMIT_REACHED/);
    state = setTrainingFocus(state, first, "PLAYMAKING");
    state = setTrainingFocus(state, second, null);
    state = setTrainingFocus(state, third, "ATHLETICISM");
    expect(state.trainingPlan?.assignments).toEqual({ [first]: "PLAYMAKING", [third]: "ATHLETICISM" });
  });

  it("lets the manager change team roles while enforcing three franchise cores", () => {
    let state = createCareer("team-role-limit-test");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const roster = state.teams[state.userTeamId].playerIds;
    roster.forEach((id) => { state.players[id].teamRole = "ROTATION"; });
    state = setTeamRole(state, roster[0], "FRANCHISE_CORE");
    state = setTeamRole(state, roster[1], "FRANCHISE_CORE");
    state = setTeamRole(state, roster[2], "FRANCHISE_CORE");
    expect(() => setTeamRole(state, roster[3], "FRANCHISE_CORE")).toThrow(/FRANCHISE_CORE_LIMIT_REACHED/);
    expect(state.players[roster[3]].teamRole).toBe("ROTATION");
  });
});
