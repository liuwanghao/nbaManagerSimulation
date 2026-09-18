import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import type { GameState } from "../state/types";

export function validateSalaryMatch(state: GameState, teamId: string, outgoingPlayerIds: string[], incomingPlayerIds: string[]): void {
  const rules = LEAGUE_FINANCE_CONFIG.salaryMatching;
  const outgoing = outgoingPlayerIds.reduce((sum, id) => sum + state.players[id].contract.salary, 0);
  const incoming = incomingPlayerIds.reduce((sum, id) => sum + state.players[id].contract.salary, 0);
  const pre = getCapSheet(state, teamId).activeContractSalary;
  const projected = pre - outgoing + incoming;
  if (projected <= LEAGUE_FINANCE_CONFIG.salaryCap + rules.capSpaceBuffer) return;
  const tier = Math.max(pre, projected);
  if (tier >= LEAGUE_FINANCE_CONFIG.secondApron) {
    if (!rules.secondApronAllowsAggregation && outgoingPlayerIds.length > 1 || incoming > outgoing * rules.secondApronMultiplier) throw new Error("SECOND_APRON_SALARY_MATCH_FAILED");
  } else if (tier >= LEAGUE_FINANCE_CONFIG.firstApron) {
    if (incoming > outgoing * rules.firstApronMultiplier) throw new Error("FIRST_APRON_SALARY_MATCH_FAILED");
  } else if (incoming > outgoing * rules.belowFirstApronMultiplier + rules.belowFirstApronBuffer) throw new Error("SALARY_MATCH_FAILED");
}
