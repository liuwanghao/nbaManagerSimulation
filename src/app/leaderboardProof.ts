import { ACHIEVEMENT_IDS, getGmLevelLabel } from "../game/career/AchievementService";
import type { GameState } from "../game/state/types";

const STORAGE_KEY = "basketball-manager-leaderboard-proof-v1";

export function createLeaderboardProof(state: GameState) {
  const current = state.standings[state.userTeamId];
  const proof = {
    version: 1,
    score: state.gmCareer.dynastyScore,
    displayName: `${state.teams[state.userTeamId]?.name ?? "扩军球队"}经理`,
    teamName: state.teams[state.userTeamId]?.fullName ?? "扩军球队",
    teamLogo: state.teams[state.userTeamId]?.logoUrl ?? "",
    title: getGmLevelLabel(state),
    seasonId: state.league.seasonId,
    championships: state.history.champions.filter((champion) => champion.teamId === state.userTeamId).length,
    seasons: state.history.seasons.map((season) => ({
      seasonId: season.seasonId,
      wins: season.standings[state.userTeamId]?.wins ?? 0,
      losses: season.standings[state.userTeamId]?.losses ?? 0,
      ...season.userPostseason,
    })),
    current: state.history.seasons.some((season) => season.seasonId === state.league.seasonId)
      ? null
      : { wins: current?.wins ?? 0, losses: current?.losses ?? 0 },
    achievements: ACHIEVEMENT_IDS.filter((id) => state.achievements[id]?.unlocked),
  };
  return proof;
}

export function saveLeaderboardProof(state: GameState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(createLeaderboardProof(state)));
}
