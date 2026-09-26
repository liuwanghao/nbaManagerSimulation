import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import type { GameResult } from "../game/state/types";
import { CareerPages } from "./CareerPages";

describe("career pages", () => {
  it("shows live progress toward win-based achievements", () => {
    const state = createCareer("career-page-progress");
    state.standings[state.userTeamId].wins = 3;
    state.standings[state.userTeamId].losses = 2;
    const html = renderToStaticMarkup(createElement(CareerPages, {
      state,
      activeTab: "achievements",
      onOpenPlayer: () => {},
      onOpenGame: () => {},
    }));
    expect(html).toContain("3 / 10 胜");
    expect(html).toContain("3 / 25 胜");
    expect(html).toContain("3 / 50 胜");
    expect(html).toContain("0 / 28 已解锁");
  });

  it("shows archived season detail, manager moves, and an available game detail entry", () => {
    const state = createCareer("career-page-archive");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const opponent = Object.keys(state.teams).find((id) => id !== state.userTeamId)!;
    const game: GameResult = {
      gameId: "archive-first-win",
      date: "2026-10-20",
      homeTeamId: state.userTeamId,
      awayTeamId: opponent,
      homeScore: 101,
      awayScore: 97,
      winnerTeamId: state.userTeamId,
      overtimePeriods: 0,
    };
    state.history.seasons.push({
      seasonId: state.league.seasonId,
      championTeamId: opponent,
      standings: { [state.userTeamId]: { wins: 1, losses: 0 } },
      regularSeasonResults: [game],
      userRegularGameDetails: { [game.gameId]: game },
      postseasonGameDetails: {},
      userPostseason: {
        enteredPlayIn: false,
        enteredPlayoffs: false,
        seriesWins: 0,
        conferenceFinals: false,
        finalsAppearance: false,
        champion: false,
        playoffWins: 0,
        playoffLosses: 0,
      },
    });
    state.history.seasonAwards.push({ seasonId: state.league.seasonId, allStars: { EAST: [], WEST: [] }, winners: { MVP: player.id } });
    state.gmCareer.draftHistory.push({ seasonId: state.league.seasonId, pickNumber: 6, playerId: player.id });
    state.gmCareer.tradeHistory.push({ seasonId: state.league.seasonId, offerId: "trade-1", summary: "Player A → Player B" });

    const html = renderToStaticMarkup(createElement(CareerPages, {
      state,
      activeTab: "history",
      onOpenPlayer: () => {},
      onOpenGame: () => {},
    }));

    expect(html).toContain("2026-27 赛季");
    expect(html).toContain("赛季首胜");
    expect(html).toContain("选秀 · 第 6 顺位");
    expect(html).toContain("最有价值球员");
    expect(html).toContain("Player A");
    expect(html).toContain("2026-10-20");
  });
});
