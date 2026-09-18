import { LEAGUE_FINANCE_CONFIG, type LeagueFinanceConfig } from "../../config/leagueFinance";
import type { GameState } from "../state/types";

export interface CapSheet {
  teamId: string;
  activeContractSalary: number;
  deadMoney: number;
  capHolds: number;
  activeOfferReservations: number;
  incompleteRosterCharges: number;
  total: number;
  availableCapSpace: number;
  activeStandardContracts: number;
}

export function getCapSheet(
  state: GameState,
  teamId: string,
  config: LeagueFinanceConfig = LEAGUE_FINANCE_CONFIG,
): CapSheet {
  const team = state.teams[teamId];
  if (!team) throw new Error(`Unknown team: ${teamId}`);
  const activePlayers = team.playerIds.map((id) => state.players[id]).filter((player) =>
    player && player.contract.status === "STANDARD" && player.contract.yearsRemaining > 0);
  const standardContractSalary = activePlayers
    .filter((player) => player.contract.contractType !== "EMERGENCY")
    .reduce((total, player) => total + player.contract.salary, 0);
  const emergencySalary = (state.capState.emergencySalaryCharges ?? [])
    .filter((charge) => charge.teamId === teamId && charge.seasonId === state.league.seasonId)
    .reduce((total, charge) => total + charge.amount, 0);
  const activeContractSalary = standardContractSalary + emergencySalary;
  const deadMoney = (state.capState?.deadMoney ?? []).filter((entry) => entry.teamId === teamId)
    .reduce((total, entry) => total + (entry.salaryBySeason[state.league.seasonId] ?? 0), 0);
  const holds = (state.capState?.capHolds ?? []).filter((entry) => entry.teamId === teamId);
  const capHolds = holds.reduce((total, entry) => total + entry.amount, 0);
  const reservations = (state.capState?.offerReservations ?? []).filter((entry) => entry.teamId === teamId);
  const activeOfferReservations = reservations.reduce((total, entry) => {
    const hold = holds.find((candidate) => candidate.playerId === entry.playerId)?.amount ?? 0;
    return total + Math.max(0, entry.amount - hold);
  }, 0);
  const occupiedSlots = activePlayers.length + holds.length;
  const incompleteRosterCharges = Math.max(0, config.incompleteRosterMinimumSlots - occupiedSlots) * config.rookieMinimumSalary;
  const total = activeContractSalary + deadMoney + capHolds + activeOfferReservations + incompleteRosterCharges;
  return {
    teamId,
    activeContractSalary,
    deadMoney,
    capHolds,
    activeOfferReservations,
    incompleteRosterCharges,
    total,
    availableCapSpace: config.salaryCap - total,
    activeStandardContracts: activePlayers.length,
  };
}

export function getAvailableCapSpace(state: GameState, teamId: string): number {
  return getCapSheet(state, teamId).availableCapSpace;
}
