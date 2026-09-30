import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../data/expansionBrands";
import { executeDraftCommand } from "../game/draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../game/expansion/ExpansionService";
import { createExpansionCareer } from "../game/season/career";
import { MemoryStorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService } from "../storage/SaveService";
import { playerNameZh } from "./playerNameZh";
import App from "./App";

function completedExpansion() {
  const preset = EXPANSION_BRAND_PRESETS.SEA[0];
  let state = executeExpansionCommand(createExpansionCareer("summary-required"), {
    commandId: "summary-create", type: "CREATE_EXPANSION_TEAM",
    payload: { cityId: "SEA", presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) state = executeExpansionCommand(state, { commandId: "summary-rights", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
  state = executeExpansionCommand(state, { commandId: "summary-options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "summary-trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "summary-start", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const expectedPickNumber = state.expansion!.currentPickIndex + 1;
    const playerId = getSelectableExpansionPlayers(state)[0].id;
    state = executeExpansionCommand(state, { commandId: `summary-pick-${expectedPickNumber}`, type: "SELECT_EXPANSION_PLAYER", payload: { playerId, expectedPickNumber } });
  }
  return state;
}

describe("direct rookie draft preparation after expansion", () => {
  it("opens rookie preparation immediately and keeps the completed expansion roster recap", () => {
    const state = completedExpansion();
    expect(state.league.currentPhase).toBe("ROOKIE_DRAFT_PENDING");
    expect(state.expansion?.finalized).toBe(true);
    expect(state.expansion?.picks).toHaveLength(28);
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain("rookie-draft-prep-terminal");
    expect(markup).toContain("进入新秀选秀大厅");
    expect(markup).toContain("扩军选秀名单");
    expect(markup).not.toContain('data-testid="expansion-draft-summary"');
    expect(markup).not.toContain('data-testid="confirm-expansion-summary"');
    expect(markup).not.toContain("重新进行扩军选秀");
    for (const teamId of [state.expansion!.playerTeamId, state.expansion!.aiTeamId]) {
      expect(markup).toContain(state.teams[teamId].fullName);
      expect(markup).toContain(`${state.teams[teamId].playerIds.length} 名球员`);
    }
    for (const playerId of state.teams[state.userTeamId].playerIds) {
      expect(markup).toContain(playerNameZh(state.players[playerId].name, playerId));
    }
  });

  it("starts the rookie draft without confirmation while still requiring expansion finalization", () => {
    const completed = completedExpansion();
    const prepare = { commandId: "summary-prepare", type: "PREPARE_ROOKIE_DRAFT" as const, payload: {} };
    expect(completed.expansion?.summaryConfirmed).toBe(false);
    const prepared = executeDraftCommand(completed, prepare);
    expect(prepared.league.currentPhase).toBe("DRAFT");
    expect(prepared.expansion).toEqual(completed.expansion);
    expect(prepared.expansion?.picks).toHaveLength(28);
    expect([prepared.expansion!.playerTeamId, prepared.expansion!.aiTeamId].map((id) => prepared.teams[id].playerIds.length)).toEqual([14, 14]);
    const unfinished = structuredClone(completed);
    unfinished.expansion!.finalized = false;
    expect(() => executeDraftCommand(unfinished, prepare)).toThrow(/finalized/ui);
  });

  it.each([false, undefined, true])("loads old saves with summaryConfirmed=%s directly into rookie preparation", async (summaryConfirmed) => {
    const service = new SaveService(new MemoryStorageAdapter());
    const completed = completedExpansion();
    completed.expansion!.summaryConfirmed = summaryConfirmed;
    await service.save(1, completed);
    const loaded = await service.load(1);
    expect(loaded?.league.currentPhase).toBe("ROOKIE_DRAFT_PENDING");
    expect(loaded?.expansion?.picks).toEqual(completed.expansion?.picks);
    const markup = renderToStaticMarkup(createElement(App, { initialState: loaded! }));
    expect(markup).toContain("进入新秀选秀大厅");
    expect(markup).not.toContain('data-testid="expansion-draft-summary"');
    expect(executeDraftCommand(loaded!, { commandId: "loaded-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} }).league.currentPhase).toBe("DRAFT");
  });

  it("still accepts a legacy confirmation command idempotently", () => {
    const completed = completedExpansion();
    const confirm = { commandId: "legacy-summary-confirm", type: "CONFIRM_EXPANSION_SUMMARY" as const, payload: {} };
    const confirmed = executeExpansionCommand(completed, confirm);
    expect(confirmed.expansion?.summaryConfirmed).toBe(true);
    expect(executeExpansionCommand(confirmed, confirm)).toBe(confirmed);
  });
});
