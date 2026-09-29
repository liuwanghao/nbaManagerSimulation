import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../data/expansionBrands";
import { getCapSheet } from "../game/cap/CapSheetService";
import { executeDraftCommand } from "../game/draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../game/expansion/ExpansionService";
import { createExpansionCareer } from "../game/season/career";
import { MemoryStorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService } from "../storage/SaveService";
import { playerNameZh } from "./playerNameZh";
import { moneyLabel } from "./uiText";
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

describe("mandatory expansion draft summary", () => {
  it("shows both teams' rosters and finances before rookie draft preparation", () => {
    const state = completedExpansion();
    expect(state.league.currentPhase).toBe("ROOKIE_DRAFT_PENDING");
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain('data-testid="expansion-draft-summary"');
    expect(markup).toContain('data-testid="confirm-expansion-summary"');
    expect(markup).toContain("重新进行扩军选秀");
    expect(markup).not.toContain("进入新秀选秀大厅");
    for (const teamId of [state.expansion!.playerTeamId, state.expansion!.aiTeamId]) {
      expect(markup).toContain(state.teams[teamId].fullName);
      expect(markup).toContain(`${state.teams[teamId].playerIds.length} 名球员`);
      const cap = getCapSheet(state, teamId);
      expect(markup).toContain(moneyLabel(cap.activeContractSalary));
      expect(markup).toContain(moneyLabel(cap.total));
      expect(markup).toContain(moneyLabel(cap.availableCapSpace));
      for (const playerId of state.teams[teamId].playerIds) {
        expect(markup).toContain(playerNameZh(state.players[playerId].name, playerId));
      }
    }
  });

  it("requires a persisted confirmation before the first rookie draft and accepts repeated confirmation safely", () => {
    const completed = completedExpansion();
    const prepare = { commandId: "summary-prepare", type: "PREPARE_ROOKIE_DRAFT" as const, payload: {} };
    expect(() => executeDraftCommand(completed, prepare)).toThrow(/summary|摘要/ui);
    const confirm = { commandId: "summary-confirm", type: "CONFIRM_EXPANSION_SUMMARY" as const, payload: {} };
    const confirmed = executeExpansionCommand(completed, confirm);
    expect(confirmed.expansion?.summaryConfirmed).toBe(true);
    expect(executeExpansionCommand(confirmed, confirm)).toBe(confirmed);
    expect(executeDraftCommand(confirmed, prepare).league.currentPhase).toBe("DRAFT");
  });

  it("restores the required summary from a save and retains its confirmation", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const completed = completedExpansion();
    await service.save(1, completed);
    const before = await service.load(1);
    expect(before?.expansion?.summaryConfirmed).toBe(false);
    expect(renderToStaticMarkup(createElement(App, { initialState: before! }))).toContain('data-testid="expansion-draft-summary"');
    const confirmed = executeExpansionCommand(before!, { commandId: "summary-save-confirm", type: "CONFIRM_EXPANSION_SUMMARY", payload: {} });
    await service.save(1, confirmed);
    const after = await service.load(1);
    expect(after?.expansion?.summaryConfirmed).toBe(true);
    const markup = renderToStaticMarkup(createElement(App, { initialState: after! }));
    expect(markup).toContain("进入新秀选秀大厅");
    expect(markup).not.toContain('data-testid="expansion-draft-summary"');
  });
});
