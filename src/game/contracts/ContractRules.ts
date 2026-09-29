import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import type { Player } from "../state/types";

export function getQualifyingOfferAmount(player: Player, seasonYear = 2026): number {
  const finance = getSeasonFinanceConfig(seasonYear);
  return Math.max(
    Math.round(player.contract.salary * finance.capHolds.qualifyingOfferPreviousSalaryMultiplier),
    finance.minimumSalary,
  );
}

export function getRfaCapHoldAmount(player: Player, seasonYear = 2026): number {
  const finance = getSeasonFinanceConfig(seasonYear);
  return Math.max(
    Math.round(player.contract.salary * finance.capHolds.rfaPreviousSalaryMultiplier),
    getQualifyingOfferAmount(player, seasonYear),
  );
}
