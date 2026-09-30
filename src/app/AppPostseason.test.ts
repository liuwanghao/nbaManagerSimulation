import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer, enterPostseason, simulatePostseasonRound, simulatePostseasonToNextUserGame, standingsForConference } from "../game/season/career";
import { executeCoachingCommand, nextPlayoffUserGame, nextRegularUserGame } from "../game/coaching/CoachingService";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { stableHash } from "../game/random/hash";
import { createRng } from "../game/random/xoshiro";
import { playerNameZh } from "./playerNameZh";
import { executeSimulationTask } from "./simulationTask";
import App from "./App";

describe("season home after postseason", () => {
  it("enters the play-in with the tenth seed's first game still unplayed", () => {
    const state = createCareer("postseason-tenth-seed-entry");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    const conference = state.teams[state.userTeamId].conference;
    state.userTeamId = standingsForConference(state, conference)[9].teamId;

    const result = executeSimulationTask({
      state, pregameSelection: null,
      action: { kind: "OPERATION", operation: "ENTER_POSTSEASON", usePregameSelection: false },
    });
    expect(result.kind).toBe("OPERATION");
    const entered = result.state;
    const firstGame = nextPlayoffUserGame(entered)?.game;
    expect(entered.league.currentPhase).toBe("PLAY_IN");
    expect(entered.postseason?.seeds[conference][9]).toBe(entered.userTeamId);
    expect(firstGame?.status).toBe("SCHEDULED");
    expect(entered.postseason?.schedule.some((game) => game.status === "FINAL" && (game.homeTeamId === entered.userTeamId || game.awayTeamId === entered.userTeamId))).toBe(false);
    const markup = renderToStaticMarkup(createElement(App, { initialState: entered }));
    expect(markup).toContain('data-testid="simulate-postseason-next"');
    expect(markup).not.toContain("本队赛程结束");

    const afterFirstGame = executeSimulationTask({
      state: entered, pregameSelection: null,
      action: { kind: "OPERATION", operation: "POSTSEASON_NEXT", usePregameSelection: false },
    }).state;
    expect(afterFirstGame.postseason?.schedule.find((game) => game.id === firstGame?.id)?.status).toBe("FINAL");
    expect(afterFirstGame.postseason?.schedule.filter((game) => game.status === "FINAL" && (game.homeTeamId === entered.userTeamId || game.awayTeamId === entered.userTeamId))).toHaveLength(1);
  });

  it("keeps optional pregame preparation inside the next matchup without a one-day action", () => {
    const markup = renderToStaticMarkup(createElement(App, { initialState: createCareer("pregame-matchup-layout") }));
    const matchup = markup.indexOf('class="season-command-matchup"');
    const preparation = markup.indexOf('class="season-command-pregame"', matchup);
    const nextGame = markup.indexOf('data-testid="simulate-next-game"', preparation);
    expect(matchup).toBeGreaterThanOrEqual(0);
    expect(preparation).toBeGreaterThan(matchup);
    expect(nextGame).toBeGreaterThan(preparation);
    expect(markup).toContain("攻防备战 · 点击展开");
    expect(markup).not.toContain("推进 1 天");
  });

  it("labels an unconfirmed preparation as an ordinary next-game simulation", () => {
    const state = createCareer("pregame-unconfirmed-simulation-label");
    const game = nextRegularUserGame(state)!;
    const planned = executeCoachingCommand(state, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    const markup = renderToStaticMarkup(createElement(App, { initialState: planned }));
    expect(markup).toContain("进攻未解锁 · 普通模拟");
    expect(markup).toContain("普通模拟下一场比赛");
  });

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

  it("offers entry and shows only the user's postseason results alongside the bracket", () => {
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
    expect(markup).toContain('aria-label="本队季后赛比赛结果"');
    expect(markup).toContain("本队尚无比赛结果");
    expect(markup).not.toContain("季后赛对阵赛程");
    expect(markup).toContain('aria-label="季后赛对阵图"');
    expect(markup).toContain('class="postseason-bracket-disclosure"');
    expect(markup).toContain('role="tablist" aria-label="筛选季后赛对阵"');
    expect(markup).not.toContain("季后赛针对性布置");
    expect(markup).toContain("正在推进其他球队比赛");
    expect(markup).not.toContain("对手待定");
    expect(markup).not.toContain("结算剩余季后赛");
    const matchup = markup.match(/<article class="season-command-matchup postseason-next-game">[\s\S]*?<\/article>/u)?.[0];
    const otherGame = entered.postseason!.schedule[0];
    expect(matchup).not.toContain(entered.teams[otherGame.homeTeamId].fullName);
    expect(matchup).not.toContain(entered.teams[otherGame.awayTeamId].fullName);
    const ready = simulatePostseasonToNextUserGame(entered);
    const readyMarkup = renderToStaticMarkup(createElement(App, { initialState: ready }));
    expect(readyMarkup).toContain("模拟整轮比赛");
    expect(readyMarkup).toContain(ready.teams[ready.userTeamId].fullName);
    expect(readyMarkup).not.toContain("对手待定");

    const played = simulatePostseasonToNextUserGame(ready);
    const playedMarkup = renderToStaticMarkup(createElement(App, { initialState: played }));
    const results = playedMarkup.match(/<section class="postseason-results"[\s\S]*?<\/section>/u)?.[0] ?? "";
    const userGames = played.postseason!.schedule.filter((game) => game.status === "FINAL" && (game.homeTeamId === played.userTeamId || game.awayTeamId === played.userTeamId));
    expect(results.match(/<li>/gu)).toHaveLength(userGames.length);
    expect(results).toContain("查看详情");
    expect(results).not.toContain("未开赛");
    expect(results).not.toContain("本队尚无比赛结果");
  });

  it("stops whole-round simulation before the next playoff round", () => {
    const state = createCareer("postseason-whole-round");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entered = enterPostseason(state);
    const afterPlayIn = simulatePostseasonRound(entered);
    expect(afterPlayIn.postseason?.schedule.some((game) => game.status === "FINAL")).toBe(true);
    expect(afterPlayIn.postseason?.series.filter((series) => series.round === "R1").every((series) => series.winsA === 0 && series.winsB === 0)).toBe(true);
    expect(afterPlayIn.postseason?.schedule.some((game) => game.status === "SCHEDULED")).toBe(true);
  });

  it("waits for the user's next matchup before simulating it", () => {
    const state = createCareer("postseason-next-user-decision");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entered = enterPostseason(state);
    expect(nextPlayoffUserGame(entered)).toBeUndefined();
    const ready = simulatePostseasonToNextUserGame(entered);
    const target = nextPlayoffUserGame(ready)?.game;
    expect(target?.status).toBe("SCHEDULED");
    const played = simulatePostseasonToNextUserGame(ready);
    expect(played.postseason?.schedule.find((game) => game.id === target?.id)?.status).toBe("FINAL");
    expect(nextPlayoffUserGame(played)?.game.status).toBe("SCHEDULED");
  });

  it("shows per-game preparation when the next postseason matchup is the user's", () => {
    const state = createCareer("postseason-user-pregame");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entered = enterPostseason(state);
    const later = entered.postseason!.schedule.at(-1)!;
    const series = entered.postseason!.series.find((entry) => entry.gameIds.includes(later.id))!;
    later.homeTeamId = entered.userTeamId;
    series.teamAId = entered.userTeamId;
    const markup = renderToStaticMarkup(createElement(App, { initialState: entered }));
    const matchup = markup.match(/<article class="season-command-matchup postseason-next-game">[\s\S]*?<\/article>/u)?.[0];
    expect(matchup).toContain(entered.teams[entered.userTeamId].fullName);
    expect(matchup).toContain(entered.teams[later.awayTeamId].fullName);
    expect(markup).toContain('class="season-command-pregame postseason-preparation"');
    expect(markup).toContain('aria-label="逐场专项备战"');
    expect(markup).toContain("季后赛 0胜0负");
    expect(markup).not.toContain("季后赛针对性布置");
  });

  it("shows the user's finished journey instead of another team's next game", () => {
    const state = createCareer("postseason-user-eliminated-home");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entered = enterPostseason(state);
    const opponent = Object.values(entered.teams).find((team) => team.id !== entered.userTeamId && team.conference === entered.teams[entered.userTeamId].conference)!;
    entered.postseason!.series.push({ id: "USER-OUT", conference: opponent.conference, round: "R1", teamAId: entered.userTeamId, teamBId: opponent.id, winsA: 0, winsB: 4, bestOf: 7, winnerTeamId: opponent.id, gameIds: [] });
    const markup = renderToStaticMarkup(createElement(App, { initialState: entered }));
    const matchup = markup.match(/<article class="season-command-matchup postseason-next-game">[\s\S]*?<\/article>/u)?.[0];
    expect(matchup).toContain("本队赛程结束");
    expect(matchup).toContain("结算剩余季后赛");
    expect(matchup).not.toContain("正在推进其他球队比赛");
    expect(matchup).not.toContain(entered.teams[entered.postseason!.schedule[0].homeTeamId].fullName);
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
