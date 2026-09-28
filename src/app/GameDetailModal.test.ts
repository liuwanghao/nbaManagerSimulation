import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { emptyPlayerSeasonStats, type GameResult, type PlayerBoxScore, type TeamBoxScore } from "../game/state/types";
import { GameDetailModal } from "./App";
import { postgameAccentColor } from "./postgameAccentColor";

const box = (teamId: string, playerId: string, pts: number): TeamBoxScore => {
  const stat: PlayerBoxScore = { ...emptyPlayerSeasonStats(), playerId, seconds: 1800, pts,
    fgm: 6, fga: 10, threePm: 2, threePa: 4, ftm: pts - 14, fta: 8,
    reb: 7, ast: 4, stl: 2, blk: 1, tov: 3 };
  return { teamId, score: pts, playerStats: [stat], totals: {} as TeamBoxScore["totals"] };
};

describe("GameDetailModal", () => {
  it("shows away and home tabs with only the active team's player rows", () => {
    const state = createCareer("postgame-two-team-tabs");
    const scheduled = state.schedule.find((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)!;
    state.teams[scheduled.awayTeamId].primaryColor = "#581c87";
    const awayPlayerId = state.teams[scheduled.awayTeamId].playerIds[0];
    const homePlayerId = state.teams[scheduled.homeTeamId].playerIds[0];
    const game: GameResult = {
      gameId: scheduled.id, date: scheduled.date,
      awayTeamId: scheduled.awayTeamId, homeTeamId: scheduled.homeTeamId,
      awayScore: 20, homeScore: 15, winnerTeamId: scheduled.awayTeamId, overtimePeriods: 0,
      awayPeriodScores: [5, 5, 5, 5], homePeriodScores: [4, 4, 4, 3],
      awayBoxScore: box(scheduled.awayTeamId, awayPlayerId, 20),
      homeBoxScore: box(scheduled.homeTeamId, homePlayerId, 15),
    };

    const markup = renderToStaticMarkup(createElement(GameDetailModal, { game, state, onClose: () => {} }));
    expect(markup).toContain(`比赛详情 · ${game.date}`);
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain("客场 · ");
    expect(markup).toContain("主场 · ");
    expect(markup.match(/class="postgame-box-table"/g)).toHaveLength(1);
    expect(markup).not.toContain("<th>+/-</th>");
    expect(markup).not.toContain("postgame-pm-neutral");
    expect(markup).toContain("<th>助攻</th><th>投篮</th><th>三分</th><th>罚球</th><th>抢断</th><th>盖帽</th><th>失误</th>");
    expect(markup).toContain("<td>6/10</td><td>2/4</td><td>6/8</td>");
    expect(markup).toContain(`data-player-id="${awayPlayerId}"`);
    expect(markup).toContain('class="postgame-player-name"');
    expect(markup).not.toMatch(/class="postgame-player-name" style=/u);
    expect(markup).not.toContain(`data-player-id="${homePlayerId}"`);
    expect(markup.match(/class="team-leader"/g)).toHaveLength(5);
    expect(markup.split(`--postgame-team-color:${postgameAccentColor("#581c87")}`)).toHaveLength(3);
    expect(markup).toContain(`<b>${state.teams[scheduled.awayTeamId].name}</b>`);
    expect(markup).not.toContain("<em>胜</em>");
  });
});
