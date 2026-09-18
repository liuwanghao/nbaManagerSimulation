import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { executeDraftCommand, getAvailableDraftProspects } from "../draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../expansion/ExpansionService";
import { stableHash, stableSerialize } from "../random/hash";
import { createExpansionCareer } from "../season/career";
import type { GameState } from "../state/types";
import { executeFreeAgencyCommand, getFreeAgents } from "./FreeAgencyService";

function postDraftState(seed: string): GameState {
  const preset = EXPANSION_BRAND_PRESETS.SEA[0];
  let state = executeExpansionCommand(createExpansionCareer(seed), {
    commandId: "create", type: "CREATE_EXPANSION_TEAM",
    payload: { cityId: "SEA", presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) state = executeExpansionCommand(state, { commandId: "package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "B" } });
  state = executeExpansionCommand(state, { commandId: "options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "start-exp", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const pick = (state.expansion?.currentPickIndex ?? 0) + 1;
    state = executeExpansionCommand(state, { commandId: `exp-${pick}`, type: "SELECT_EXPANSION_PLAYER", payload: { playerId: getSelectableExpansionPlayers(state)[0].id, expectedPickNumber: pick } });
  }
  state = executeDraftCommand(state, { commandId: "prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error("rookie draft pick missing");
    state = pick.ownerTeamId === state.userTeamId
      ? executeDraftCommand(state, { commandId: `rookie-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
      : executeDraftCommand(state, { commandId: `rookie-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
  }
  return state;
}

describe("Stage 4 free agency", () => {
  it("opens the market, detaches expiring players and creates cap holds", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-open"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    expect(state.freeAgency?.opened).toBe(true);
    expect(getFreeAgents(state).length).toBeGreaterThanOrEqual(16);
    expect(getFreeAgents(state).every((player) => player.teamId === "FREE_AGENT")).toBe(true);
    expect(state.capState.capHolds.length).toBeGreaterThan(0);
  });

  it("reserves cap, keeps the first three-day deadline and makes retries idempotent", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-offer"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    const command = { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } } as const;
    state = executeFreeAgencyCommand(state, command);
    const deadline = state.freeAgency?.markets[player.id].decisionDeadline;
    expect(state.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(true);
    expect(executeFreeAgencyCommand(state, command)).toBe(state);
    const next = executeFreeAgencyCommand(state, { commandId: "offer-2", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 2, year1Salary: 7_000_000, guaranteedPercent: 1, rolePromised: "BENCH" } });
    expect(next.freeAgency?.markets[player.id].decisionDeadline).toBe(deadline);
  });

  it("rejects an unaffordable offer without mutating the input", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-rollback"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state)[0];
    const before = stableHash(stableSerialize(state));
    expect(() => executeFreeAgencyCommand(state, { commandId: "bad", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 4, year1Salary: 999_000_000, guaranteedPercent: 1, rolePromised: "STARTER" } })).toThrow(/legal limits/);
    expect(stableHash(stableSerialize(state))).toBe(before);
  });

  it("settles offers deterministically and releases every losing reservation", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-settle"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    state = executeFreeAgencyCommand(state, { commandId: "max-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 4, year1Salary: 30_000_000, guaranteedPercent: 1, rolePromised: "STARTER" } });
    for (let day = 0; day < 3 && state.players[player.id].teamId === "FREE_AGENT"; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `day-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
    }
    expect(state.players[player.id].teamId).not.toBe("FREE_AGENT");
    expect(state.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(false);
    expect(state.freeAgency?.markets[player.id].marketWindowStatus).toBe("SIGNED");
  });

  it("replays the same opening and first settlement from one seed", () => {
    const run = () => {
      let state = executeFreeAgencyCommand(postDraftState("fa-replay"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
      state = executeFreeAgencyCommand(state, { commandId: "day", type: "ADVANCE_FA_DAY", payload: {} });
      return stableHash(stableSerialize(state));
    };
    expect(run()).toBe(run());
  });
});
