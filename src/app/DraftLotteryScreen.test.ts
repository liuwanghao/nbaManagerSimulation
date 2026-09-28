import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { getDraftLotteryPreview } from "../game/draft/DraftService";
import { DraftLotteryScreen, lotteryRevealOrder } from "./DraftLotteryScreen";
import App from "./App";

describe("draft lottery presentation", () => {
  it("reveals the committed lottery order from the last entrant to the first", () => {
    const state = createCareer("lottery-screen");
    state.league.seasonYear = 2027;
    state.league.currentPhase = "DRAFT";
    const entrants = getDraftLotteryPreview(state);
    state.rookieDraft = {
      draftSeed: "lottery-screen", classPlayerIds: [], pickOrder: entrants.map((entry, index) => ({
        pickNumber: index + 1, round: 1, originalTeamId: entry.teamId, ownerTeamId: entry.teamId,
      })), currentPickIndex: 0, completed: false, source: "PROCEDURAL_FUTURE", lotteryPresented: false,
    };
    const order = lotteryRevealOrder(state);
    expect(order.map((pick) => pick.pickNumber)).toEqual(Array.from({ length: entrants.length }, (_, index) => entrants.length - index));
    const markup = renderToStaticMarkup(createElement(DraftLotteryScreen, { state, busy: false, onCommand: async () => {} }));
    expect(markup).toContain("乐透抽签揭晓");
    expect(markup).toContain(`已公布 0 / ${entrants.length}`);
    expect(markup).toContain('aria-label="乐透抽签公布进度"');
    expect(markup).toContain("公布全部");
    expect(markup).toContain("进入选秀大厅");
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('class="draft-lottery-result is-revealed');
    const appMarkup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(appMarkup).toContain('aria-label="新秀选秀乐透抽签"');
    expect(appMarkup).not.toContain("候选新秀（");
  });
});
