import type { AwardType, GameResult, GameState, Player, PlayerCareerRecord, PlayerSeasonStats, SeasonAwardsRecord } from "../state/types";
import { emptyPlayerSeasonStats } from "../state/types";
import { evaluateAwardAchievements } from "../career/AchievementService";
import { enqueueCareerMilestoneEvents } from "../events/EventService";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

type HonorKey = keyof NonNullable<PlayerCareerRecord["honors"]>;

function ensureCareer(player: Player): PlayerCareerRecord {
  player.career ??= {
    seasonsPlayed: 0,
    totals: emptyPlayerSeasonStats(),
    peakOverall: calculatePlayerOverall(player),
    peakImpact: 0,
    unemployedGameDays: 0,
    unemployedLeagueYears: 0,
    careerInjuryGamesMissed: 0,
  };
  player.career.honors ??= { allStar: 0, mvp: 0, dpoy: 0, roy: 0, mip: 0, sixthMan: 0, championships: 0, finalsMvp: 0 };
  player.career.hallOfFameEligibleData ??= player.profileSource !== "HUPU_LIVE_ROSTER";
  return player.career;
}

function perGame(stats: PlayerSeasonStats, key: keyof PlayerSeasonStats): number {
  return stats.games > 0 ? stats[key] / stats.games : 0;
}

function productionScore(player: Player): number {
  const stats = player.seasonStats;
  const weights = BALANCE_CONFIG.awards.productionWeights;
  return perGame(stats, "pts") * weights.points + perGame(stats, "reb") * weights.rebounds + perGame(stats, "ast") * weights.assists
    + perGame(stats, "stl") * weights.steals + perGame(stats, "blk") * weights.blocks + perGame(stats, "tov") * weights.turnovers;
}

function teamWinScore(state: GameState, player: Player): number {
  const record = state.standings[player.teamId];
  return record ? record.wins / Math.max(1, record.wins + record.losses) * BALANCE_CONFIG.awards.teamWinScoreMaximum : 0;
}

function availability(player: Player): number {
  return Math.min(1, player.seasonStats.games / BALANCE_CONFIG.awards.availabilityGames);
}

function awardCandidates(state: GameState): Player[] {
  return Object.values(state.players).filter((player) => state.teams[player.teamId] && player.seasonStats.games >= BALANCE_CONFIG.awards.minimumCandidateGames);
}

function pick(candidates: Player[], score: (player: Player) => number): Player | undefined {
  return [...candidates].sort((left, right) => score(right) - score(left) || left.id.localeCompare(right.id))[0];
}

function recordHonor(player: Player, key: HonorKey): void {
  const honors = ensureCareer(player).honors as NonNullable<PlayerCareerRecord["honors"]>;
  honors[key] += 1;
}

function currentRecord(state: GameState): SeasonAwardsRecord {
  let record = state.history.seasonAwards.find((entry) => entry.seasonId === state.league.seasonId);
  if (!record) {
    record = { seasonId: state.league.seasonId, allStars: { WEST: [], EAST: [] }, winners: {} };
    state.history.seasonAwards.push(record);
  }
  return record;
}

function selectAllStars(state: GameState, record: SeasonAwardsRecord): void {
  for (const conference of ["WEST", "EAST"] as const) {
    if (record.allStars[conference].length === BALANCE_CONFIG.awards.allStarsPerConference) continue;
    const candidates = awardCandidates(state).filter((player) => state.teams[player.teamId].conference === conference);
    record.allStars[conference] = [...candidates]
      .sort((left, right) => {
        const score = (player: Player) => (productionScore(player) + teamWinScore(state, player)) * availability(player);
        return score(right) - score(left) || left.id.localeCompare(right.id);
      })
      .slice(0, BALANCE_CONFIG.awards.allStarsPerConference)
      .map((player) => player.id);
    for (const playerId of record.allStars[conference]) recordHonor(state.players[playerId], "allStar");
  }
}

function previousProduction(player: Player): number {
  const previous = player.career?.lastSeasonStats;
  if (!previous || previous.games < BALANCE_CONFIG.awards.mostImproved.previousSeasonMinimumGames) return 0;
  const weights = BALANCE_CONFIG.awards.productionWeights;
  return perGame(previous, "pts") * weights.points + perGame(previous, "reb") * weights.rebounds + perGame(previous, "ast") * weights.assists
    + perGame(previous, "stl") * weights.steals + perGame(previous, "blk") * weights.blocks + perGame(previous, "tov") * weights.turnovers;
}

