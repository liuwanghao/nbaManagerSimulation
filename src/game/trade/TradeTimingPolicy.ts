import type { GameState, Player } from "../state/types";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

/** Maps the game's phase clock to a stable NBA calendar date for trade eligibility. */
export function tradeCalendarDate(state: GameState): string {
  const year = state.league.seasonYear;
  const phase = state.league.currentPhase;
  if (phase === "OFFSEASON_PRE_DRAFT") return `${year}-06-20`;
  if (phase === "DRAFT") return `${year}-06-27`;
  // The game has 120 free-agency turns but fewer real days before opening night.
  if (phase === "OFFSEASON_POST_DRAFT") return addDays(`${year}-07-01`, Math.min(91, Math.max(0, (state.freeAgency?.currentDay ?? 1) - 1)));
  if (phase === "PRESEASON") return addDays(`${year}-10-01`, Math.min(18, Math.max(0, (state.freeAgency?.currentDay ?? 121) - 121)));
  return addDays(state.calendar.openingDate, state.calendar.currentDateIndex);
}

function inferredSigningDate(player: Player): string | undefined {
  const contract = player.contract;
  if (contract.signedOn) return contract.signedOn;
  if (!contract.startSeason) return undefined;
  if (contract.signedPhase === "DRAFT") return `${contract.startSeason}-06-27`;
  if (contract.signedPhase === "OFFSEASON_POST_DRAFT") return `${contract.startSeason}-07-01`;
  if (contract.signedPhase === "PRESEASON") return `${contract.startSeason}-10-01`;
  return undefined;
}

export function playerTradeWaitingReason(state: GameState, player: Player): string | undefined {
  const signedOn = inferredSigningDate(player);
  if (!signedOn || player.contract.status !== "STANDARD") return undefined;
  const today = tradeCalendarDate(state);
  if (player.contract.signedPhase === "DRAFT" || player.contract.contractType === "ROOKIE_FIRST" || player.contract.contractType === "ROOKIE_SECOND") {
    return today < addDays(signedOn, 30) ? "ROOKIE_TRADE_WAITING_PERIOD" : undefined;
  }
  if (player.contract.signedPhase === "DATASET") return undefined;
  const December15 = `${player.contract.startSeason ?? Number(signedOn.slice(0, 4))}-12-15`;
  const eligibleOn = addMonths(signedOn, 3) > December15 ? addMonths(signedOn, 3) : December15;
  return today < eligibleOn ? "FREE_AGENT_TRADE_WAITING_PERIOD" : undefined;
}
