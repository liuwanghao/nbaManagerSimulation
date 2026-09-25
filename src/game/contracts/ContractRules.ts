import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import type { Player } from "../state/types";

export function getQualifyingOfferAmount(player: Player): number {
  return Math.max(
    Math.round(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.qualifyingOfferPreviousSalaryMultiplier),
    LEAGUE_FINANCE_CONFIG.minimumSalary,
  );
}

export function getRfaCapHoldAmount(player: Player): number {
  return Math.max(
    Math.round(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.rfaPreviousSalaryMultiplier),
    getQualifyingOfferAmount(player),
  );
}
