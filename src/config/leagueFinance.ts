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
  version: "finance.v5",
  salaryCap: 164_961_000,
  minimumTeamSalary: 148_464_900,
  luxuryTaxLine: 200_428_000,
  firstApron: 209_015_000,
  secondApron: 221_686_000,
  minimumSalary: 1_272_870,
  rookieMinimumSalary: 1_272_870,
  rookieScale,
  maximumSalaryPercentages: { zeroToSixYears: 0.25, sevenToNineYears: 0.3, tenPlusYears: 0.35 },
  contractYears: { minimum: 1, otherTeamMaximum: 4, ownTeamMaximum: 5 },
  annualRaisePercentages: { otherTeam: 0.05, ownTeam: 0.08 },
  incompleteRosterMinimumSlots: 12,
  expansionDraftSalaryLimit: 164_961_000,
  rosterLimits: { offseasonMaximum: 21, regularSeasonMinimum: 14, regularSeasonMaximum: 15, emergencyTarget: 8, hardPlayableMinimum: 5, franchiseCoreMaximum: 3 },
  salaryMatching: { capSpaceBuffer: 250_000, belowFirstApronMultiplier: 1.25, belowFirstApronBuffer: 250_000, firstApronMultiplier: 1, secondApronMultiplier: 1, secondApronAllowsAggregation: false },
  capHolds: { birdUfaPreviousSalaryMultiplier: 1.5, rfaPreviousSalaryMultiplier: 1.5, qualifyingOfferPreviousSalaryMultiplier: 1.25, birdEligibilityYears: 3 },
  rookieContracts: { firstRoundScaleMultiplier: 1.2, firstRoundSalaryGrowth: [1, 1.05, 1.1, 1.16], secondRoundSalaryGrowth: [1, 1.05], firstRoundGuaranteedYears: 2, secondRoundGuaranteedYears: 1 },
  emergencyContract: { fullSeasonDays: 174 },
  serviceYearMinimumRosterDays: 41,
};

const BASE_SEASON_YEAR = 2026;
const ANNUAL_CAP_GROWTH = 1.07;
const seasonFinanceCache = new Map<number, LeagueFinanceConfig>();

/** Monetary amounts are rounded to the nearest dollar at each season's published scale. */
export function getSeasonFinanceConfig(seasonYear: number): LeagueFinanceConfig {
  if (!Number.isInteger(seasonYear) || seasonYear < BASE_SEASON_YEAR) throw new Error(`Invalid finance season: ${seasonYear}`);
  if (seasonYear === BASE_SEASON_YEAR) return LEAGUE_FINANCE_CONFIG;
  const cached = seasonFinanceCache.get(seasonYear);
  if (cached) return cached;
  const factor = ANNUAL_CAP_GROWTH ** (seasonYear - BASE_SEASON_YEAR);
  const scale = (amount: number): number => Math.round(amount * factor);
  const salaryCap = scale(LEAGUE_FINANCE_CONFIG.salaryCap);
  const finance: LeagueFinanceConfig = {
    ...LEAGUE_FINANCE_CONFIG,
    salaryCap,
    minimumTeamSalary: Math.round(salaryCap * 0.9),
    luxuryTaxLine: scale(LEAGUE_FINANCE_CONFIG.luxuryTaxLine),
    firstApron: scale(LEAGUE_FINANCE_CONFIG.firstApron),
    secondApron: scale(LEAGUE_FINANCE_CONFIG.secondApron),
    minimumSalary: scale(LEAGUE_FINANCE_CONFIG.minimumSalary),
    rookieMinimumSalary: scale(LEAGUE_FINANCE_CONFIG.rookieMinimumSalary),
    rookieScale: Object.fromEntries(Object.entries(LEAGUE_FINANCE_CONFIG.rookieScale).map(([pick, salary]) => [pick, scale(salary)])),
    expansionDraftSalaryLimit: scale(LEAGUE_FINANCE_CONFIG.expansionDraftSalaryLimit),
    salaryMatching: {
      ...LEAGUE_FINANCE_CONFIG.salaryMatching,
      capSpaceBuffer: scale(LEAGUE_FINANCE_CONFIG.salaryMatching.capSpaceBuffer),
      belowFirstApronBuffer: scale(LEAGUE_FINANCE_CONFIG.salaryMatching.belowFirstApronBuffer),
    },
  };
  seasonFinanceCache.set(seasonYear, finance);
  return finance;
}
