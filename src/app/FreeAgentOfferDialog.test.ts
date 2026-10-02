import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getRecommendedFreeAgentOffer, getRecommendedOwnPlayerExtension } from "../game/freeAgency/FreeAgencyService";
import { createCareer } from "../game/season/career";
import { FreeAgentOfferDialogContent } from "./FreeAgentOfferDialog";

describe("free-agent offer dialog", () => {
  it("shows the same contract editor in the season market and offseason", () => {
    const state = createCareer("shared-free-agent-offer-dialog");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    const player = state.players[playerId];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    const draft = { ...getRecommendedFreeAgentOffer(state, playerId), years: 3, finalYearOption: "TEAM_OPTION" as const };
    const markupForPhase = (phase: "REGULAR_SEASON" | "OFFSEASON_POST_DRAFT") => {
      state.league.currentPhase = phase;
      return renderToStaticMarkup(createElement(FreeAgentOfferDialogContent, {
        state, playerId, draft, busy: false, onChange: () => {}, onClose: () => {}, onSubmit: () => {},
      }));
    };
    const regular = markupForPhase("REGULAR_SEASON");
    const offseason = markupForPhase("OFFSEASON_POST_DRAFT");
    for (const markup of [regular, offseason]) {
      for (const field of ["fa-offer-years", "fa-offer-salary-1", "fa-offer-raise", "fa-offer-guarantee", "fa-offer-option", "fa-offer-role"]) {
        expect(markup).toContain(`data-testid="${field}"`);
      }
      expect(markup).toContain("球员期望合同");
      expect(markup).toContain("当前要价");
      expect(markup).toContain("参考估值");
      expect(markup).toContain("逐年薪资预览");
      expect(markup.match(/class="fa-offer-salary-row"/g)).toHaveLength(3);
      expect(markup).toContain("球队选项");
      expect(markup).toContain("首年占用空间");
    }
    expect(regular).toContain("下一日历日（包括休息日）决定是否接受");
    expect(offseason).not.toContain("下一日历日（包括休息日）决定是否接受");
  });

  it("labels own-player extensions as a next-day renewal offer", () => {
    const state = createCareer("extension-offer-dialog");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    const player = state.players[playerId];
    player.contract = { ...player.contract, status: "STANDARD", yearsRemaining: 1, salaryByYear: [player.contract.salary], currentYearIndex: 0 };
    const draft = { ...getRecommendedOwnPlayerExtension(state, playerId), guaranteedPercent: 1, finalYearOption: "NONE" as const, rolePromised: "ROTATION" as const };
    const markup = renderToStaticMarkup(createElement(FreeAgentOfferDialogContent, {
      state, playerId, draft, mode: "extension", busy: false, onChange: () => {}, onClose: () => {}, onSubmit: () => {},
    }));
    expect(markup).toContain("提交提前续约报价");
    expect(markup).toContain("提交续约报价");
    expect(markup).toContain("不占用本赛季工资空间");
    expect(markup).toContain("下一日历日（包括休息日）决定是否接受");
  });
});
