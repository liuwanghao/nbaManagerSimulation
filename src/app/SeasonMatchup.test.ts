import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer, standingsForConference } from "../game/season/career";
import App from "./App";

describe("next-game matchup", () => {
  it("pairs each team's conference rank with its record and keeps the venue legend between teams", () => {
    const state = createCareer("matchup-conference-ranks");
    const game = state.schedule.find((item) => item.status === "SCHEDULED" && (item.awayTeamId === state.userTeamId || item.homeTeamId === state.userTeamId))!;
    state.standings[game.awayTeamId].wins = 12;
    state.standings[game.homeTeamId].losses = 12;

    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain("<small>客场 · 主场</small>");
    for (const [venue, teamId] of [["away", game.awayTeamId], ["home", game.homeTeamId]] as const) {
      const team = state.teams[teamId];
      const rank = standingsForConference(state, team.conference).findIndex((record) => record.teamId === teamId) + 1;
      const card = markup.match(new RegExp(`<button[^>]*data-venue="${venue}" data-team-id="${teamId}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
      expect(card).toBeDefined();
      expect(card).toContain(`<small>${state.standings[teamId].wins}-${state.standings[teamId].losses} · ${team.conference === "WEST" ? "西部" : "东部"}第${rank}</small>`);
      expect(card).toContain("player-rating-tone");
    }
  });
});
