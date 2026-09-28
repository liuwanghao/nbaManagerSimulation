import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import type { GameState } from "../state/types";

export function validateSalaryMatch(state: GameState, teamId: string, outgoingPlayerIds: string[], incomingPlayerIds: string[]): void {
  const rules = LEAGUE_FINANCE_CONFIG.salaryMatching;
  const outgoingSalary = outgoingPlayerIds.reduce((sum, id) => sum + state.players[id].contract.salary, 0);
  const matchingSalary = (id: string): number => {
    const contract = state.players[id].contract;
    const guaranteed = contract.guaranteedByYear?.[contract.currentYearIndex ?? 0] ?? contract.guaranteedAmount;
    return Math.min(contract.salary, Math.max(0, guaranteed));
  };
  const outgoing = outgoingPlayerIds.reduce((sum, id) => sum + matchingSalary(id), 0);
  const incoming = incomingPlayerIds.reduce((sum, id) => sum + state.players[id].contract.salary, 0);
  const capSheet = getCapSheet(state, teamId);
  const pre = capSheet.activeContractSalary + capSheet.deadMoney;
  const projectedSlots = capSheet.activeStandardContracts - outgoingPlayerIds.length + incomingPlayerIds.length;
  const projectedIncomplete = Math.max(0, LEAGUE_FINANCE_CONFIG.incompleteRosterMinimumSlots - projectedSlots)
    * LEAGUE_FINANCE_CONFIG.rookieMinimumSalary;
  const projectedCapTotal = capSheet.total - outgoingSalary + incoming - capSheet.incompleteRosterCharges + projectedIncomplete;
  if (projectedCapTotal <= LEAGUE_FINANCE_CONFIG.salaryCap + rules.capSpaceBuffer) return;
  const apronTier = Math.max(pre, pre - outgoingSalary + incoming);
  if (apronTier >= LEAGUE_FINANCE_CONFIG.secondApron) {
    const largestOutgoing = Math.max(0, ...outgoingPlayerIds.map(matchingSalary));
    if ((!rules.secondApronAllowsAggregation && outgoingPlayerIds.length > 1 && incoming > largestOutgoing)
      || incoming > outgoing * rules.secondApronMultiplier) throw new Error("SECOND_APRON_SALARY_MATCH_FAILED");
  } else if (apronTier >= LEAGUE_FINANCE_CONFIG.firstApron) {
    if (incoming > outgoing * rules.firstApronMultiplier) throw new Error("FIRST_APRON_SALARY_MATCH_FAILED");
  } else {
    // The expanded simultaneous traded-player exception uses a season-adjusted fixed addend.
    const expandedAddend = Math.round(7_752_000 * LEAGUE_FINANCE_CONFIG.salaryCap / 140_588_000);
    const expanded = Math.max(
      Math.min(2 * outgoing + rules.belowFirstApronBuffer, outgoing + expandedAddend),
      outgoing * rules.belowFirstApronMultiplier + rules.belowFirstApronBuffer,
    );
    if (incoming > expanded) throw new Error("SALARY_MATCH_FAILED");
  }
}
