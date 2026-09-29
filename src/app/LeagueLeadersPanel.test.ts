import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { LeagueLeadersPanel, leagueStatLeaders } from "./LeagueLeadersPanel";

describe("leagueStatLeaders", () => {
  it("keeps the leaderboard empty before any player has played", () => {
    const state = createCareer("league-leaders-empty");
    expect(leagueStatLeaders(state, "pts")).toEqual([]);
  });

  it("ranks five played players by per-game production and resolves ties consistently", () => {
    const state = createCareer("league-leaders-top-five");
    const players = Object.values(state.players);
    for (const player of players) player.seasonStats.games = 0;

    const [first, second, third, fourth, fifth, sixth, seventh] = players;
    first.seasonStats.games = 1;
    first.seasonStats.pts = 10;
    second.seasonStats.games = 2;
    second.seasonStats.pts = 20;
    for (const [player, points] of [[third, 9], [fourth, 8], [fifth, 7], [sixth, 6]] as const) {
      player.seasonStats.games = 1;
      player.seasonStats.pts = points;
    }
    seventh.seasonStats.pts = 1000;
    third.seasonStats.stl = 4;
    fourth.seasonStats.blk = 5;

    expect(leagueStatLeaders(state, "pts").map((player) => player.id)).toEqual([second.id, first.id, third.id, fourth.id, fifth.id]);
    expect(leagueStatLeaders(state, "stl")[0].id).toBe(third.id);
    expect(leagueStatLeaders(state, "blk")[0].id).toBe(fourth.id);
  });

  it("shows one prominent value per board with a smaller points, rebounds and assists summary", () => {
    const state = createCareer("league-leaders-layout");
    const player = Object.values(state.players)[0];
    player.seasonStats.games = 2;
    Object.assign(player.seasonStats, { pts: 42, reb: 18, ast: 12, stl: 4, blk: 2 });

    const markup = renderToStaticMarkup(createElement(LeagueLeadersPanel, { state, onOpenPlayer: () => {} }));
    for (const [label, value] of [
      ["得分", "21.0"], ["篮板", "9.0"], ["助攻", "6.0"],
      ["抢断", "2.0"], ["盖帽", "1.0"],
    ]) {
      const board = markup.match(new RegExp(`<section[^>]*aria-label="${label}榜"[\\s\\S]*?</section>`))?.[0];
      expect(board).toContain(`场均${label}`);
      expect(board?.match(/class="gemini-prospect-avatar league-stat-avatar/gu)).toHaveLength(1);
      expect(board).toContain(`<span class="league-stat-team">${state.teams[player.teamId].name}</span>`);
      expect(board).toContain(`<strong>${value}</strong>`);
      expect(board).toContain("21.0分9.0板6.0助攻");
      expect(board).toContain('title="场均得分、篮板、助攻"');
      expect(board).not.toMatch(/<small>[分板助断帽]<\/small>/u);
      expect(board?.match(/<strong>/gu)).toHaveLength(1);
    }
  });
});
