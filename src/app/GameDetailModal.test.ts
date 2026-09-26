import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { emptyPlayerSeasonStats, type GameResult, type PlayerBoxScore, type TeamBoxScore } from "../game/state/types";
import { GameDetailModal } from "./App";

const box = (teamId: string, playerId: string, pts: number): TeamBoxScore => {
  const stat: PlayerBoxScore = { ...emptyPlayerSeasonStats(), playerId, seconds: 1800, pts, reb: 7, ast: 4, stl: 2, blk: 1 };
  return { teamId, score: pts, playerStats: [stat], totals: {} as TeamBoxScore["totals"] };
};

describe("GameDetailModal", () => {
  it("shows away and home tabs with only the active team's player rows", () => {
    const state = createCareer("postgame-two-team-tabs");
    const scheduled = state.schedule.find((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)!;
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
    expect(markup).toContain(`data-player-id="${awayPlayerId}"`);
    expect(markup).not.toContain(`data-player-id="${homePlayerId}"`);
    expect(markup.match(/class="team-leader"/g)).toHaveLength(5);
    expect(markup).toContain(`--postgame-team-color:${state.teams[scheduled.awayTeamId].primaryColor}`);
    expect(markup).toContain(`<b>${state.teams[scheduled.awayTeamId].name}</b>`);
    expect(markup).not.toContain("<em>胜</em>");
  });
});
