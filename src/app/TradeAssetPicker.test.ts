import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { TradeAssetPicker } from "./TradeAssetPicker";
import { playerNameZh } from "./playerNameZh";

describe("shared trade asset picker", () => {
  it("shows player and pick controls in the regular season and before the draft", () => {
    const state = createCareer("shared-trade-picker");
    const team = state.teams[state.userTeamId];
    const roster = team.playerIds.map((id) => state.players[id]);
    const player = roster[0];
    const futurePick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === team.id && pick.year === state.league.seasonYear + 1);
    if (!futurePick) throw new Error("Expected a future draft pick");
    const currentPickId = "current-draft-trade-pick";
    state.draftPicks[currentPickId] = { id: currentPickId, year: state.league.seasonYear, round: 2, originalTeamId: team.id, ownerTeamId: team.id };
    const renderPicker = () => renderToStaticMarkup(createElement(TradeAssetPicker, {
      state, roster, selectedPlayerIds: [player.id], selectedPickIds: [futurePick.id], positionFilter: "ALL",
      onPositionFilter: () => {}, onTogglePlayer: () => {}, onTogglePick: () => {}, onClose: () => {},
    }));

    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const regular = renderPicker();
    expect(regular).toContain('aria-label="选择我方交易筹码"');
    expect(regular).toContain(playerNameZh(player.name, player.id));
    expect(regular).toContain(`${futurePick.year} 年`);
    expect(regular).not.toContain(`${state.league.seasonYear} 年次轮`);
    expect(regular).toContain("确认筹码");
    expect(regular.match(/class="trade-asset-options"/g)).toHaveLength(2);

    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    const preDraft = renderPicker();
    expect(preDraft).toContain(playerNameZh(player.name, player.id));
    expect(preDraft).toContain(`${state.league.seasonYear} 年次轮`);
    expect(preDraft).toContain(`${futurePick.year} 年`);
  });

  it("allows confirming an empty selection so all chips can be removed", () => {
    const state = createCareer("clear-trade-picker");
    const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(TradeAssetPicker, {
      state, roster, selectedPlayerIds: [], selectedPickIds: [], positionFilter: "ALL",
      onPositionFilter: () => {}, onTogglePlayer: () => {}, onTogglePick: () => {}, onClose: () => {},
    }));
    expect(markup).toContain('class="trade-inquiry-submit" type="button">确认筹码</button>');
  });
});
