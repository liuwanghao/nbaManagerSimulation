import type { ExpansionCityId, ExpansionPick, GameState, Player, Position } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { playerNameZh } from "./playerNameZh";

export type ExpansionPositionFilter = "ALL" | Position;
export type ExpansionPlayerSort = "OVERALL" | "AGE" | "SALARY" | "CONTRACT";

export const EXPANSION_POSITION_FILTERS: ExpansionPositionFilter[] = ["ALL", "PG", "SG", "SF", "PF", "C"];

/**
 * The expansion draft and free-agency screens intentionally use the same
 * roster snapshot.  Keeping the team lookup here prevents one screen from
 * drifting to a different source (for example, userTeamId versus the active
 * expansion team) as the career moves through offseason phases.
 */
export function getCurrentTeamId(state: GameState): string {
  const expansionTeamId = state.expansion?.playerTeamId;
  return expansionTeamId && state.teams[expansionTeamId] ? expansionTeamId : state.userTeamId;
}

export function getCurrentTeamRoster(state: GameState): Player[] {
  const team = state.teams[getCurrentTeamId(state)];
  if (!team) return [];
  return team.playerIds
    .map((playerId) => state.players[playerId])
    .filter((player): player is Player => Boolean(player))
    .sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
}

export function getCurrentRosterPositionCounts(roster: Player[]): Array<{ position: Position; count: number }> {
  return (["PG", "SG", "SF", "PF", "C"] as const).map((position) => ({
    position,
    count: roster.filter((player) => player.position === position).length,
  }));
}

export function getCurrentRosterPositionSummary(roster: Player[]): string {
  return getCurrentRosterPositionCounts(roster).map(({ position, count }) => `${position} ${count}`).join(" · ");
}

export function matchesExpansionPosition(player: Player, position: ExpansionPositionFilter): boolean {
  return position === "ALL" || player.position === position;
}

export function sortExpansionPlayersByOverall(players: Player[]): Player[] {
  return [...players].sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
}

export function filterExpansionPlayers(players: Player[], teamId: string, position: ExpansionPositionFilter): Player[] {
  return sortExpansionPlayersByOverall(players.filter((player) => (teamId === "ALL" || player.teamId === teamId) && matchesExpansionPosition(player, position)));
}

export function getRecentExpansionPickBroadcasts(state: GameState): Array<{ pickNumber: number; teamName: string; sourceTeamName: string; playerName: string }> {
  const picks = state.expansion?.picks ?? [];
  return [...picks]
    .sort((left, right) => left.pickNumber - right.pickNumber)
    .slice(-3)
    .map((pick) => ({
      pickNumber: pick.pickNumber,
      teamName: state.teams[pick.teamId].fullName.replace(/\s+/g, ""),
      sourceTeamName: state.teams[pick.sourceTeamId].fullName,
      playerName: playerNameZh(state.players[pick.playerId].name, pick.playerId),
    }));
}

export function getExpansionDraftRecap(state: GameState): Array<{ teamId: ExpansionCityId; picks: ExpansionPick[] }> {
  const expansion = state.expansion;
  if (!expansion) return [];
  return [expansion.playerTeamId, expansion.aiTeamId].map((teamId) => ({
    teamId,
    picks: expansion.picks.filter((pick) => pick.teamId === teamId).sort((left, right) => left.pickNumber - right.pickNumber),
  }));
}

export function findExpansionDraftPlayers(players: Player[], teamId: string, position: ExpansionPositionFilter, search: string, sort: ExpansionPlayerSort): Player[] {
  const query = search.trim().toLocaleLowerCase();
  const matching = players.filter((player) =>
    (teamId === "ALL" || player.teamId === teamId)
    && matchesExpansionPosition(player, position)
    && (!query || `${player.name} ${playerNameZh(player.name, player.id)}`.toLocaleLowerCase().includes(query)));
  return matching.sort((left, right) => {
    const primary = sort === "AGE" ? left.age - right.age
      : sort === "SALARY" ? left.contract.salary - right.contract.salary
        : sort === "CONTRACT" ? left.contract.yearsRemaining - right.contract.yearsRemaining
          : calculatePlayerOverall(right) - calculatePlayerOverall(left);
    return primary || calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id);
  });
}

export function getExpansionRosterGaps(roster: Player[]): Array<{ position: Position; count: number; gap: number }> {
  return getCurrentRosterPositionCounts(roster).map(({ position, count }) => ({ position, count, gap: Math.max(0, 2 - count) }));
}

export function findNextSelectableTeamId(
  teamIds: string[],
  currentTeamId: string,
  players: Player[],
  position: ExpansionPositionFilter,
): string | undefined {
  const currentIndex = teamIds.indexOf(currentTeamId);
  if (currentIndex < 0 || teamIds.length < 2) return undefined;

  const followingTeams = teamIds
    .map((_, offset) => teamIds[(currentIndex + offset + 1) % teamIds.length])
    .filter((teamId) => teamId !== currentTeamId);
  const hasAvailablePlayer = (teamId: string, activePosition: ExpansionPositionFilter) =>
    players.some((player) => player.teamId === teamId && matchesExpansionPosition(player, activePosition));

  return followingTeams.find((teamId) => hasAvailablePlayer(teamId, position))
    ?? (position === "ALL" ? undefined : followingTeams.find((teamId) => hasAvailablePlayer(teamId, "ALL")));
}
