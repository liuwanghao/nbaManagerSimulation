export type FreeAgentSortOption = "ABILITY_DESC" | "SALARY_DESC" | "SALARY_ASC" | "AGE_ASC";

export interface FreeAgentSortCandidate {
  id: string;
  ability: number;
  suggestedSalary: number;
  age: number;
}

export function compareFreeAgentCandidates(
  left: FreeAgentSortCandidate,
  right: FreeAgentSortCandidate,
  option: FreeAgentSortOption,
): number {
  const abilityDescending = right.ability - left.ability;
  const salaryDescending = right.suggestedSalary - left.suggestedSalary;
  const stableFallback = abilityDescending || left.age - right.age || left.id.localeCompare(right.id);

  if (option === "SALARY_DESC") return salaryDescending || stableFallback;
  if (option === "SALARY_ASC") return left.suggestedSalary - right.suggestedSalary || stableFallback;
  if (option === "AGE_ASC") return left.age - right.age || abilityDescending || salaryDescending || left.id.localeCompare(right.id);
  return abilityDescending || salaryDescending || left.age - right.age || left.id.localeCompare(right.id);
}
