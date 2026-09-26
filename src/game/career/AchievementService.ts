import type { AchievementId, AchievementRecord, GameState, SeasonAwardsRecord, SeasonHistoryArchive } from "../state/types";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

export const ACHIEVEMENT_IDS: AchievementId[] = [
  "EXPANSION_COMPLETE", "FIRST_WIN", "TEN_WINS", "TWENTY_FIVE_WINS", "FIFTY_CAREER_WINS", "HUNDRED_WINS", "TWO_HUNDRED_WINS",
  "THIRTY_WIN_SEASON", "FORTY_WIN_SEASON", "FIFTY_WIN_SEASON", "SIXTY_WIN_SEASON",
  "FIRST_PLAY_IN", "FIRST_PLAYOFFS", "FIRST_SERIES_WIN", "TWO_SERIES_WINS", "THREE_SERIES_WINS",
  "CONFERENCE_FINALS", "FINALS_APPEARANCE", "FIRST_CHAMPIONSHIP", "SECOND_CHAMPIONSHIP", "THIRD_CHAMPIONSHIP",
  "HOMEGROWN_ALL_STAR", "ROOKIE_OF_YEAR", "MVP_WINNER", "DPOY_WINNER", "MOST_IMPROVED_WINNER", "SIXTH_MAN_WINNER", "DYNASTY_TWO_OF_THREE",
];

const NEW_CAREER_WIN_IDS = ["TWENTY_FIVE_WINS", "FIFTY_CAREER_WINS", "HUNDRED_WINS", "TWO_HUNDRED_WINS"] as const;
const NEW_SEASON_WIN_IDS = ["THIRTY_WIN_SEASON", "FORTY_WIN_SEASON"] as const;
const NEW_SERIES_IDS = ["TWO_SERIES_WINS", "THREE_SERIES_WINS"] as const;
const NEW_TITLE_IDS = ["SECOND_CHAMPIONSHIP", "THIRD_CHAMPIONSHIP"] as const;

export const ACHIEVEMENT_LABELS: Record<AchievementId, string> = Object.fromEntries(
  ACHIEVEMENT_IDS.map((id) => [id, BALANCE_CONFIG.achievements[id].label]),
) as Record<AchievementId, string>;

export function createAchievementState(): Record<AchievementId, AchievementRecord> {
  return Object.fromEntries(ACHIEVEMENT_IDS.map((id) => [id, { unlocked: false, unlockedAt: null, seasonId: null }])) as Record<AchievementId, AchievementRecord>;
}

export function createGmCareerState(): GameState["gmCareer"] {
  return {
    seasons: 0,
    regularSeasonWins: 0,
    regularSeasonLosses: 0,
    playoffWins: 0,
    playoffLosses: 0,
    championships: 0,
    conferenceTitles: 0,
    draftHistory: [],
    tradeHistory: [],
    dynastyScore: 0,
  };
}

export function getGmLevelLabel(state: GameState): string {
  if (state.gmCareer.championships >= 4 || state.gmCareer.dynastyScore >= 7_500) return "传奇经理";
  if (state.gmCareer.championships >= 2 || state.gmCareer.dynastyScore >= 4_000) return "王朝经理";
  if (state.gmCareer.championships >= 1) return "冠军经理";
  if (state.gmCareer.dynastyScore >= 1_500) return "联盟精英";
  if (state.gmCareer.seasons >= 2) return "优秀经理";
  return "新手经理";
}

export function unlockAchievement(state: GameState, id: AchievementId): void {
  const achievement = state.achievements[id];
  if (achievement.unlocked) return;
  achievement.unlocked = true;
  achievement.unlockedAt = `${state.league.seasonId}:D${state.calendar.currentDateIndex}`;
  achievement.seasonId = state.league.seasonId;
  state.gmCareer.dynastyScore += BALANCE_CONFIG.achievements[id].reward.dynastyScore;
}

