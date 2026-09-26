import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getRecommendedFreeAgentOffer } from "../game/freeAgency/FreeAgencyService";
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
      expect(markup).toContain("逐年薪资预览");
      expect(markup.match(/class="fa-offer-salary-row"/g)).toHaveLength(3);
      expect(markup).toContain("球队选项");
      expect(markup).toContain("首年占用空间");
    }
    expect(regular).toContain("后续比赛日决定是否接受");
    expect(offseason).not.toContain("后续比赛日决定是否接受");
  });
});
