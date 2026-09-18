import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { stableHash, stableSerialize } from "../random/hash";
import { createExpansionCareer } from "../season/career";
import type { ExpansionCityId, GameState } from "../state/types";
import {
  executeExpansionCommand,
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
    expect(state.teams.SEA.fullName).toBe("西雅图 翡翠潮");
    expect(state.teams.LVG.fullName).toBe("拉斯维加斯 电压");
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
    expect(state.teams.SEA.fullName).toBe("西雅图 雨城先锋");
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
  });

  it("replays the complete Stage 3 command sequence from one seed", () => {
    const first = finishDraft("stage3-replay");
    const second = finishDraft("stage3-replay");
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  });
});
