import type { AchievementId, GameResult, GameState, SeasonAwardsRecord, SeasonHistoryArchive } from "../state/types";
import { ACHIEVEMENT_IDS, ACHIEVEMENT_LABELS, getGmLevelLabel } from "./AchievementService";

export interface CareerOverview {
  seasons: number;
  regularSeasonWins: number;
  regularSeasonLosses: number;
  playoffWins: number;
  playoffLosses: number;
  championships: number;
  conferenceTitles: number;
  draftCount: number;
  tradeCount: number;
  dynastyScore: number;
  level: string;
}

export type CareerPostseasonStatus =
  | "champion" | "finals" | "conference-finals" | "playoffs" | "play-in" | "regular-season" | "in-progress";

export interface CareerSeasonSummary {
  seasonId: string;
  isCurrent: boolean;
  wins: number;
  losses: number;
  postseason: CareerPostseasonStatus;
  championTeamId: string | null;
  awards: SeasonAwardsRecord["winners"];
  draftCount: number;
  tradeCount: number;
}

export interface CareerMilestone {
  id: AchievementId;
  label: string;
  seasonId: string | null;
  unlockedAt: string | null;
  dayIndex: number | null;
}

export interface FranchiseRecords {
  firstWin: { seasonId: string; date: string; opponentTeamId: string } | null;
  bestSeason: { seasonId: string; wins: number; losses: number; isCurrent: boolean } | null;
  longestWinningStreak: { seasonId: string; wins: number; isCurrent: boolean } | null;
}

function archivedSeasons(state: GameState): SeasonHistoryArchive[] {
  return [...state.history.seasons].sort((a, b) => a.seasonId.localeCompare(b.seasonId));
}

function hasCurrentArchive(state: GameState): boolean {
  return state.history.seasons.some((season) => season.seasonId === state.league.seasonId);
}

function postseasonStatus(season: SeasonHistoryArchive): CareerPostseasonStatus {
  const result = season.userPostseason;
  if (result.champion) return "champion";
  if (result.finalsAppearance) return "finals";
  if (result.conferenceFinals) return "conference-finals";
  if (result.enteredPlayoffs) return "playoffs";
  if (result.enteredPlayIn) return "play-in";
  return "regular-season";
}

/** Combines completed seasons with the live standings, excluding an already archived current season. */
export function getCareerOverview(state: GameState): CareerOverview {
  const seasons = getCareerSeasonSummaries(state);
  const archives = state.history.seasons;
  return {
    seasons: archives.length,
    regularSeasonWins: seasons.reduce((total, season) => total + season.wins, 0),
    regularSeasonLosses: seasons.reduce((total, season) => total + season.losses, 0),
    playoffWins: archives.reduce((total, season) => total + season.userPostseason.playoffWins, 0),
    playoffLosses: archives.reduce((total, season) => total + season.userPostseason.playoffLosses, 0),
    championships: archives.filter((season) => season.userPostseason.champion).length,
    conferenceTitles: archives.filter((season) => season.userPostseason.finalsAppearance).length,
    draftCount: state.gmCareer.draftHistory.length,
    tradeCount: state.gmCareer.tradeHistory.length,
    dynastyScore: state.gmCareer.dynastyScore,
    level: getGmLevelLabel(state),
  };
}

/** Newest first; the live season appears only until that same season is archived. */
export function getCareerSeasonSummaries(state: GameState): CareerSeasonSummary[] {
  const awardsBySeason = new Map(state.history.seasonAwards.map((awards) => [awards.seasonId, awards.winners]));
  const summaries = archivedSeasons(state).map((season): CareerSeasonSummary => ({
    seasonId: season.seasonId,
    isCurrent: false,
    wins: season.standings[state.userTeamId]?.wins ?? 0,
    losses: season.standings[state.userTeamId]?.losses ?? 0,
    postseason: postseasonStatus(season),
    championTeamId: season.championTeamId,
    awards: { ...awardsBySeason.get(season.seasonId) },
    draftCount: state.gmCareer.draftHistory.filter((draft) => draft.seasonId === season.seasonId).length,
    tradeCount: state.gmCareer.tradeHistory.filter((trade) => trade.seasonId === season.seasonId).length,
  }));
  if (!hasCurrentArchive(state)) {
    const standing = state.standings[state.userTeamId];
    summaries.push({
      seasonId: state.league.seasonId,
      isCurrent: true,
      wins: standing?.wins ?? 0,
      losses: standing?.losses ?? 0,
      postseason: "in-progress",
      championTeamId: null,
      awards: { ...awardsBySeason.get(state.league.seasonId) },
      draftCount: state.gmCareer.draftHistory.filter((draft) => draft.seasonId === state.league.seasonId).length,
      tradeCount: state.gmCareer.tradeHistory.filter((trade) => trade.seasonId === state.league.seasonId).length,
    });
  }
  return summaries.sort((a, b) => b.seasonId.localeCompare(a.seasonId));
}

/** Show the latest unlocked milestone first. */
export function getCareerMilestones(state: GameState): CareerMilestone[] {
  return ACHIEVEMENT_IDS.flatMap((id) => {
    const record = state.achievements[id];
    if (!record?.unlocked) return [];
    const day = record.unlockedAt?.match(/:D(\d+)$/u);
    return [{
      id,
      label: ACHIEVEMENT_LABELS[id],
      seasonId: record.seasonId,
      unlockedAt: record.unlockedAt,
      dayIndex: day ? Number(day[1]) : null,
    }];
  }).sort((a, b) =>
    (b.seasonId ?? "").localeCompare(a.seasonId ?? "")
    || (b.dayIndex ?? -1) - (a.dayIndex ?? -1)
    || ACHIEVEMENT_IDS.indexOf(b.id) - ACHIEVEMENT_IDS.indexOf(a.id),
  );
}

function userRegularGames(results: GameResult[], teamId: string): GameResult[] {
  return results.filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
}

/** Only records that can be reconstructed from saved regular-season results. */
export function getFranchiseRecords(state: GameState): FranchiseRecords {
  const summaries = getCareerSeasonSummaries(state);
  const best = summaries.filter((season) => season.wins + season.losses > 0)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.seasonId.localeCompare(b.seasonId))[0];
  const records: FranchiseRecords = {
    firstWin: null,
    bestSeason: best ? { seasonId: best.seasonId, wins: best.wins, losses: best.losses, isCurrent: best.isCurrent } : null,
    longestWinningStreak: null,
  };
  const archiveResults = archivedSeasons(state).map((season) => ({ seasonId: season.seasonId, isCurrent: false, results: season.regularSeasonResults }));
  if (!hasCurrentArchive(state)) archiveResults.push({ seasonId: state.league.seasonId, isCurrent: true, results: state.lightweightResults });
  for (const season of archiveResults) {
    let streak = 0;
    for (const game of userRegularGames(season.results, state.userTeamId)) {
      if (game.winnerTeamId === state.userTeamId) {
        streak += 1;
        if (!records.firstWin) records.firstWin = {
          seasonId: season.seasonId,
          date: game.date,
          opponentTeamId: game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId,
        };
        if (!records.longestWinningStreak || streak > records.longestWinningStreak.wins) {
          records.longestWinningStreak = { seasonId: season.seasonId, wins: streak, isCurrent: season.isCurrent };
        }
      } else streak = 0;
    }
  }
  return records;
}
