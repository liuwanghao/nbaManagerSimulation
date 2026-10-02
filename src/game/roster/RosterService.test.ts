import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { getFreeAgents } from "../freeAgency/FreeAgencyService";
import { getCapSheet } from "../cap/CapSheetService";
import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { SaveService } from "../../storage/SaveService";
import { MemoryStorageAdapter } from "../../platform/storage/StorageAdapter";
import { executeRosterCommand, lockOpeningRoster, setTeamRole, setTrainingFocus, waivePlayer } from "./RosterService";

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
    expect(locked.eventState.queue.map((event) => event.definitionId)).not.toContain("franchise_season_opening_001");
    expect(locked.teamNotifications).toEqual([expect.objectContaining({ title: "开幕名单已自动补齐", read: false })]);
  });

  it.each([false, true])("fills only low-ability players and notifies the user (low free agent available: %s)", (hasLowFreeAgent) => {
    const state = createCareer(`safe-opening-fill-${hasLowFreeAgent}`);
    state.league.currentPhase = "PRESEASON";
    const team = state.teams[state.userTeamId];
    const released = team.playerIds.splice(12);
    const aiTeam = state.teams.BOS;
    released.push(...aiTeam.playerIds.splice(12));
    for (const id of released) {
      state.players[id].teamId = "FREE_AGENT";
      state.players[id].contract.status = "UFA";
      state.players[id].available = true;
    }
    for (const player of Object.values(state.players).filter((entry) => entry.teamId === "FREE_AGENT")) {
      player.overallAdjustment = 97 - calculatePlayerOverall(player);
    }
    const low = state.players[released[0]];
    if (hasLowFreeAgent) low.overallAdjustment = (low.overallAdjustment ?? 0) - 33;
    const originalIds = new Set(team.playerIds);
    const before = stableSerialize(state);
    const opened = lockOpeningRoster(state, true);
    expect(stableSerialize(state)).toBe(before);
    const additions = opened.teams[team.id].playerIds.filter((id) => !originalIds.has(id)).map((id) => opened.players[id]);
    expect(additions).toHaveLength(2);
    expect(additions.every((player) => calculatePlayerOverall(player) <= 65)).toBe(true);
    const aiAdditions = opened.teams.BOS.playerIds.filter((id) => !aiTeam.playerIds.includes(id));
    expect(aiAdditions).toHaveLength(2);
    expect(aiAdditions.every((id) => calculatePlayerOverall(opened.players[id]) <= 65)).toBe(true);
    const allRosterIds = Object.values(opened.teams).flatMap((entry) => entry.playerIds);
    expect(new Set(allRosterIds).size).toBe(allRosterIds.length);
    if (hasLowFreeAgent) expect(additions.map((player) => player.id)).toContain(low.id);
    expect(released.slice(hasLowFreeAgent ? 1 : 0).every((id) => opened.players[id].teamId === "FREE_AGENT")).toBe(true);
    const notice = opened.teamNotifications?.find((item) => item.title === "开幕名单已自动补齐");
    expect(notice?.read).toBe(false);
    expect(notice?.message).toContain("14 人");
    expect(notice?.message).toContain("一年底薪");
    for (const player of additions) {
      expect(notice?.message).toContain(player.name);
      expect(notice?.message).toContain(String(Math.round(calculatePlayerOverall(player))));
      expect(player.contract.salary).toBe(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary);
      expect(player.teamRole).toBe("BENCH");
    }
    if (!hasLowFreeAgent) expect(stableSerialize(lockOpeningRoster(state, true))).toBe(stableSerialize(opened));
  });

  it("does not send a fill notice when the opening roster is already complete", () => {
    const state = createCareer("no-opening-fill");
    state.league.currentPhase = "PRESEASON";
    expect(lockOpeningRoster(state, true).teamNotifications).toEqual([]);
  });

  it("preserves replacement signings and the unread notice through command replay and save reload", async () => {
    let state = createCareer("opening-fill-save-replay");
    state.league.currentPhase = "PRESEASON";
    while (state.teams[state.userTeamId].playerIds.length >= 14) state = waivePlayer(state, state.teams[state.userTeamId].playerIds[0]);
    const command = { commandId: "safe-opening-once", type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } } as const;
    const opened = executeRosterCommand(state, command);
    expect(executeRosterCommand(opened, command)).toBe(opened);
    const notice = opened.teamNotifications?.find((entry) => entry.title === "开幕名单已自动补齐")!;
    const service = new SaveService(new MemoryStorageAdapter());
    await service.save(1, opened);
    const restored = (await service.load(1))!;
    expect(restored.teams[state.userTeamId].playerIds).toEqual(opened.teams[state.userTeamId].playerIds);
    expect(restored.teamNotifications).toContainEqual(notice);
    expect(notice.read).toBe(false);
    expect(executeRosterCommand(restored, command)).toBe(restored);
    expect(restored.teamNotifications?.filter((entry) => entry.id === notice.id)).toHaveLength(1);
  });

  it("starts the new regular season with rested players", () => {
    const state = createCareer("opening-fatigue-reset");
    state.league.currentPhase = "PRESEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].fatigue = 75;
    const opened = lockOpeningRoster(state, true);
    expect(state.players[playerId].fatigue).toBe(75);
    expect(Object.values(opened.players).every((player) => player.fatigue === 0)).toBe(true);
  });

  it("transfers Bird rights on minimum-salary free-agent fills and keeps them for the original team", () => {
    for (const originalTeamIsUser of [false, true]) {
      let state = createCareer(`minimum-bird-${originalTeamIsUser}`);
      state.league.currentPhase = "PRESEASON";
      while (state.teams[state.userTeamId].playerIds.length >= 14) {
        state = waivePlayer(state, state.teams[state.userTeamId].playerIds[0]);
      }
      const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
      if (!player) throw new Error("Free agent required for roster fill");
      for (const candidate of getFreeAgents(state)) candidate.overallAdjustment = 70 - calculatePlayerOverall(candidate);
      player.overallAdjustment = (player.overallAdjustment ?? 0) - 6;
      const originalBirdTeam = originalTeamIsUser ? state.userTeamId
        : Object.keys(state.teams).find((teamId) => teamId !== state.userTeamId)!;
      player.birdTeamId = originalBirdTeam;
      player.birdYears = 4;
      const opened = lockOpeningRoster(state, true);
      expect(opened.players[player.id]).toMatchObject({
        teamId: state.userTeamId, birdTeamId: state.userTeamId, birdYears: originalTeamIsUser ? 4 : 1,
      });
    }
  });

  it("does not queue the expansion opening screen in a later season", () => {
    const state = createCareer("later-season-opening");
    state.league.currentPhase = "PRESEASON";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    const locked = lockOpeningRoster(state, true);
    expect(locked.league.currentPhase).toBe("REGULAR_PRE_DEADLINE");
    expect(locked.eventState.queue.some((event) => event.definitionId === "franchise_season_opening_001")).toBe(false);
  });

  it("records a season-specific salary-floor shortfall without blocking opening day", () => {
    const state = createCareer("opening-salary-floor");
    state.league.currentPhase = "PRESEASON";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    const teamId = state.userTeamId;
    for (const playerId of state.teams[teamId].playerIds) state.players[playerId].contract.salary = 1_000_000;
    const opened = lockOpeningRoster(state, true);
    const payroll = getCapSheet(state, teamId).activeContractSalary + getCapSheet(state, teamId).deadMoney;
    const expected = Math.max(0, getSeasonFinanceConfig(2027).minimumTeamSalary - payroll);
    expect(opened.league.currentPhase).toBe("REGULAR_PRE_DEADLINE");
    expect(opened.capState.salaryFloorShortfalls).toContainEqual({ teamId, seasonId: "2027-28", amount: expected });
    expect(getCapSheet(opened, teamId).salaryFloorShortfall).toBe(expected);
    expect(state.capState.salaryFloorShortfalls).toBeUndefined();
  });

  it("welcomes an expansion franchise once when its first regular season opens", () => {
    const state = createCareer("expansion-welcome");
    state.league.currentPhase = "PRESEASON";
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    const locked = lockOpeningRoster(state, true);
    expect(locked.eventState.queue.map((event) => event.definitionId)).toContain("franchise_season_opening_001");
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

  it("discards departed and missing-player training assignments before counting slots", () => {
    let state = createCareer("stale-training-slots");
    state.league.currentPhase = "PRESEASON";
    const [first, second, staleRosterId] = state.teams[state.userTeamId].playerIds;
    const departed = state.teams.CHA.playerIds[0];
    state.players[staleRosterId].teamId = "CHA";
    state.trainingPlan = { seasonId: state.league.seasonId, assignments: {
      [departed]: "SHOOTING", [staleRosterId]: "DEFENSE", missing: "BALANCED",
    } };
    const original = structuredClone(state);
    state = setTrainingFocus(state, first, "SHOOTING");
    state = setTrainingFocus(state, second, "DEFENSE");
    expect(state.trainingPlan?.assignments).toEqual({ [first]: "SHOOTING", [second]: "DEFENSE" });
    expect(original.trainingPlan?.assignments).toHaveProperty(departed);
    expect(() => setTrainingFocus(state, staleRosterId, "BALANCED")).toThrow("TRAINING_PLAYER_NOT_ON_USER_ROSTER");
  });

  it("keeps repeated training commands idempotent after another intent and reload", () => {
    let state = createCareer("training-command-retry");
    state.league.currentPhase = "PRESEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    const command = { commandId: "first-training-intent", type: "SET_TRAINING_FOCUS" as const, payload: { playerId, focus: "SHOOTING" as const } };
    state = executeRosterCommand(state, command);
    state = executeRosterCommand(state, { commandId: "second-training-intent", type: "SET_TRAINING_FOCUS", payload: { playerId, focus: "DEFENSE" } });
    state = JSON.parse(JSON.stringify(state));
    expect(executeRosterCommand(state, command)).toBe(state);
    expect(state.trainingPlan?.assignments[playerId]).toBe("DEFENSE");
  });

  it("removes a waived player's training assignment before they can return", () => {
    let state = createCareer("waived-training");
    state.league.currentPhase = "PRESEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state = setTrainingFocus(state, playerId, "SHOOTING");
    state = waivePlayer(state, playerId);
    expect(state.trainingPlan?.assignments).toEqual({});
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
