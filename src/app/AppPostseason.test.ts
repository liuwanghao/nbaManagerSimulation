import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer, enterPostseason } from "../game/season/career";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { stableHash } from "../game/random/hash";
import { createRng } from "../game/random/xoshiro";
import { playerNameZh } from "./playerNameZh";
import App from "./App";

describe("season home after postseason", () => {
  it("offers postseason settlement when regular-season games are complete", () => {
    const state = createCareer("postseason-home-ready");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].losses = 82;
    for (const team of Object.values(state.teams)) if (team.conference === state.teams[state.userTeamId].conference && team.id !== state.userTeamId) state.standings[team.id].wins = 1;
    const winner = state.teams[state.userTeamId].playerIds[0];
    state.history.seasonAwards.push({ seasonId: state.league.seasonId, allStars: { EAST: [], WEST: [] }, winners: { MVP: winner } });

    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    const completionCard = markup.match(/class="season-command-complete[^"]*"[\s\S]*?<\/article>/u)?.[0];
    expect(completionCard).toContain("结算季后赛");
    expect(completionCard).not.toContain("进入下一联盟年度");
    expect(markup).toContain("常规赛奖项");
    expect(markup).not.toContain("查看赛季奖项");
    expect(markup).toContain('aria-label="常规赛奖项速览"');
    expect(markup.match(/class="season-award-card/g)).toHaveLength(5);
    for (const label of ["MVP", "DPOY", "ROY", "MIP", "6MOY"]) expect(markup).toContain(`class="season-award-watermark" aria-hidden="true">${label}</span>`);
    expect(markup).toContain("查看季后赛对阵图");
    expect(markup).not.toContain("class=\"season-results-bracket\"");
  });

  it("offers entry and shows a live postseason schedule and bracket for a qualified team", () => {
    const state = createCareer("postseason-home-qualified");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entryMarkup = renderToStaticMarkup(createElement(App, { initialState: state }));
    const completionCard = entryMarkup.match(/class="season-command-complete[^"]*"[\s\S]*?<\/article>/u)?.[0];
    expect(completionCard).toContain("进入季后赛");
    expect(completionCard).not.toContain("结算季后赛");
    expect(entryMarkup).not.toContain("结算季后赛");

    const entered = enterPostseason(state);
    expect(entered.history.seasonAwards.some((entry) => entry.seasonId === entered.league.seasonId)).toBe(true);
    const markup = renderToStaticMarkup(createElement(App, { initialState: entered }));
    expect(markup).toContain('aria-label="季后赛赛季中心"');
    expect(markup).toContain('aria-label="季后赛对阵赛程"');
    expect(markup).toContain('aria-label="季后赛对阵图"');
    expect(markup).toContain("模拟下一场比赛");
    expect(markup).not.toContain("结算剩余季后赛");
  });

  it("shows the championship and next-year action after settlement", () => {
    const state = createCareer("postseason-home-complete");
    state.league.currentPhase = "OFFSEASON";
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.history.champions.push({ seasonId: state.league.seasonId, teamId: state.userTeamId });
    const winner = state.teams[state.userTeamId].playerIds[0];
    state.history.seasonAwards.push({ seasonId: state.league.seasonId, allStars: { EAST: [], WEST: [] }, winners: { MVP: winner, FINALS_MVP: winner } });

    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    const completionCard = markup.match(/class="season-command-complete[^"]*"[\s\S]*?<\/article>/u)?.[0];
    expect(markup).toContain("季后赛已结算");
    expect(completionCard).toContain("postseason-settled");
    expect(completionCard).toContain("总冠军");
    expect(completionCard).toContain(state.teams[state.userTeamId].fullName);
    expect(completionCard).toContain("总决赛 MVP");
    expect(completionCard).toContain("进入下一联盟年度");
    expect(completionCard).not.toContain("结算季后赛");
    expect(markup).toContain("总决赛 MVP");
    expect(markup).not.toContain("season-results-champion");
    expect(markup).not.toContain("查看赛季奖项");
    expect(markup).toContain('class="season-award-watermark"');
    expect(markup).toContain("查看季后赛对阵图");
  });

  it("shows the current year's retirees without the mixed league development summary", () => {
    const state = createCareer("option-phase-preview");
    state.league.currentPhase = "OFFSEASON";
    const veteran = state.players[state.teams[state.userTeamId].playerIds[0]];
    veteran.birthDate = "1980-01-01";
    veteran.ageSource = "GENERATED_BIRTH_DATE";
    veteran.injuryRating = 20;
    veteran.rotationRole = "OUT";
    veteran.attributes = { shooting: 40, finishing: 40, playmaking: 40, perimeterDefense: 40, interiorDefense: 40, rebounding: 40, athleticism: 40, basketballIq: 40 };
    state.seeds.seasonSeed = Array.from({ length: 100 }, (_, index) => `retiree-preview-${index}`)
      .find((seed) => createRng(stableHash(seed, "retirement", veteran.id)).nextFloat() < 0.5)!;
    const next = rolloverLeagueYear(state);
    const retiredIds = next.playerLifecycle?.retiredPlayerIds ?? [];
    expect(retiredIds.length).toBeGreaterThan(0);

    const markup = renderToStaticMarkup(createElement(App, { initialState: next }));
    expect(markup).toContain("option-phase-shell");
    expect(markup).toContain('data-testid="season-overall-changes"');
    const currentRosterIds = new Set(next.teams[next.userTeamId].playerIds);
    const changedCurrentPlayers = next.playerLifecycle?.userTeamOverallChanges?.filter((entry) => currentRosterIds.has(entry.playerId) && entry.after !== entry.before) ?? [];
    expect(markup.match(/class="option-phase-overall-row"/gu) ?? []).toHaveLength(changedCurrentPlayers.length);
    expect(markup).toContain(`本年度退役球员</h2>`);
    for (const id of retiredIds) {
      expect(markup).toContain(playerNameZh(next.players[id].name, id));
      expect(markup).toContain(`${next.players[id].age} 岁`);
    }
    expect(markup).toContain("并非现实退役消息");
    expect(markup).not.toContain("年度球员变化");
    const optionLog = next.contractLifecycle?.transactionLog.filter((entry) => !entry.includes("CONTRACT_EXPIRED")) ?? [];
    const contractLog = markup.match(/<section class="option-phase-log" aria-label="合同动态">[\s\S]*?<\/section>/u)?.[0];
    expect(contractLog).toContain(`选项 ${optionLog.length} · 到期 ${next.contractLifecycle!.transactionLog.length - optionLog.length}`);
    expect(contractLog).toContain('placeholder="搜索球员或动态"');
    expect(contractLog?.match(/<p>/gu)).toHaveLength(optionLog.length);
    expect(contractLog).not.toContain("下一页");
    expect(markup).not.toContain("TEAM OPTIONS");
    expect(markup).not.toContain("LEAGUE RETIREMENTS");
    expect(markup).not.toContain("LEAGUE TRANSACTIONS");
  });
});
