import type { GameResult, GameState, SeasonAwardsRecord, Team } from "../state/types";
import { BALANCE_CONFIG } from "../../config/balanceConfig";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value * 100) / 100));

export interface PostseasonTeamMilestone {
  enteredPlayIn: boolean;
  enteredPlayoffs: boolean;
  seriesWins: number;
  conferenceFinals: boolean;
  finalsAppearance: boolean;
  champion: boolean;
}

export function applyFanSupportAfterGame(state: GameState, result: GameResult): void {
  const config = BALANCE_CONFIG.teamCore;
  for (const teamId of [result.homeTeamId, result.awayTeamId]) {
    const team = state.teams[teamId];
    if (!team) continue;
    const won = result.winnerTeamId === teamId;
    team.currentStreak = won ? Math.max(1, team.currentStreak + 1) : Math.min(-1, team.currentStreak - 1);
    const streakDelta = team.currentStreak >= config.gameFanSupport.winningStreakThreshold
      ? config.gameFanSupport.streakBonus
      : team.currentStreak <= -config.gameFanSupport.losingStreakThreshold ? config.gameFanSupport.streakPenalty : 0;
    team.fanSupport = clamp(team.fanSupport + (won ? config.gameFanSupport.win : config.gameFanSupport.loss) + streakDelta);
    const box = teamId === result.homeTeamId ? result.homeBoxScore : result.awayBoxScore;
    const participants = new Set(box?.playerStats.map((stat) => stat.playerId) ?? []);
    const moraleDelta = (won ? config.morale.win : config.morale.loss) + streakDelta;
    for (const playerId of team.playerIds) {
      const player = state.players[playerId];
      if (!player) continue;
      const participationFactor = participants.size === 0 || participants.has(playerId) ? 1 : config.morale.nonParticipantMultiplier;
      player.morale = clamp((player.morale ?? config.morale.default) + moraleDelta * participationFactor);
    }
  }
}

export function applySeasonTeamCoreUpdate(
  state: GameState,
  milestones: Record<string, PostseasonTeamMilestone>,
  awards?: SeasonAwardsRecord,
): void {
  const config = BALANCE_CONFIG.teamCore;
  for (const team of Object.values(state.teams)) {
    const record = state.standings[team.id];
    const milestone = milestones[team.id];
    if (!record || !milestone) continue;

    const fanMilestoneDelta = (milestone.enteredPlayIn ? config.fanMilestones.playIn : 0)
      + (milestone.enteredPlayoffs ? config.fanMilestones.playoffs : 0)
      + milestone.seriesWins * config.fanMilestones.seriesWin
      + (milestone.conferenceFinals ? config.fanMilestones.conferenceFinals : 0)
      + (milestone.finalsAppearance ? config.fanMilestones.finals : 0)
      + (milestone.champion ? config.fanMilestones.champion : 0);
    team.fanSupport = clamp(team.fanSupport + fanMilestoneDelta);

    const winDelta = record.wins < config.reputation.poorSeasonWins ? config.reputation.poorSeasonPenalty
      : record.wins <= config.reputation.mediocreSeasonWins ? config.reputation.mediocreSeasonPenalty : 0;
    let positiveDelta = (milestone.enteredPlayoffs ? config.reputation.playoffs : 0)
      + (milestone.conferenceFinals ? config.reputation.conferenceFinals : 0)
      + (milestone.finalsAppearance ? config.reputation.finals : 0)
      + (milestone.champion ? config.reputation.champion : 0);
    if (awards?.winners.MVP && state.players[awards.winners.MVP]?.teamId === team.id) positiveDelta += config.reputation.mvp;
    if (awards?.winners.ROY && state.players[awards.winners.ROY]?.teamId === team.id) positiveDelta += config.reputation.roy;
    const seasonDelta = Math.max(config.reputation.seasonMinimum, Math.min(config.reputation.seasonMaximum, winDelta + positiveDelta));
    team.franchiseReputation = clamp(team.franchiseReputation + seasonDelta);
    team.currentStreak = 0;
  }
}

export function contenderScore(state: GameState, teamId: string): number {
  const record = state.standings[teamId];
  const games = (record?.wins ?? 0) + (record?.losses ?? 0);
  return games ? clamp(record.wins / games * 100) : 50;
}

export function freeAgentAttraction(state: GameState, team: Team): number {
  const weights = BALANCE_CONFIG.teamCore.freeAgentAttractionWeights;
  return clamp(
    weights.franchiseReputation * team.franchiseReputation
      + weights.fanSupport * team.fanSupport
      + weights.contenderScore * contenderScore(state, team.id)
      + weights.marketRating * team.marketRating,
  );
}
