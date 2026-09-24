export interface LeagueFinanceConfig {
  version: string;
  salaryCap: number;
  minimumTeamSalary: number;
  luxuryTaxLine: number;
  firstApron: number;
  secondApron: number;
  minimumSalary: number;
  rookieMinimumSalary: number;
  rookieScale: Record<number, number>;
  maximumSalaryPercentages: { zeroToSixYears: number; sevenToNineYears: number; tenPlusYears: number };
  contractYears: { minimum: number; otherTeamMaximum: number; ownTeamMaximum: number };
  annualRaisePercentages: { otherTeam: number; ownTeam: number };
  incompleteRosterMinimumSlots: number;
  expansionDraftSalaryLimit: number;
  rosterLimits: { offseasonMaximum: number; regularSeasonMinimum: number; regularSeasonMaximum: number; emergencyTarget: number; hardPlayableMinimum: number; franchiseCoreMaximum: number };
  salaryMatching: { capSpaceBuffer: number; belowFirstApronMultiplier: number; belowFirstApronBuffer: number; firstApronMultiplier: number; secondApronMultiplier: number; secondApronAllowsAggregation: boolean };
  capHolds: { birdUfaPreviousSalaryMultiplier: number; rfaPreviousSalaryMultiplier: number; qualifyingOfferPreviousSalaryMultiplier: number; birdEligibilityYears: number };
  rookieContracts: { firstRoundScaleMultiplier: number; firstRoundSalaryGrowth: number[]; secondRoundSalaryGrowth: number[]; firstRoundGuaranteedYears: number; secondRoundGuaranteedYears: number };
  emergencyContract: { fullSeasonDays: number };
  serviceYearMinimumRosterDays: number;
}

const rookieScale = Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
  const pick = index + 1;
  const base = Math.round((13_800_000 * Math.pow(0.925, index)) / 10_000) * 10_000;
  return [pick, Math.max(1_250_000, base)];
}));

export const LEAGUE_FINANCE_CONFIG: LeagueFinanceConfig = {
  version: "finance.v3",
  salaryCap: 165_000_000,
  minimumTeamSalary: 139_182_000,
  luxuryTaxLine: 200_400_000,
  firstApron: 209_000_000,
  secondApron: 221_700_000,
  minimumSalary: 1_272_870,
  rookieMinimumSalary: 1_272_870,
  rookieScale,
  maximumSalaryPercentages: { zeroToSixYears: 0.25, sevenToNineYears: 0.3, tenPlusYears: 0.35 },
  contractYears: { minimum: 1, otherTeamMaximum: 4, ownTeamMaximum: 5 },
  annualRaisePercentages: { otherTeam: 0.05, ownTeam: 0.08 },
  incompleteRosterMinimumSlots: 12,
  expansionDraftSalaryLimit: 165_000_000,
  rosterLimits: { offseasonMaximum: 21, regularSeasonMinimum: 14, regularSeasonMaximum: 15, emergencyTarget: 8, hardPlayableMinimum: 5, franchiseCoreMaximum: 3 },
  salaryMatching: { capSpaceBuffer: 250_000, belowFirstApronMultiplier: 1.25, belowFirstApronBuffer: 250_000, firstApronMultiplier: 1, secondApronMultiplier: 1, secondApronAllowsAggregation: false },
  capHolds: { birdUfaPreviousSalaryMultiplier: 1.5, rfaPreviousSalaryMultiplier: 1.5, qualifyingOfferPreviousSalaryMultiplier: 1.25, birdEligibilityYears: 3 },
  rookieContracts: { firstRoundScaleMultiplier: 1.2, firstRoundSalaryGrowth: [1, 1.05, 1.1, 1.16], secondRoundSalaryGrowth: [1, 1.05], firstRoundGuaranteedYears: 2, secondRoundGuaranteedYears: 1 },
  emergencyContract: { fullSeasonDays: 174 },
  serviceYearMinimumRosterDays: 41,
};
