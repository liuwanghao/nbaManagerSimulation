import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import { stableHash, stableSerialize } from "../random/hash";
import { createExpansionCareer } from "../season/career";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import type { ExpansionCityId, GameState } from "../state/types";
import {
  executeExpansionCommand,
  getExpansionDraftCandidatePlayers,
  getSelectableExpansionPlayers,
  type ExpansionCommand,
} from "./ExpansionService";

function dispatch(state: GameState, command: ExpansionCommand): GameState {
  return executeExpansionCommand(state, command);
}

function createTeam(seed: string, cityId: ExpansionCityId = "SEA"): GameState {
  const preset = EXPANSION_BRAND_PRESETS[cityId][0];
  return dispatch(createExpansionCareer(seed), {
    commandId: "create-team",
    type: "CREATE_EXPANSION_TEAM",
    payload: {
      cityId,
      presetId: preset.presetId,
      teamName: preset.teamName,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
    },
  });
}

function reachTrade(seed: string): GameState {
  let state = createTeam(seed);
  if (!state.expansion?.rightsDraw.resolved) {
    state = dispatch(state, { commandId: "choose-package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
  }
  state = dispatch(state, { commandId: "resolve-options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  return dispatch(state, { commandId: "prepare-trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
}

function reachBundledTrade(seed: string): GameState {
  const preset = EXPANSION_BRAND_PRESETS.SEA[0];
  let state = dispatch(createExpansionCareerFromBundledDataset(seed), {
    commandId: "create-bundled-team",
    type: "CREATE_EXPANSION_TEAM",
    payload: {
      cityId: "SEA",
      presetId: preset.presetId,
      teamName: preset.teamName,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
    },
  });
  state = dispatch(state, { commandId: "choose-bundled-package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
  state = dispatch(state, { commandId: "resolve-bundled-options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  return dispatch(state, { commandId: "prepare-bundled-trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
}

function finishDraft(seed: string): GameState {
  let state = reachTrade(seed);
  const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === state.userTeamId && entry.status === "AVAILABLE");
  if (offer) state = dispatch(state, { commandId: `accept-${offer.id}`, type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer.id } });
  state = dispatch(state, { commandId: "start-draft", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const expectedPickNumber = (state.expansion?.currentPickIndex ?? 0) + 1;
    const player = getSelectableExpansionPlayers(state)[0];
    expect(player).toBeDefined();
    state = dispatch(state, {
      commandId: `pick-${expectedPickNumber}-${player.id}`,
      type: "SELECT_EXPANSION_PLAYER",
      payload: { playerId: player.id, expectedPickNumber },
    });
  }
  return state;
}

describe("Stage 3 expansion flow", () => {
  it("creates empty expansion rosters and rejects an invalid team name without mutation", () => {
    const initial = createExpansionCareer("stage3-invalid-name");
    expect(initial.teams.SEA.playerIds).toHaveLength(0);
    expect(initial.teams.LVG.playerIds).toHaveLength(0);
    const before = stableHash(stableSerialize(initial));
    expect(() => dispatch(initial, {
      commandId: "bad-name",
      type: "CREATE_EXPANSION_TEAM",
      payload: { cityId: "SEA", presetId: "sea-emerald-tide", teamName: "<script>", primaryColor: "#19d3ae", secondaryColor: "#072e33" },
    })).toThrow(/不允许/);
    expect(() => dispatch(initial, {
      commandId: "numeric-only-name",
      type: "CREATE_EXPANSION_TEAM",
      payload: { cityId: "SEA", presetId: "sea-emerald-tide", teamName: "111", primaryColor: "#19d3ae", secondaryColor: "#072e33" },
    })).toThrow(/不能仅由数字组成/);
    expect(stableHash(stableSerialize(initial))).toBe(before);
  });

  it("reproduces AI brand and strategy while leaving rights for the player to choose", () => {
    const first = createTeam("stage3-rights");
    const second = createTeam("stage3-rights");
    expect(first.expansion?.aiStrategy).toBe(second.expansion?.aiStrategy);
    expect(first.expansion?.brands.LVG).toEqual(second.expansion?.brands.LVG);
    expect(first.expansion?.rightsDraw).toEqual(second.expansion?.rightsDraw);
    expect(first.expansion?.rightsDraw.resolved).toBe(false);
    expect(first.expansion?.rightsDraw.packageByTeam).toEqual({});
    expect(first.expansion?.rightsDraw.winnerTeamId).toBe(first.expansion?.playerTeamId);
  });

  it("assigns the selected rights package to the player and the other package to the AI", () => {
    const created = createTeam("stage3-player-package-choice");
    const chosen = dispatch(created, { commandId: "choose-player-rights-package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "B" } });
    const playerTeamId = chosen.expansion?.playerTeamId as ExpansionCityId;
    const aiTeamId = chosen.expansion?.aiTeamId as ExpansionCityId;
    expect(chosen.expansion?.rightsDraw.packageByTeam[playerTeamId]).toBe("B");
    expect(chosen.expansion?.rightsDraw.packageByTeam[aiTeamId]).toBe("A");
    expect(chosen.expansion?.rightsDraw.resolved).toBe(true);
    expect(chosen.league.currentPhase).toBe("EXPANSION_RIGHTS");
  });

  it("assigns the fixed city logo to both expansion teams", () => {
    const state = createTeam("stage3-fixed-city-logos");
    expect(EXPANSION_BRAND_PRESETS.SEA).toHaveLength(1);
    expect(EXPANSION_BRAND_PRESETS.LVG).toHaveLength(1);
    expect(state.teams.SEA.logoUrl).toBe("./expansion-logos/seattle-default.png");
    expect(state.teams.LVG.logoUrl).toBe("./expansion-logos/las-vegas-default.png");
    expect(state.teams.SEA.fullName).toBe("西雅图超音速");
    expect(state.teams.LVG.fullName).toBe("拉斯维加斯幻影");
  });

  it("uses the submitted team name instead of the city preset name", () => {
    const initial = createExpansionCareer("stage3-custom-team-name");
    const preset = EXPANSION_BRAND_PRESETS.SEA[0];
    const state = dispatch(initial, {
      commandId: "create-custom-team-name",
      type: "CREATE_EXPANSION_TEAM",
      payload: {
        cityId: "SEA",
        presetId: preset.presetId,
        teamName: "雨城先锋",
        primaryColor: preset.primaryColor,
        secondaryColor: preset.secondaryColor,
      },
    });
    expect(state.teams.SEA.name).toBe("雨城先锋");
    expect(state.teams.SEA.fullName).toBe("西雅图雨城先锋");
    expect(state.teams.LVG.fullName).toBe("拉斯维加斯幻影");
  });

  it("uses the Seattle default name when Las Vegas is player-controlled", () => {
    const state = createTeam("stage3-seattle-ai-default", "LVG");
    expect(state.teams.SEA.fullName).toBe("西雅图超音速");
    expect(state.teams.LVG.fullName).toBe("拉斯维加斯幻影");
  });

  it("atomically settles options and opens draft preparation after the rights choice", () => {
    const created = createTeam("stage3-draw-to-draft-prep");
    const state = dispatch(created, {
      commandId: "enter-expansion-draft-prep",
      type: "ENTER_EXPANSION_DRAFT_PREP",
      payload: { packageId: created.expansion?.rightsDraw.resolved ? undefined : "A" },
    });
    expect(state.league.currentPhase).toBe("EXPANSION_TRADE");
    expect(state.expansion?.rightsDraw.resolved).toBe(true);
    expect(state.expansion?.optionPhaseResolved).toBe(true);
    expect(state.expansion?.tradeOffers.length).toBeGreaterThan(0);
    expect(Object.keys(state.expansion?.protectionLists ?? {})).toHaveLength(30);
  });

  it("requires the deterministic Option Phase before protection freeze", () => {
    let state = createTeam("stage3-option-gate");
    if (!state.expansion?.rightsDraw.resolved) {
      state = dispatch(state, { commandId: "choose-option-gate", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
    }
    expect(() => dispatch(state, { commandId: "prepare-too-early", type: "PREPARE_EXPANSION_TRADE", payload: {} })).toThrow(/not allowed/);
    const resolved = dispatch(state, { commandId: "resolve-option-gate", type: "RESOLVE_OPTION_PHASE", payload: {} });
    expect(resolved.league.currentPhase).toBe("OPTION_PHASE");
    expect(resolved.expansion?.optionPhaseResolved).toBe(true);
  });

  it("freezes 30 protection lists, each with exactly eight protected players", () => {
    const state = reachTrade("stage3-protection");
    const lists = Object.values(state.expansion?.protectionLists ?? {});
    expect(lists).toHaveLength(30);
    for (const list of lists) {
      expect(list.protectedPlayerIds).toHaveLength(8);
      expect(list.exposedPlayerIds.length).toBeGreaterThanOrEqual(1);
    }
    expect(state.expansion?.tradeOffers).toHaveLength(60);
    expect(Object.values(state.players).some((player) => player.contract.optionDecision === "PENDING")).toBe(false);
    for (const list of lists) {
      for (const playerId of [...list.protectedPlayerIds, ...list.exposedPlayerIds]) {
        expect(state.players[playerId].contract.status).toBe("STANDARD");
      }
    }
  });

  it("protects Anthony Davis as an elite short-term veteran asset", () => {
    const state = reachBundledTrade("stage3-protect-davis");
    expect(state.expansion?.protectionLists.WAS.protectedPlayerIds).toContain("nba:203076");
  });

  it("protects expiring Jimmy Butler for a competitive team but allows a rebuild to expose him", () => {
    const competitive = reachBundledTrade("stage3-protect-butler-competitive");
    expect(competitive.expansion?.protectionLists.GSW.protectedPlayerIds).toContain("nba:202710");

    let rebuild = createExpansionCareerFromBundledDataset("stage3-expose-butler-rebuild");
    rebuild.aiTeamProfiles.GSW.direction = "REBUILD";
    const preset = EXPANSION_BRAND_PRESETS.SEA[0];
    rebuild = dispatch(rebuild, {
      commandId: "create-rebuild-team",
      type: "CREATE_EXPANSION_TEAM",
      payload: { cityId: "SEA", presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
    });
    rebuild = dispatch(rebuild, { commandId: "choose-rebuild-package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
    rebuild = dispatch(rebuild, { commandId: "resolve-rebuild-options", type: "RESOLVE_OPTION_PHASE", payload: {} });
    rebuild = dispatch(rebuild, { commandId: "prepare-rebuild-trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
    expect(rebuild.expansion?.protectionLists.GSW.protectedPlayerIds).not.toContain("nba:202710");
  });

  it("reserves a trade atomically and makes command retries idempotent", () => {
    const state = reachTrade("stage3-trade");
    const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === state.userTeamId && entry.status === "AVAILABLE");
    expect(offer).toBeDefined();
    const command = { commandId: "accept-once", type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer?.id as string } } as const;
    const accepted = dispatch(state, command);
    const retried = dispatch(accepted, command);
    expect(retried).toBe(accepted);
    const commitment = accepted.expansion?.commitments.find((entry) => entry.offerId === offer?.id);
    expect(commitment?.status).toBe("ACTIVE");
    expect(accepted.draftPicks[commitment?.compensationAssetIds[0] as string].reservedByCommitmentId).toBe(commitment?.id);
    expect(() => dispatch(accepted, { ...command, payload: { offerId: "different-offer" } })).toThrow(/不同 Payload/);
  });

  it("locks the complete source-team loss slot for a SELECT_PLAYER commitment", () => {
    const state = reachTrade("stage3-select-lock");
    const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === state.userTeamId
      && entry.type === "SELECT_PLAYER" && entry.status === "AVAILABLE");
    expect(offer).toBeDefined();
    const accepted = dispatch(state, { commandId: "accept-select-lock", type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer?.id as string } });
    const exposed = accepted.expansion?.protectionLists[offer?.sourceTeamId as string].exposedPlayerIds ?? [];
    expect(exposed.every((playerId) => accepted.expansion?.poolStatusByPlayerId[playerId] === "LOCKED_BY_COMMITMENT")).toBe(true);
    expect(accepted.expansion?.sourceTeamLossOwner[offer?.sourceTeamId as string]).toBe(accepted.userTeamId);
  });

  it("automatically brings a trade-designated player into the draft roster without asking for confirmation", () => {
    let state = reachTrade("stage3-player-turn-feedback");
    const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === state.userTeamId
      && entry.type === "SELECT_PLAYER" && entry.status === "AVAILABLE");
    expect(offer).toBeDefined();
    state = dispatch(state, { commandId: "accept-forced-player", type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer?.id as string } });
    expect(state.expansion?.lastNotice).toContain("自动加入阵容");
    const commitment = state.expansion?.commitments.find((entry) => entry.targetPlayerId === offer?.targetPlayerId);
    const before = stableHash(stableSerialize(state));
    const startCommand = { commandId: "start-forced-draft", type: "START_EXPANSION_DRAFT", payload: {} } as const;
    const started = dispatch(state, startCommand);

    expect(stableHash(stableSerialize(state))).toBe(before);
    expect(dispatch(started, startCommand)).toBe(started);
    const automaticPick = started.expansion?.picks.find((pick) => pick.commitmentId === commitment?.id);
    expect(automaticPick?.playerId).toBe(offer?.targetPlayerId);
    expect(automaticPick?.teamId).toBe(state.userTeamId);
    expect(started.players[offer?.targetPlayerId as string].teamId).toBe(state.userTeamId);
    expect(started.teams[state.userTeamId].playerIds).toContain(offer?.targetPlayerId);
    expect(started.expansion?.poolStatusByPlayerId[offer?.targetPlayerId as string]).toBe("SELECTED");
    expect(started.expansion?.commitments.find((entry) => entry.id === commitment?.id)?.status).toBe("FULFILLED");
    expect(started.draftPicks[commitment?.compensationAssetIds[0] as string].ownerTeamId).toBe(state.userTeamId);
    expect(started.expansion?.draftOrder[started.expansion.currentPickIndex]).toBe(state.userTeamId);
    expect(getSelectableExpansionPlayers(started).length).toBeGreaterThan(1);
    expect(getExpansionDraftCandidatePlayers(started).some((player) => player.id === offer?.targetPlayerId)).toBe(false);
  });

  it("automatically fulfills multiple designated-player agreements in accepted order", () => {
    let state = reachTrade("stage3-multiple-forced-players");
    const offers = state.expansion?.tradeOffers.filter((entry) => entry.targetExpansionTeamId === state.userTeamId
      && entry.type === "SELECT_PLAYER" && entry.status === "AVAILABLE") ?? [];
    const acceptedPlayerIds: string[] = [];
    for (const offer of offers) {
      try {
        state = dispatch(state, { commandId: `accept-${offer.id}`, type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer.id } });
        acceptedPlayerIds.push(offer.targetPlayerId);
      } catch { /* try another legal offer */ }
      if (acceptedPlayerIds.length === 2) break;
    }
    expect(acceptedPlayerIds).toHaveLength(2);

    const started = dispatch(state, { commandId: "start-multiple-forced", type: "START_EXPANSION_DRAFT", payload: {} });
    expect(started.teams[state.userTeamId].playerIds).toEqual(acceptedPlayerIds);
    expect(started.expansion?.picks.filter((pick) => pick.teamId === state.userTeamId).map((pick) => pick.playerId)).toEqual(acceptedPlayerIds);
    expect(started.expansion?.commitments.filter((entry) => entry.type === "SELECT_PLAYER" && entry.expansionTeamId === state.userTeamId).every((entry) => entry.status === "FULFILLED")).toBe(true);
    expect(started.expansion?.draftOrder[started.expansion.currentPickIndex]).toBe(state.userTeamId);
  });

  it("completes the deterministic 28-pick snake draft with unique ownership", () => {
    const state = finishDraft("stage3-complete");
    expect(state.league.currentPhase).toBe("ROOKIE_DRAFT_PENDING");
    expect(state.expansion?.picks).toHaveLength(28);
    expect(state.teams.SEA.playerIds).toHaveLength(14);
    expect(state.teams.LVG.playerIds).toHaveLength(14);
    expect(new Set(state.expansion?.picks.map((pick) => pick.playerId)).size).toBe(28);
    expect(new Set(state.expansion?.picks.map((pick) => pick.sourceTeamId)).size).toBe(28);
    expect(state.expansion?.commitments.every((entry) => entry.status === "FULFILLED")).toBe(true);
    expect(state.achievements.EXPANSION_COMPLETE.unlocked).toBe(true);
    expect(getCapSheet(state, "SEA").total).toBeLessThanOrEqual(LEAGUE_FINANCE_CONFIG.expansionDraftSalaryLimit);
    expect(getCapSheet(state, "LVG").total).toBeLessThanOrEqual(LEAGUE_FINANCE_CONFIG.expansionDraftSalaryLimit);
  });

  it("rejects a player who would exceed the expansion draft salary limit without mutating state", () => {
    let state = reachTrade("stage3-salary-limit");
    state = dispatch(state, { commandId: "start-salary-limit", type: "START_EXPANSION_DRAFT", payload: {} });
    const expectedPickNumber = (state.expansion?.currentPickIndex ?? 0) + 1;
    const player = getSelectableExpansionPlayers(state)[0];
    expect(player).toBeDefined();
    state.players[player.id].contract.salary = LEAGUE_FINANCE_CONFIG.expansionDraftSalaryLimit;
    const before = stableHash(stableSerialize(state));

    expect(() => dispatch(state, {
      commandId: "over-expansion-cap",
      type: "SELECT_EXPANSION_PLAYER",
      payload: { playerId: player.id, expectedPickNumber },
    })).toThrow(/扩军选秀工资帽限制/);
    expect(stableHash(stableSerialize(state))).toBe(before);
  });

  it("rejects a forced-player trade that cannot fit under the expansion draft salary limit", () => {
    const state = reachTrade("stage3-forced-salary-limit");
    const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === state.userTeamId
      && entry.type === "SELECT_PLAYER" && entry.status === "AVAILABLE");
    expect(offer).toBeDefined();
    state.players[offer?.targetPlayerId as string].contract.salary = LEAGUE_FINANCE_CONFIG.expansionDraftSalaryLimit;
    const before = stableHash(stableSerialize(state));

    expect(() => dispatch(state, {
      commandId: "over-cap-forced-trade",
      type: "ACCEPT_EXPANSION_TRADE",
      payload: { offerId: offer?.id as string },
    })).toThrow(/扩军选秀工资帽限制/);
    expect(stableHash(stableSerialize(state))).toBe(before);
  });

  it("replays the complete Stage 3 command sequence from one seed", () => {
    const first = finishDraft("stage3-replay");
    const second = finishDraft("stage3-replay");
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  });
});
