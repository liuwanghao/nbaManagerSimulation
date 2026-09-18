import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import type { GameState, SeasonHistoryArchive } from "../state/types";
import {
  ACHIEVEMENT_IDS,
  evaluateAwardAchievements,
  evaluatePostseasonAchievements,
  evaluateRegularSeasonAchievements,
  rebuildGmCareerFromHistory,
  unlockAchievement,
} from "./AchievementService";

function archive(state: GameState, seasonId: string, wins: number, postseason: Partial<SeasonHistoryArchive["userPostseason"]> = {}): SeasonHistoryArchive {
  return {
    seasonId,
    championTeamId: postseason.champion ? state.userTeamId : "ATL",
    standings: { [state.userTeamId]: { wins, losses: 82 - wins } },
    regularSeasonResults: [],
    userRegularGameDetails: {},
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
      ...postseason,
    },
  };
}

describe("career achievements", () => {
  it("initializes and unlocks the regular-season achievements idempotently", () => {
    const state = createCareer("achievement-regular");
    expect(Object.keys(state.achievements)).toHaveLength(ACHIEVEMENT_IDS.length);
    state.standings[state.userTeamId].wins = 60;
    state.standings[state.userTeamId].losses = 22;
    evaluateRegularSeasonAchievements(state);
    expect(state.achievements.FIRST_WIN.unlocked).toBe(true);
    expect(state.achievements.TEN_WINS.unlocked).toBe(true);
    expect(state.achievements.FIFTY_WIN_SEASON.unlocked).toBe(true);
    expect(state.achievements.SIXTY_WIN_SEASON.unlocked).toBe(true);
    const unlockedAt = state.achievements.FIRST_WIN.unlockedAt;
    unlockAchievement(state, "FIRST_WIN");
    expect(state.achievements.FIRST_WIN.unlockedAt).toBe(unlockedAt);
  });

  it("recognizes homegrown awards and every postseason milestone", () => {
    const state = createCareer("achievement-postseason");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.contract.signedTeamId = state.userTeamId;
    player.contract.signedPhase = "DRAFT";
    evaluateAwardAchievements(state, {
      seasonId: state.league.seasonId,
      allStars: { WEST: [player.id], EAST: [] },
      winners: { ROY: player.id },
    });
    expect(state.achievements.HOMEGROWN_ALL_STAR.unlocked).toBe(true);
    expect(state.achievements.ROOKIE_OF_YEAR.unlocked).toBe(true);

    state.history.champions = [
      { seasonId: "2026-27", teamId: state.userTeamId },
      { seasonId: "2028-29", teamId: state.userTeamId },
    ];
    evaluatePostseasonAchievements(state, {
      enteredPlayIn: true,
      enteredPlayoffs: true,
      seriesWins: 4,
      conferenceFinals: true,
      finalsAppearance: true,
      champion: true,
      playoffWins: 16,
      playoffLosses: 7,
    });
    for (const id of ["FIRST_PLAY_IN", "FIRST_PLAYOFFS", "FIRST_SERIES_WIN", "CONFERENCE_FINALS", "FINALS_APPEARANCE", "FIRST_CHAMPIONSHIP", "DYNASTY_TWO_OF_THREE"] as const) {
      expect(state.achievements[id].unlocked).toBe(true);
    }
  });

  it("rebuilds GM totals and dynasty score from canonical season history", () => {
    const state = createCareer("gm-history");
    state.history.seasons = [
      archive(state, "2026-27", 61, { enteredPlayoffs: true, seriesWins: 3, conferenceFinals: true, finalsAppearance: true, champion: true, playoffWins: 16, playoffLosses: 5 }),
      archive(state, "2027-28", 48, { enteredPlayoffs: true, seriesWins: 1, playoffWins: 5, playoffLosses: 4 }),
    ];
    rebuildGmCareerFromHistory(state);
    expect(state.gmCareer.seasons).toBe(2);
    expect(state.gmCareer.regularSeasonWins).toBe(109);
    expect(state.gmCareer.playoffWins).toBe(21);
    expect(state.gmCareer.championships).toBe(1);
    expect(state.gmCareer.conferenceTitles).toBe(1);
    expect(state.gmCareer.dynastyScore).toBeGreaterThanOrEqual(2200);
  });
});
