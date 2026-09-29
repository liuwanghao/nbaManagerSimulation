import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { tradePlayerValue } from "./TradePlayerValue";
import { targetDirection } from "../ai/AIManagementService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { ExpansionStrategy, GameState, Player, TeamDirection } from "../state/types";

/** AI teams protect their current franchise players. The manager retains control of their own roster. */
export function untouchablePlayerIds(state: GameState, teamId: string): string[] {
  const team = state.teams[teamId];
  if (!team || teamId === state.userTeamId) return [];
  const rules = BALANCE_CONFIG.trade.untouchable;
  const explicitIds = rules.explicitPlayerIds.filter((id) => {
    const player = state.players[id];
    return player?.teamId === teamId && team.playerIds.includes(id)
      && player.contract.status === "STANDARD" && player.contract.yearsRemaining > 0
      && player.contract.contractType !== "EMERGENCY";
  });
  const direction: TeamDirection = state.aiTeamProfiles[teamId]?.direction ?? targetDirection(state, teamId);
  const strategy: ExpansionStrategy = direction === "REBUILD" || direction === "RETOOL"
    ? "FUTURE_FIRST" : direction === "CONTEND" ? "WIN_NOW" : "BALANCED";
  const ageLimit = BALANCE_CONFIG.trade.untouchable.maximumAgeByDirection[direction];
  const ranked = team.playerIds
    .map((id) => state.players[id])
    .filter((player): player is Player => Boolean(player) && player.teamId === teamId
      && player.contract.status === "STANDARD" && player.contract.yearsRemaining > 0
      && player.contract.contractType !== "EMERGENCY" && player.age <= ageLimit
      && calculatePlayerOverall(player) >= BALANCE_CONFIG.trade.untouchable.minimumOverall)
    .map((player) => ({ player, overall: calculatePlayerOverall(player), value: tradePlayerValue(player, strategy) }))
    .sort((left, right) => right.value - left.value || right.overall - left.overall || left.player.id.localeCompare(right.player.id));
  const first = ranked[0];
  const rankedIds: string[] = [];
  if (first && first.overall >= rules.firstOverall && first.value >= rules.firstValue) {
    rankedIds.push(first.player.id);
    const second = ranked[1];
    if (second && second.value >= rules.secondValue && first.value - second.value <= rules.secondMaximumGap) {
      rankedIds.push(second.player.id);
      const third = ranked[2];
      if (third && third.value >= rules.thirdValue && first.value - third.value <= rules.thirdMaximumGap
        && second.value - third.value <= rules.thirdToSecondMaximumGap) rankedIds.push(third.player.id);
    }
  }
  const explicitSet = new Set<string>(explicitIds);
  const topRankedId = rankedIds[0];
  const protectedIds = [...explicitIds, ...(topRankedId && !explicitSet.has(topRankedId) ? [topRankedId] : [])];
  const protectedSet = new Set(protectedIds);
  return [...protectedIds, ...rankedIds.filter((id) => !protectedSet.has(id))].slice(0, Math.max(3, protectedIds.length));
}

export function isUntouchable(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  if (!player || player.teamId === state.userTeamId || !state.teams[player.teamId]?.playerIds.includes(playerId)) return false;
  return untouchablePlayerIds(state, player.teamId).includes(playerId);
}
