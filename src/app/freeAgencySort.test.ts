import { describe, expect, it } from "vitest";
import { compareFreeAgentCandidates, type FreeAgentSortCandidate, type FreeAgentSortOption } from "./freeAgencySort";

const candidates: FreeAgentSortCandidate[] = [
  { id: "young", ability: 75, suggestedSalary: 8_000_000, age: 21 },
  { id: "star", ability: 85, suggestedSalary: 39_900_000, age: 22 },
  { id: "cheap", ability: 70, suggestedSalary: 2_000_000, age: 28 },
  { id: "older-tie", ability: 75, suggestedSalary: 8_000_000, age: 29 },
];

function ids(option: FreeAgentSortOption): string[] {
  return [...candidates].sort((left, right) => compareFreeAgentCandidates(left, right, option)).map((candidate) => candidate.id);
}

describe("compareFreeAgentCandidates", () => {
  it("defaults to highest OVR and breaks ties with younger age", () => {
    expect(ids("ABILITY_DESC")).toEqual(["star", "young", "older-tie", "cheap"]);
  });

  it("sorts by suggested first-year salary in either direction", () => {
    expect(ids("SALARY_DESC")).toEqual(["star", "young", "older-tie", "cheap"]);
    expect(ids("SALARY_ASC")).toEqual(["cheap", "young", "older-tie", "star"]);
  });

  it("sorts youngest players first and uses OVR as the first tie-breaker", () => {
    expect(ids("AGE_ASC")).toEqual(["young", "star", "cheap", "older-tie"]);
  });
});
