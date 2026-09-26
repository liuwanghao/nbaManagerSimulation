import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { getFreeAgents } from "../freeAgency/FreeAgencyService";
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
    expect(Object.values(next.teams[next.userTeamId].rotationPlan!.starters)).not.toContain(playerId);
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
    expect(locked.teamNotifications).toEqual([]);
  });

  it("welcomes an expansion franchise once when its first regular season opens", () => {
    const state = createCareer("expansion-welcome");
    state.league.currentPhase = "PRESEASON";
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    const locked = lockOpeningRoster(state, true);
    expect(locked.teamNotifications).toEqual([expect.objectContaining({
      id: `expansion-welcome-${state.league.seasonId}`,
      title: `新球队诞生：${state.teams[state.userTeamId].fullName}`,
      date: state.calendar.openingDate,
    })]);
    expect(locked.teamNotifications?.[0].message).toContain("阵容");
  });

  it("keeps guaranteed veterans when AI teams trim oversized opening rosters", () => {
    const state = createExpansionCareerFromBundledDataset("ai-opening-roster-guarantees");
    state.league.currentPhase = "PRESEASON";
    for (const [index, player] of getFreeAgents(state).slice(0, 6).entries()) {
      const teamId = index < 4 ? "BOS" : "MEM";
      player.teamId = teamId;
      player.contract = { salary: 2_000_000, yearsRemaining: 1, guaranteedAmount: 2_000_000,
        status: "STANDARD", optionType: "NONE", optionDecision: "NOT_APPLICABLE" };
      state.teams[teamId].playerIds.push(player.id);
    }
    expect(state.teams.BOS.playerIds).toHaveLength(21);
    expect(state.teams.MEM.playerIds).toHaveLength(21);

    const locked = lockOpeningRoster(state, true);
    expect(locked.teams.BOS.playerIds).toHaveLength(15);
    expect(locked.teams.MEM.playerIds).toHaveLength(15);
    expect(locked.teams.BOS.playerIds).toContain("nba:202331");
    expect(locked.teams.MEM.playerIds).toContain("nba:203924");
    expect(locked.players["nba:203924"]).toMatchObject({ teamId: "MEM", contract: { status: "STANDARD" } });
    expect(locked.players["nba:202331"]).toMatchObject({ teamId: "BOS", contract: { status: "STANDARD" } });
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
