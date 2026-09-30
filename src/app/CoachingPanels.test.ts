import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { executeCoachingCommand, fiveGameReviewView, offerCoachingReview } from "../game/coaching/CoachingService";
import { createCareer } from "../game/season/career";
import { FiveGameReviewPanel, RegularCoachingPanel } from "./CoachingPanels";

const noOp = async () => {};

describe("coaching intervention panels", () => {
  it("offers only offense and defense in pregame preparation", () => {
    const state = createCareer("coaching-ui-regular");
    const html = renderToStaticMarkup(createElement(RegularCoachingPanel, { state, busy: false, selection: null, onSelectionChange: () => {}, onUnlockVideo: noOp }));
    expect(html).toContain("赛前专项备战");
    expect(html).toContain("进攻准备");
    expect(html).toContain("防守准备");
    expect(html).toContain("不备战");
    expect(html).toContain('aria-pressed="true" class="selected">不备战');
    expect(html).not.toContain("两名球员恢复体能");
    expect(html).toContain("不备战可直接模拟");
    expect(html).not.toContain("观看激励视频 · 解锁下一场备战");
    expect(html).not.toContain("确认备战");
  });

  it("shows the current pregame direction as selectable until simulation", () => {
    const state = createCareer("coaching-ui-switch-directions");
    const game = state.schedule.find((entry) => entry.status === "SCHEDULED" && (entry.homeTeamId === state.userTeamId || entry.awayTeamId === state.userTeamId))!;
    const props = { state, busy: false, onSelectionChange: () => {}, onUnlockVideo: noOp };
    const offense = renderToStaticMarkup(createElement(RegularCoachingPanel, { ...props, selection: { gameId: game.id, choice: "OFFENSE" } }));
    const defense = renderToStaticMarkup(createElement(RegularCoachingPanel, { ...props, selection: { gameId: game.id, choice: "DEFENSE" } }));
    expect(offense).toContain('class="selected">进攻准备');
    expect(defense).toContain('class="selected">防守准备');
    expect(defense).toContain("尚未观看视频 · 点击模拟会按普通比赛进行");
    expect(defense).toContain("观看激励视频 · 解锁下一场备战");
    expect(defense).not.toContain("取消下一场备战");
    const skipped = renderToStaticMarkup(createElement(RegularCoachingPanel, { ...props, selection: { gameId: game.id, choice: "NONE" } }));
    expect(skipped).not.toContain("观看激励视频 · 解锁下一场备战");
    expect(skipped).toContain('aria-pressed="true" class="selected">不备战');
    const unlockedState = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: game.id });
    const unlocked = renderToStaticMarkup(createElement(RegularCoachingPanel, { ...props, state: unlockedState, selection: { gameId: game.id, choice: "DEFENSE" } }));
    expect(unlocked).toContain("视频已确认 · 下一场防守效率提升");
    expect(unlocked).not.toContain("观看激励视频 · 解锁下一场备战");
  });

  it("shows the five-game review only when a player has improvable status", () => {
    const state = createCareer("coaching-ui-review");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    games.slice(0, 5).forEach((game) => { game.status = "FINAL"; game.winnerTeamId = state.userTeamId; });
    const ids = games.slice(0, 5).map((game) => game.id);
    expect(fiveGameReviewView(offerCoachingReview(state, ids))).toBeUndefined();
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].morale = 38;
    state.players[playerId].fatigue = 75;
    const offered = offerCoachingReview(state, ids);
    const html = renderToStaticMarkup(createElement(FiveGameReviewPanel, { state: offered, busy: false, onApply: noOp }));
    expect(html).toContain("近五场 5 胜 0 负");
    expect(html).toContain("逐场模拟和连续模拟均可触发");
    expect(html).toContain("随机鼓舞两人</span><small>无需视频 · 两人士气各 +1");
    expect(html).toContain("鼓舞全队</span><small>激励视频 · 每人士气 +1");
    expect(html.indexOf("随机鼓舞两人")).toBeLessThan(html.indexOf("鼓舞全队"));
    expect(html).not.toContain("恢复高疲劳");
    expect(html).not.toContain("减轻全队疲劳");
  });

  it("does not offer a review when only fatigue is high", () => {
    const state = createCareer("coaching-ui-fatigue-video");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    games.slice(0, 5).forEach((game) => { game.status = "FINAL"; });
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].morale = 70;
    state.players[state.teams[state.userTeamId].playerIds[0]].fatigue = 75;
    const offered = offerCoachingReview(state, games.slice(0, 5).map((game) => game.id));
    const html = renderToStaticMarkup(createElement(FiveGameReviewPanel, { state: offered, busy: false, onApply: noOp }));
    expect(fiveGameReviewView(offered)).toBeUndefined();
    expect(html).toBe("");
  });

  it("lets a lone morale video fill the row when fewer than two players can gain morale", () => {
    const state = createCareer("coaching-ui-one-boostable-player");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    games.slice(0, 5).forEach((game) => { game.status = "FINAL"; });
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].morale = 100;
    state.players[state.teams[state.userTeamId].playerIds[0]].morale = 40;
    const offered = offerCoachingReview(state, games.slice(0, 5).map((game) => game.id));
    const html = renderToStaticMarkup(createElement(FiveGameReviewPanel, { state: offered, busy: false, onApply: noOp }));
    expect(html).not.toContain("随机鼓舞两人");
    expect(html).toContain("review-full-width");
    expect(html).toContain("鼓舞全队</span><small>激励视频 · 每人士气 +1");
  });

});