export function evaluateRegularSeasonAchievements(state: GameState): void {
  const current = state.standings[state.userTeamId];
  const historicalWins = state.history.seasons.reduce((sum, season) => sum + (season.standings[state.userTeamId]?.wins ?? 0), 0);
  const careerWins = historicalWins + current.wins;
  if (careerWins >= BALANCE_CONFIG.achievements.FIRST_WIN.trigger.value) unlockAchievement(state, "FIRST_WIN");
  if (careerWins >= BALANCE_CONFIG.achievements.TEN_WINS.trigger.value) unlockAchievement(state, "TEN_WINS");
  for (const id of NEW_CAREER_WIN_IDS) if (careerWins >= BALANCE_CONFIG.achievements[id].trigger.value) unlockAchievement(state, id);
  for (const id of NEW_SEASON_WIN_IDS) if (current.wins >= BALANCE_CONFIG.achievements[id].trigger.value) unlockAchievement(state, id);
  if (current.wins >= BALANCE_CONFIG.achievements.FIFTY_WIN_SEASON.trigger.value) unlockAchievement(state, "FIFTY_WIN_SEASON");
  if (current.wins >= BALANCE_CONFIG.achievements.SIXTY_WIN_SEASON.trigger.value) unlockAchievement(state, "SIXTY_WIN_SEASON");
}

export function evaluateAwardAchievements(state: GameState, awards: SeasonAwardsRecord): void {
  const homegrownAllStar = [...awards.allStars.WEST, ...awards.allStars.EAST]
    .map((id) => state.players[id])
    .some((player) => player?.contract.signedTeamId === state.userTeamId && player.contract.signedPhase === "DRAFT");
  if (homegrownAllStar) unlockAchievement(state, "HOMEGROWN_ALL_STAR");
  const roy = awards.winners.ROY ? state.players[awards.winners.ROY] : undefined;
  if (roy?.teamId === state.userTeamId) unlockAchievement(state, "ROOKIE_OF_YEAR");
  for (const [award, id] of [
    ["MVP", "MVP_WINNER"], ["DPOY", "DPOY_WINNER"], ["MIP", "MOST_IMPROVED_WINNER"], ["SIXTH_MAN", "SIXTH_MAN_WINNER"],
  ] as const) {
    const winner = awards.winners[award];
    if (winner && state.players[winner]?.teamId === state.userTeamId) unlockAchievement(state, id);
  }
}

export function evaluatePostseasonAchievements(state: GameState, postseason: SeasonHistoryArchive["userPostseason"]): void {
  if (postseason.enteredPlayIn) unlockAchievement(state, "FIRST_PLAY_IN");
  if (postseason.enteredPlayoffs) unlockAchievement(state, "FIRST_PLAYOFFS");
  if (postseason.seriesWins > 0) unlockAchievement(state, "FIRST_SERIES_WIN");
  for (const id of NEW_SERIES_IDS) if (postseason.seriesWins >= BALANCE_CONFIG.achievements[id].trigger.value) unlockAchievement(state, id);
  if (postseason.conferenceFinals) unlockAchievement(state, "CONFERENCE_FINALS");
  if (postseason.finalsAppearance) unlockAchievement(state, "FINALS_APPEARANCE");
  if (postseason.champion) unlockAchievement(state, "FIRST_CHAMPIONSHIP");
  const championships = state.history.champions
    .filter((entry) => entry.teamId === state.userTeamId)
    .map((entry) => entry.seasonId);
  for (const id of NEW_TITLE_IDS) if (championships.length >= BALANCE_CONFIG.achievements[id].trigger.value) unlockAchievement(state, id);
  const seasonYears = championships.map((seasonId) => Number(seasonId.slice(0, 4))).sort((a, b) => a - b);
  const dynasty = BALANCE_CONFIG.achievements.DYNASTY_TWO_OF_THREE.trigger;
  if (seasonYears.some((year, index) => seasonYears.slice(index, index + dynasty.value).length === dynasty.value
    && seasonYears[index + dynasty.value - 1] - year < dynasty.window)) {
    unlockAchievement(state, "DYNASTY_TWO_OF_THREE");
  }
}

