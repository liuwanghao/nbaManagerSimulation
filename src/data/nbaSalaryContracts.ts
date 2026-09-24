import rawContracts from "./nba-2026-27-contracts.json";

export type ContractOption = "NONE" | "TEAM_OPTION" | "PLAYER_OPTION";

export interface NbaSalaryContractSnapshot {
  canonicalPlayerId: string;
  nbaPlayerId: string;
  sourcePlayerId: string;
  sourcePlayerName: string;
  sourceTeamId: string;
  matchType: "auto" | "manual";
  salaryByYear: number[];
  guaranteedByYear: number[];
  optionByYear: ContractOption[];
  futureFreeAgencyStatus: "UFA" | "RFA" | null;
}

export interface NbaSalaryContractDataset {
  schemaVersion: 1;
  season: "2026-27";
  source: { provider: string; fileName: string; sheet: string; currency: "USD"; unit: "yuan" };
  contracts: NbaSalaryContractSnapshot[];
  unmatchedSourcePlayers: Array<{ sourcePlayerId: string; sourcePlayerName: string; sourceTeamId: string; sourceTeamName: string; reason: string }>;
}

const OPTIONS = new Set<ContractOption>(["NONE", "TEAM_OPTION", "PLAYER_OPTION"]);

export function validateNbaSalaryContractDataset(value: unknown): NbaSalaryContractDataset {
  if (!value || typeof value !== "object") throw new Error("NBA salary contract dataset must be an object");
  const dataset = value as NbaSalaryContractDataset;
  if (dataset.schemaVersion !== 1 || dataset.season !== "2026-27") throw new Error("NBA salary contract dataset schema is invalid");
  if (!dataset.source?.fileName || !Array.isArray(dataset.contracts) || !Array.isArray(dataset.unmatchedSourcePlayers)) {
    throw new Error("NBA salary contract dataset metadata is incomplete");
  }
  const playerIds = new Set<string>();
  for (const contract of dataset.contracts) {
    if (!contract.canonicalPlayerId || playerIds.has(contract.canonicalPlayerId)) throw new Error(`Duplicate salary contract for ${contract.canonicalPlayerId}`);
    playerIds.add(contract.canonicalPlayerId);
    if (!contract.nbaPlayerId || !contract.sourcePlayerId || !contract.sourcePlayerName) throw new Error(`Salary contract identity is incomplete for ${contract.canonicalPlayerId}`);
    if (!contract.salaryByYear.length || contract.salaryByYear.length !== contract.guaranteedByYear.length || contract.salaryByYear.length !== contract.optionByYear.length) {
      throw new Error(`Salary contract years are inconsistent for ${contract.canonicalPlayerId}`);
    }
    for (const salary of [...contract.salaryByYear, ...contract.guaranteedByYear]) {
      if (!Number.isInteger(salary) || salary < 0) throw new Error(`Invalid salary value for ${contract.canonicalPlayerId}`);
    }
    if (contract.salaryByYear.some((salary) => salary <= 0) || contract.optionByYear.some((option) => !OPTIONS.has(option))) {
      throw new Error(`Invalid contract terms for ${contract.canonicalPlayerId}`);
    }
  }
  return dataset;
}

export const NBA_2026_27_SALARY_CONTRACTS = validateNbaSalaryContractDataset(rawContracts);

const contractsByCanonicalPlayerId = new Map(
  NBA_2026_27_SALARY_CONTRACTS.contracts.map((contract) => [contract.canonicalPlayerId, contract] as const),
);

export function salaryContractFor(canonicalPlayerId: string): NbaSalaryContractSnapshot | undefined {
  return contractsByCanonicalPlayerId.get(canonicalPlayerId);
}
