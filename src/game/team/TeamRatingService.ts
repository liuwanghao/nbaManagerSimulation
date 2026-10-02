import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { GameState, Player, Team, TeamRotationPlan } from "../state/types";

export interface TeamOverallRating {
  overall: number;
  raw: number;
}

export function calculateTeamOverallForPlayers(players: Player[], _plan?: TeamRotationPlan): TeamOverallRating {
  if (!players.length) return { overall: BALANCE_CONFIG.teamOverall.minimum, raw: 0 };
  const availablePlayers = players.filter((player) => player.available && !player.injury);
  const rankedPlayers = (availablePlayers.length >= 8 ? availablePlayers : players)
    .map((player) => ({ player, overall: calculatePlayerOverall(player) }))
    .sort((left, right) => right.overall - left.overall || left.player.id.localeCompare(right.player.id));
  const corePlayers = rankedPlayers.slice(0, 8);
  const depthPlayers = rankedPlayers.slice(8, 12);
  const coreAverage = corePlayers.reduce((sum, entry) => sum + entry.overall, 0) / corePlayers.length;
  const depthAverage = depthPlayers.length
    ? depthPlayers.reduce((sum, entry) => sum + entry.overall, 0) / depthPlayers.length
    : coreAverage;
  const raw = coreAverage * 0.9 + depthAverage * 0.1;
  const mapped = raw * BALANCE_CONFIG.teamOverall.rawScale + BALANCE_CONFIG.teamOverall.rawOffset;
  return {
    raw,
    overall: Math.round(Math.max(BALANCE_CONFIG.teamOverall.minimum, Math.min(BALANCE_CONFIG.teamOverall.maximum, mapped))),
  };
}

export function calculateTeamOverall(state: GameState, teamId: string): TeamOverallRating {
  const team = state.teams[teamId];
  return calculateTeamOverallForTeam(team, state.players);
}

export function calculateTeamOverallForTeam(team: Team, players: Record<string, Player>): TeamOverallRating {
  return calculateTeamOverallForPlayers(team.playerIds.map((id) => players[id]).filter(Boolean), team.rotationPlan);
}