/** Restore newly introduced milestones from facts retained in older saves. */
export function backfillNewAchievements(state: GameState): void {
  const mark = (id: AchievementId, seasonId: string) => {
    if (state.achievements[id].unlocked) return;
    state.achievements[id] = { unlocked: true, seasonId, unlockedAt: null };
    state.gmCareer.dynastyScore += BALANCE_CONFIG.achievements[id].reward.dynastyScore;
  };
  let careerWins = 0;
  let titles = 0;
  for (const season of [...state.history.seasons].sort((a, b) => a.seasonId.localeCompare(b.seasonId))) {
    const wins = season.standings[state.userTeamId]?.wins ?? 0;
    careerWins += wins;
    for (const id of NEW_CAREER_WIN_IDS) if (careerWins >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, season.seasonId);
    for (const id of NEW_SEASON_WIN_IDS) if (wins >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, season.seasonId);
    for (const id of NEW_SERIES_IDS) if (season.userPostseason.seriesWins >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, season.seasonId);
    if (season.userPostseason.champion) titles += 1;
    for (const id of NEW_TITLE_IDS) if (titles >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, season.seasonId);
  }
  if (!state.history.seasons.some((season) => season.seasonId === state.league.seasonId)) {
    const currentWins = state.standings[state.userTeamId]?.wins ?? 0;
    for (const id of NEW_CAREER_WIN_IDS) if (careerWins + currentWins >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, state.league.seasonId);
    for (const id of NEW_SEASON_WIN_IDS) if (currentWins >= BALANCE_CONFIG.achievements[id].trigger.value) mark(id, state.league.seasonId);
  }
}

function seasonDynastyScore(season: SeasonHistoryArchive, userTeamId: string): number {
  const record = season.standings[userTeamId];
  const config = BALANCE_CONFIG.dynastyScore;
  let score = 0;
  if (season.userPostseason.enteredPlayoffs) score += config.playoffs;
  if (season.userPostseason.seriesWins >= 1) score += config.seriesWin;
  if (season.userPostseason.conferenceFinals) score += config.conferenceFinals;
  if (season.userPostseason.finalsAppearance) score += config.finals;
  if (season.userPostseason.champion) score += config.championship;
  if ((record?.wins ?? 0) >= config.eliteSeasonWins) score += config.eliteSeason;
  return score;
}

export function rebuildGmCareerFromHistory(state: GameState): void {
  const drafts = state.gmCareer.draftHistory;
  const trades = state.gmCareer.tradeHistory;
  const archives = state.history.seasons;
  const userRecords = archives.map((season) => season.standings[state.userTeamId]).filter(Boolean);
  const userPostseasons = archives.map((season) => season.userPostseason);
  const draftedPlayers = drafts.map((entry) => state.players[entry.playerId]).filter(Boolean)
    .sort((left, right) => {
      return calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id);
    });
  state.gmCareer = {
    ...state.gmCareer,
    seasons: archives.length,
    regularSeasonWins: userRecords.reduce((sum, record) => sum + record.wins, 0),
    regularSeasonLosses: userRecords.reduce((sum, record) => sum + record.losses, 0),
    playoffWins: userPostseasons.reduce((sum, season) => sum + season.playoffWins, 0),
    playoffLosses: userPostseasons.reduce((sum, season) => sum + season.playoffLosses, 0),
    championships: userPostseasons.filter((season) => season.champion).length,
    conferenceTitles: userPostseasons.filter((season) => season.finalsAppearance).length,
    draftHistory: drafts,
    tradeHistory: trades,
    bestPlayerDrafted: draftedPlayers[0]?.id,
    dynastyScore: archives.reduce((sum, season) => sum + seasonDynastyScore(season, state.userTeamId), 0)
      + ACHIEVEMENT_IDS.reduce((sum, id) => sum + (state.achievements[id].unlocked ? BALANCE_CONFIG.achievements[id].reward.dynastyScore : 0), 0),
  };
}
