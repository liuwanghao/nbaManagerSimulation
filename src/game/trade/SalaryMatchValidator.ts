import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import type { GameState, Player } from "../state/types";

// NBA/NBPA CBA 101, Exhibit C (2024-25). The salary scale rises with the cap.
const NBA_MINIMUM_2024 = [
  1_157_153, 1_862_265, 2_087_519, 2_162_606, 2_237_691, 2_425_403,
  2_613_120, 2_800_834, 2_988_550, 3_003_427, 3_303_771,
];

function isMinimumExceptionContract(state: GameState, player: Player): boolean {
  const contract = player.contract;
  const salaries = contract.salaryByYear;
  if (contract.status !== "STANDARD" || contract.contractType === "ROOKIE_FIRST"
    || contract.contractType === "ROOKIE_SECOND" || contract.contractType === "EMERGENCY"
    || !salaries || salaries.length < 1 || salaries.length > 2) return false;
  const elapsed = contract.currentYearIndex ?? 0;
  if (elapsed < 0 || elapsed >= salaries.length || contract.yearsRemaining !== salaries.length - elapsed
    || salaries[elapsed] !== contract.salary) return false;
  if (contract.startSeason !== undefined && contract.endSeason !== undefined
    && contract.endSeason - contract.startSeason + 1 !== salaries.length) return false;
  const startSeason = contract.startSeason ?? state.league.seasonYear - elapsed;
  if (startSeason < 2026) return false;
  const signingServiceYears = Math.max(0, player.serviceYears - elapsed);
  return salaries.every((salary, index) => {
    const finance = getSeasonFinanceConfig(startSeason + index);
    const nbaMinimum = Math.round(
      NBA_MINIMUM_2024[Math.min(10, signingServiceYears + index)]
      * (1.05 ** index) * finance.minimumSalary / NBA_MINIMUM_2024[0],
    );
    // Existing game saves use a single rookie-scale minimum for every service year.
    return Math.abs(salary - nbaMinimum) <= 2 || Math.abs(salary - finance.minimumSalary) <= 2;
  });
}

function fitsSeparateStandardExceptions(outgoing: number[], incoming: number[]): boolean {
  const salaries = [...incoming].sort((a, b) => b - a);
  const available = outgoing.filter((salary) => salary > 0).sort((a, b) => b - a);
  if (salaries.reduce((sum, salary) => sum + salary, 0) > available.reduce((sum, salary) => sum + salary, 0)) return false;
  const seen = new Set<string>();
  function assign(index: number): boolean {
    if (index === salaries.length) return true;
    const key = `${index}:${[...available].sort((a, b) => b - a).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const tried = new Set<number>();
    for (let i = 0; i < available.length; i += 1) {
      const room = available[i];
      if (room < salaries[index] || tried.has(room)) continue;
      tried.add(room);
      available[i] -= salaries[index];
      if (assign(index + 1)) return true;
      available[i] = room;
    }
    return false;
  }
  return assign(0);
}

export function validateSalaryMatch(state: GameState, teamId: string, outgoingPlayerIds: string[], incomingPlayerIds: string[]): void {
  const finance = getSeasonFinanceConfig(state.league.seasonYear);
  const rules = finance.salaryMatching;
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
  const projectedIncomplete = Math.max(0, finance.incompleteRosterMinimumSlots - projectedSlots)
    * finance.rookieMinimumSalary;
  const projectedCapTotal = capSheet.total - outgoingSalary + incoming - capSheet.incompleteRosterCharges + projectedIncomplete;
  if (projectedCapTotal <= finance.salaryCap + rules.capSpaceBuffer) return;
  // The NBA apron restrictions apply to the team's salary immediately after the trade.
  // This intentionally differs from the frozen V1.5 product rule, which uses max(pre, post).
  const post = pre - outgoingSalary + incoming;
  const matchedIncomingSalaries = incomingPlayerIds
    .filter((id) => !isMinimumExceptionContract(state, state.players[id]))
    .map((id) => state.players[id].contract.salary);
  const matchedIncoming = matchedIncomingSalaries.reduce((sum, salary) => sum + salary, 0);
  if (post > finance.secondApron) {
    if (matchedIncoming > outgoing * rules.secondApronMultiplier
      || (!rules.secondApronAllowsAggregation
        && !fitsSeparateStandardExceptions(outgoingPlayerIds.map(matchingSalary), matchedIncomingSalaries))) {
      throw new Error("SECOND_APRON_SALARY_MATCH_FAILED");
    }
  } else if (post > finance.firstApron) {
    if (matchedIncoming > outgoing * rules.firstApronMultiplier) throw new Error("FIRST_APRON_SALARY_MATCH_FAILED");
  } else {
    // The expanded simultaneous traded-player exception uses a season-adjusted fixed addend.
    const expandedAddend = Math.round(7_752_000 * finance.salaryCap / 140_588_000);
    const expanded = Math.max(
      Math.min(2 * outgoing + rules.belowFirstApronBuffer, outgoing + expandedAddend),
      outgoing * rules.belowFirstApronMultiplier + rules.belowFirstApronBuffer,
    );
    if (matchedIncoming > expanded) throw new Error("SALARY_MATCH_FAILED");
  }
}
