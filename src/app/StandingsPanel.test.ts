import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer, standingsForConference } from "../game/season/career";
import { resolveDivisionStandings } from "../game/standings/standings";
import { gamesBehind, StandingsPanel, standingsTeamName, streakLabel, winningPercentage } from "./StandingsPanel";

describe("league standings views", () => {
  it("shows full conference standings with record, percentage, games behind and streak", () => {
    const state = createCareer("standings-panel");
    state.standings.SEA.wins = 10;
    state.standings.SEA.losses = 2;
    state.teams.SEA.currentStreak = 3;
    const conferenceStandings = {
      WEST: standingsForConference(state, "WEST"),
      EAST: standingsForConference(state, "EAST"),
    };
    const html = renderToStaticMarkup(createElement(StandingsPanel, { state, view: "WEST", conferenceStandings, onOpenTeam: () => {} }));
    expect((html.match(/<li /gu) ?? [])).toHaveLength(16);
    expect(html).toContain("胜率");
    expect(html).toContain("胜场差");
    expect(html).toContain("近况");
    expect(html).toContain("10-2");
    expect(html).toContain("3连胜");
    expect(html).toContain(".833");
    expect(html).toContain("<b>SEA</b>");
    expect(html).not.toContain("<b>西雅图队</b>");
    expect((html.match(/aria-label="查看[^"]+阵容"/gu) ?? [])).toHaveLength(16);
  });

  it("shows every division with its own ordering and split records", () => {
    const state = createCareer("division-panel");
    state.standings.SEA.wins = 10;
    state.standings.POR.wins = 8;
    state.standings.POR.losses = 4;
    state.standings.POR.conferenceWins = 5;
    state.standings.POR.conferenceLosses = 2;
    state.standings.POR.divisionWins = 3;
    state.standings.POR.divisionLosses = 1;
    const conferenceStandings = {
      WEST: standingsForConference(state, "WEST"),
      EAST: standingsForConference(state, "EAST"),
    };
    const html = renderToStaticMarkup(createElement(StandingsPanel, { state, view: "DIVISION", conferenceStandings, onOpenTeam: () => {} }));
    expect((html.match(/class="division-standings-group"/gu) ?? [])).toHaveLength(8);
    expect((html.match(/<li /gu) ?? [])).toHaveLength(32);
    expect(html).toContain("联盟胜-负");
    expect(html).toContain("分区胜-负");
    expect(html).toContain("5-2");
    expect(html).toContain("3-1");
    expect(resolveDivisionStandings("PACIFIC_NORTHWEST", state.standings, state.teams, state.seeds.seasonSeed)[0].teamId).toBe("SEA");
  });

  it("formats standings values at season start and after games", () => {
    const state = createCareer("standings-values");
    const leader = state.standings.SEA;
    const team = state.standings.POR;
    expect(winningPercentage(team)).toBe(".000");
    expect(gamesBehind(leader, team)).toBe("—");
    leader.wins = 4;
    leader.losses = 1;
    team.wins = 2;
    team.losses = 2;
    expect(gamesBehind(leader, team)).toBe("1.5");
    expect(streakLabel(0)).toBe("—");
    expect(streakLabel(-2)).toBe("2连败");
    expect(standingsTeamName(state.teams.SEA)).toBe("SEA");
    expect(standingsTeamName(state.teams.LAL)).toBe("湖人");
  });
});
