import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { buildDefaultRotationPlan, normalizeRotationPlan } from "../roster/RotationPlanService";
import type { GameState, Player, Team, TeamRotationPlan } from "../state/types";

export interface TeamOverallRating {
  overall: number;
  raw: number;
}

function usablePlan(players: Player[], plan?: TeamRotationPlan): TeamRotationPlan | undefined {
  const availableCount = players.filter((player) => player.available && !player.injury).length;
  const minimumForMinuteCapacity = Math.ceil(
    BALANCE_CONFIG.rotationPlan.regulationMinutes / BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes,
  );
  if (availableCount < Math.max(BALANCE_CONFIG.rotationPlan.minimumActivePlayers, minimumForMinuteCapacity)) return undefined;
  return plan ? normalizeRotationPlan(players, plan) : buildDefaultRotationPlan(players);
}

export function calculateTeamOverallForPlayers(players: Player[], plan?: TeamRotationPlan): TeamOverallRating {
  if (!players.length) return { overall: BALANCE_CONFIG.teamOverall.minimum, raw: 0 };
  const rotation = usablePlan(players, plan);
  const totalMinutes = Object.values(rotation?.targetMinutes ?? {}).reduce((sum, value) => sum + value, 0);
  const availablePlayers = players.filter((player) => player.available && !player.injury);
  const fallbackPlayers = availablePlayers.length ? availablePlayers : players;
  const raw = totalMinutes > 0
    ? players.reduce((sum, player) => sum + calculatePlayerOverall(player) * (rotation?.targetMinutes[player.id] ?? 0) / totalMinutes, 0)
    : fallbackPlayers.reduce((sum, player) => sum + calculatePlayerOverall(player), 0) / fallbackPlayers.length;
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
