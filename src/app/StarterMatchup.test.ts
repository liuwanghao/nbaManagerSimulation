import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { createCareer } from "../game/season/career";
import App from "./App";
import { StarterMatchupModal, starterMatchupRows } from "./StarterMatchup";

describe("starter matchup preview", () => {
  it("compares five positional starters and honors a team's saved lineup", () => {
    const state = createCareer("starter-matchup-preview");
    const awayTeam = state.teams[state.userTeamId];
    const homeTeam = Object.values(state.teams).find((team) => team.id !== awayTeam.id)!;
    const awayRows = starterMatchupRows(awayTeam, state.players);
    const homeRows = starterMatchupRows(homeTeam, state.players);

    expect(awayRows.map((row) => row.position)).toEqual(["PG", "SG", "SF", "PF", "C"]);
    expect(new Set(awayRows.map((row) => row.player?.id)).size).toBe(5);
    expect(awayRows.every((row) => row.player && row.player.available && !row.player.injury)).toBe(true);
    expect(homeRows).toHaveLength(5);
    for (const row of awayRows) expect(row.player?.id).toBe(awayTeam.rotationPlan?.starters[row.position]);

    const originalPg = awayTeam.rotationPlan!.starters.PG;
    awayTeam.rotationPlan!.starters.PG = awayTeam.rotationPlan!.starters.SG;
    awayTeam.rotationPlan!.starters.SG = originalPg;
    awayTeam.rotationPlan!.selectionMode = "MANUAL";
    const changedRows = starterMatchupRows(awayTeam, state.players);
    expect(changedRows[0].player?.id).toBe(awayTeam.rotationPlan!.starters.PG);
    expect(changedRows[1].player?.id).toBe(originalPg);

    const markup = renderToStaticMarkup(createElement(StarterMatchupModal, {
      awayTeam, homeTeam, players: state.players, onClose: () => {},
    }));
    expect(markup).toContain("首发对位");
    expect(markup.match(/class="starter-matchup-row"/g)).toHaveLength(5);
    expect(markup.indexOf(awayTeam.fullName)).toBeLessThan(markup.indexOf(homeTeam.fullName));
    expect(markup).toContain(`>${Math.round(calculatePlayerOverall(changedRows[0].player!))}</strong>`);
    expect(markup).toMatch(/class="starter-matchup-player away(?: mismatch)?"[^>]*><div class="starter-matchup-identity"/);
    expect(markup).toMatch(/class="starter-matchup-player home(?: mismatch)?"[^>]*><div class="starter-matchup-rating"/);
  });

  it("keeps away left and home right whether the user is home or away", () => {
    for (const userVenue of ["home", "away"] as const) {
      const state = createCareer(`starter-matchup-${userVenue}-order`);
      const nextGame = state.schedule.find((game) => game.status === "SCHEDULED" && (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId))!;
      if ((userVenue === "home" && nextGame.awayTeamId === state.userTeamId) || (userVenue === "away" && nextGame.homeTeamId === state.userTeamId)) {
        [nextGame.awayTeamId, nextGame.homeTeamId] = [nextGame.homeTeamId, nextGame.awayTeamId];
      }

      const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
      const matchup = markup.split('class="season-command-versus"')[1]?.split('class="season-command-primary"')[0];
      expect(matchup).toContain(`data-venue="away" data-team-id="${nextGame.awayTeamId}"`);
      expect(matchup).toContain(`data-venue="home" data-team-id="${nextGame.homeTeamId}"`);
      expect(matchup!.indexOf('data-venue="away"')).toBeLessThan(matchup!.indexOf('data-venue="home"'));
    }
  });

  it("replaces an injured starter instead of showing the unavailable player", () => {
    const state = createCareer("starter-matchup-injury");
    const team = state.teams[state.userTeamId];
    const originalId = team.rotationPlan!.starters.PG;
    state.players[originalId].available = false;

    const rows = starterMatchupRows(team, state.players);
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.position === "PG")?.player?.id).not.toBe(originalId);
    expect(rows.every((row) => row.player?.id !== originalId)).toBe(true);
  });
});