function awardWinner(state: GameState, type: AwardType, candidates: Player[]): Player | undefined {
  if (type === "MVP") return pick(candidates, (player) => (productionScore(player) + teamWinScore(state, player)) * availability(player));
  if (type === "DPOY") return pick(candidates, (player) => (
    perGame(player.seasonStats, "stl") * BALANCE_CONFIG.awards.dpoyWeights.steals + perGame(player.seasonStats, "blk") * BALANCE_CONFIG.awards.dpoyWeights.blocks
    + perGame(player.seasonStats, "reb") * BALANCE_CONFIG.awards.dpoyWeights.rebounds
    + player.attributes.perimeterDefense * BALANCE_CONFIG.awards.dpoyWeights.perimeterDefense
    + player.attributes.interiorDefense * BALANCE_CONFIG.awards.dpoyWeights.interiorDefense
    + teamWinScore(state, player) * BALANCE_CONFIG.awards.dpoyWeights.teamWins
  ) * availability(player));
  if (type === "ROY") {
    const rookie = BALANCE_CONFIG.awards.rookie;
    const rookies = candidates.filter((player) => player.serviceYears <= rookie.maximumServiceYears && player.age <= rookie.maximumAge);
    return pick(rookies.length ? rookies : candidates.filter((player) => player.age <= rookie.maximumAge), (player) => productionScore(player) * availability(player));
  }
  if (type === "MIP") {
    const improvedConfig = BALANCE_CONFIG.awards.mostImproved;
    const improved = candidates.filter((player) => player.seasonStats.games >= improvedConfig.minimumGames && previousProduction(player) > 0);
    return pick(improved.length ? improved : candidates.filter((player) => player.age <= improvedConfig.fallbackMaximumAge),
      (player) => productionScore(player) - previousProduction(player) + player.seasonStats.games / improvedConfig.seasonGamesDivisor);
  }
  if (type === "SIXTH_MAN") {
    const bench = candidates.filter((player) => player.rotationRole === "SIXTH_MAN");
    return pick(bench, (player) => productionScore(player) * availability(player));
  }
  return undefined;
}

const HONOR_BY_AWARD: Partial<Record<AwardType, HonorKey>> = {
  MVP: "mvp", DPOY: "dpoy", ROY: "roy", MIP: "mip", SIXTH_MAN: "sixthMan", FINALS_MVP: "finalsMvp",
};

export function finalizeRegularSeasonAwards(input: GameState): GameState {
  const state = structuredClone(input);
  state.history.seasonAwards ??= [];
  const record = currentRecord(state);
  if (record.winners.MVP) return state;
  selectAllStars(state, record);
  const candidates = awardCandidates(state);
  for (const type of ["MVP", "DPOY", "ROY", "MIP", "SIXTH_MAN"] as const) {
    const winner = awardWinner(state, type, candidates);
    if (!winner) continue;
    record.winners[type] = winner.id;
    recordHonor(winner, HONOR_BY_AWARD[type] as HonorKey);
  }
  evaluateAwardAchievements(state, record);
  enqueueCareerMilestoneEvents(state);
  return state;
}

export function finalizeFinalsAwards(state: GameState, championTeamId: string, finalsGames: GameResult[]): void {
  const record = currentRecord(state);
  for (const playerId of state.teams[championTeamId].playerIds) recordHonor(state.players[playerId], "championships");
  const totals = new Map<string, number>();
  for (const game of finalsGames) {
    for (const box of [game.homeBoxScore, game.awayBoxScore]) {
      if (box?.teamId !== championTeamId) continue;
      for (const stat of box.playerStats) {
        const weights = BALANCE_CONFIG.awards.productionWeights;
        const value = stat.pts * weights.points + stat.reb * weights.rebounds + stat.ast * weights.assists
          + stat.stl * weights.steals + stat.blk * weights.blocks + stat.tov * weights.turnovers;
        totals.set(stat.playerId, (totals.get(stat.playerId) ?? 0) + value);
      }
    }
  }
  const winner = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (winner) {
    record.winners.FINALS_MVP = winner;
    recordHonor(state.players[winner], "finalsMvp");
  }
}
