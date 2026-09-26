import { getCapSheet } from "../cap/CapSheetService";
import { buildDefaultRotationPlan, effectiveStarterAssignments, normalizeRotationPlan, reconcileRotationAfterRosterChange } from "../roster/RotationPlanService";
import type { GameState, Position } from "../state/types";
import { calculateTeamFitForPlayers, type TeamFitBreakdown } from "../team/TeamFitService";
import { calculateTeamOverallForPlayers, type TeamOverallRating } from "../team/TeamRatingService";
import { evaluateTradeOffer } from "./TradeService";

export interface TradeImpactPreview {
  overallBefore: TeamOverallRating;
  overallAfter: TeamOverallRating;
  fitBefore: TeamFitBreakdown;
  fitAfter: TeamFitBreakdown;
  startersBefore: Record<Position, string>;
  startersAfter: Record<Position, string>;
  minutesBefore: Record<string, number>;
  minutesAfter: Record<string, number>;
  capSpaceBefore: number;
  capSpaceAfter: number;
}

/** Uses the same rotation reconciliation as committing a trade, without changing the saved state. */
export function previewTradeImpact(state: GameState, offerId: string): TradeImpactPreview | null {
  const offer = state.tradeDesk.offers.find((entry) => entry.offerId === offerId);
  if (!offer || !evaluateTradeOffer(state, offerId).legal) return null;
  const team = state.teams[state.userTeamId];
  const beforePlayers = team.playerIds.map((id) => state.players[id]).filter(Boolean);
  const outgoing = new Set(offer.userOutgoingPlayerIds);
  const afterIds = team.playerIds.filter((id) => !outgoing.has(id)).concat(offer.userIncomingPlayerIds);
  const afterPlayers = afterIds.map((id) => structuredClone(state.players[id])).filter(Boolean);
  const replacements = Object.fromEntries(offer.userOutgoingPlayerIds.map((id, index) => [id, offer.userIncomingPlayerIds[index]]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const beforePlan = team.rotationPlan ? normalizeRotationPlan(beforePlayers, team.rotationPlan) : buildDefaultRotationPlan(beforePlayers);
  const afterPlan = reconcileRotationAfterRosterChange(afterPlayers, team.rotationPlan, replacements);
  const projectedState = { ...state, teams: { ...state.teams, [team.id]: { ...team, playerIds: afterIds } } };

  return {
    overallBefore: calculateTeamOverallForPlayers(beforePlayers, beforePlan),
    overallAfter: calculateTeamOverallForPlayers(afterPlayers, afterPlan),
    fitBefore: calculateTeamFitForPlayers(beforePlayers),
    fitAfter: calculateTeamFitForPlayers(afterPlayers),
    startersBefore: effectiveStarterAssignments(beforePlayers, beforePlan),
    startersAfter: effectiveStarterAssignments(afterPlayers, afterPlan),
    minutesBefore: beforePlan.targetMinutes,
    minutesAfter: afterPlan.targetMinutes,
    capSpaceBefore: getCapSheet(state, team.id).availableCapSpace,
    capSpaceAfter: getCapSheet(projectedState, team.id).availableCapSpace,
  };
}
