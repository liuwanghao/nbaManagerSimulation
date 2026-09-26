import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { LeagueSchedulePanel, nearestScheduleDate } from "./LeagueSchedulePanel";

describe("league schedule", () => {
  it("picks the nearest game date", () => {
    expect(nearestScheduleDate(["2026-10-20", "2026-10-23", "2026-10-25"], "2026-10-21")).toBe("2026-10-23");
    expect(nearestScheduleDate(["2026-10-20", "2026-10-23"], "2026-10-30")).toBe("2026-10-23");
  });

  it("shows all league scores without filters or detail links", () => {
    const state = createCareer("league-schedule-result");
    const userGame = state.schedule[0];
    userGame.status = "FINAL";
    userGame.awayScore = 101;
    userGame.homeScore = 104;
    const html = renderToStaticMarkup(createElement(LeagueSchedulePanel, { state, currentDate: userGame.date }));
    expect(html).toContain("已结束");
    expect(html).toContain("101");
    expect(html).toContain("104");
    expect(html).not.toContain("查看比赛详情");
    expect(html).not.toContain("筛选球队");
    expect((html.match(/class="league-schedule-matchup"/g) ?? []).length).toBe(state.schedule.filter((game) => game.date === userGame.date).length);
  });
});
