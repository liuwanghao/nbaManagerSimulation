import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { renounceFreeAgentRights } from "../game/freeAgency/FreeAgencyService";
import { createCareer } from "../game/season/career";
import { FreeAgencyCapBreakdown, FreeAgencyRightsDialog } from "./FreeAgencyCapBreakdown";
import App from "./App";
import { moneyLabel } from "./uiText";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";

function fixture() {
  const state = createCareer("fa-accounting-ui");
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
  state.league.seasonYear = 2029;
  state.league.seasonId = "2029-30";
  const team = state.teams[state.userTeamId];
  const player = state.players[team.playerIds.pop()!];
  player.teamId = "FREE_AGENT";
  player.contract.status = "UFA";
  player.birdTeamId = team.id;
  player.birdYears = 3;
  state.capState.capHolds = [{ teamId: team.id, playerId: player.id, amount: 30_000_000, type: "BIRD_UFA" }];
  state.capState.deadMoney = [{ id: "dead", teamId: team.id, salaryBySeason: { [state.league.seasonId]: 4_000_000 } }];
  state.freeAgency = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
  return { state, player };
}
function render(state: ReturnType<typeof createCareer>) {
  return renderToStaticMarkup(createElement(FreeAgencyCapBreakdown, { state, busy: false, onCommand: async () => {}, onSign: () => {} }));
}

describe("free agency cap accounting", () => {
  it("explains every charge and reconciles the current season's total and space", () => {
    const { state, player } = fixture();
    const markup = render(state);
    const sheet = getCapSheet(state, state.userTeamId);
    for (const label of ["球员合同", "死钱", "薪资占位", "报价预留", "未满员费用", "最低工资差额"]) expect(markup).toContain(label);
    expect(markup).toContain(`工资帽 ${moneyLabel(getSeasonFinanceConfig(2029).salaryCap)}`);
    expect(markup).toContain(`总占用 ${moneyLabel(sheet.total)}`);
    expect(markup).toContain(`帽下空间 <b>${moneyLabel(sheet.availableCapSpace)}</b>`);
    expect(markup).toContain(`data-testid="renounce-fa-rights-${player.id}"`);
    expect(markup).toContain(`data-testid="sign-fa-rights-${player.id}"`);
    expect(markup).toContain(">签合约</button>");
    expect(markup).toContain('class="gemini-prospect-avatar regular-free-agent-avatar portrait-fallback"');
    expect(markup).toContain(`${player.age} 岁`);
    expect(markup).toContain(`aria-label="OVR ${calculatePlayerOverall(player).toFixed(0)}"`);
    expect(markup).toContain("失去 Bird 超帽续约权及 RFA 匹配权");
    expect(markup).toContain("报价预留只计入超出该球员占位的部分");
  });

  it("includes the accounting panel in the actual offseason signing page", () => {
    const { state, player } = fixture();
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain('data-testid="fa-cap-accounting"');
    expect(markup).toContain(`data-testid="sign-fa-rights-${player.id}"`);
    expect(markup).toContain(`data-testid="renounce-fa-rights-${player.id}"`);
    expect(markup).toContain(`data-testid="open-fa-offer-${player.id}"`);
  });

  it("requires withdrawing an active own-team offer before releasing its rights", () => {
    const { state, player } = fixture();
    state.freeAgency!.offers.own = {
      offerId: "own", playerId: player.id, teamId: state.userTeamId,
      createdDay: 1, expiresDay: 3, years: 1, year1Salary: 5_000_000,
      totalValue: 5_000_000, guaranteedValue: 5_000_000, rolePromised: "BENCH",
      capReservation: 5_000_000, utility: 100, status: "ACTIVE", kind: "UFA_OFFER",
    };
    const markup = render(state);
    expect(markup).toContain("请先撤回本队有效报价");
    expect(markup).toMatch(new RegExp(`data-testid="renounce-fa-rights-${player.id}" disabled=""`));
    expect(markup).toMatch(new RegExp(`data-testid="sign-fa-rights-${player.id}" disabled=""`));
  });

  it("updates the cap and removes the rights action after a domain transaction", () => {
    const { state, player } = fixture();
    const next = renounceFreeAgentRights(state, player.id);
    const markup = render(next);
    expect(markup).not.toContain(`data-testid="renounce-fa-rights-${player.id}"`);
    expect(markup).not.toContain(`data-testid="sign-fa-rights-${player.id}"`);
    expect(markup).toContain(`总占用 ${moneyLabel(getCapSheet(next, next.userTeamId).total)}`);
    expect(render(state)).toContain(`data-testid="renounce-fa-rights-${player.id}"`);
  });

  it("blocks rights removal while an RFA matching decision is pending", () => {
    const { state, player } = fixture();
    player.contract.status = "RFA";
    state.freeAgency!.markets[player.id] = {
      playerId: player.id, originalTeamId: state.userTeamId,
      marketWindowStartDay: 1, decisionDeadline: 3, marketWindowStatus: "RFA_MATCHING",
    };
    const markup = render(state);
    expect(markup).toContain("请先处理 RFA 匹配决定");
    expect(markup).toMatch(new RegExp(`data-testid="renounce-fa-rights-${player.id}" disabled=""`));
    expect(markup).toMatch(new RegExp(`data-testid="sign-fa-rights-${player.id}" disabled=""`));
  });

  it("keeps signed players' legacy holds out of the visible accounting", () => {
    const { state } = fixture();
    const signedId = state.teams[state.userTeamId].playerIds[0];
    state.capState.capHolds.push({ playerId: signedId, teamId: state.userTeamId, amount: 40_000_000, type: "BIRD_UFA" });
    const markup = render(state);
    expect(markup).not.toContain(`data-testid="renounce-fa-rights-${signedId}"`);
    expect(markup).toContain("1 人 · 3,000 万美元");
    expect(getCapSheet(state, state.userTeamId).capHolds).toBe(30_000_000);
  });
});

describe("free-agent rights confirmation", () => {
  it.each(["UFA", "RFA"] as const)("shows readable player information and %s consequences", (status) => {
    const { player } = fixture();
    player.contract.status = status;
    const markup = renderToStaticMarkup(createElement(FreeAgencyRightsDialog, {
      player, amount: 1_460_000, busy: false, onCancel: () => {}, onConfirm: () => {},
    }));
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('id="renounce-rights-title">放弃签约权？</h2>');
    expect(markup).toContain('class="fa-renounce-body"');
    expect(markup).not.toContain("preseason-waive-dialog");
    expect(markup).toContain("146 万美元");
    expect(markup).toContain("Bird 超帽续约权");
    expect(markup).toContain(`${player.age} 岁`);
    expect(markup).toContain(`aria-label="OVR ${calculatePlayerOverall(player).toFixed(0)}"`);
    expect(markup).toContain(">保留签约权</button>");
    expect(markup).toContain(">确认放弃</button>");
    if (status === "RFA") expect(markup).toContain("本队失去报价匹配权");
    else expect(markup).not.toContain("本队失去报价匹配权");
  });

  it("disables cancellation and confirmation while the transaction is being saved", () => {
    const { player } = fixture();
    const markup = renderToStaticMarkup(createElement(FreeAgencyRightsDialog, {
      player, amount: 1_460_000, busy: true, onCancel: () => {}, onConfirm: () => {},
    }));
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });
});
