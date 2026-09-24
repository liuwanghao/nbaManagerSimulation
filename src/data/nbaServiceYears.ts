// Numeric-only extracts of nba-official-player-profiles.json for the offline H5 bundle.
import officialServiceYears from "./nba-official-service-experience-2026.json";
import publishedExperience from "./nba-official-published-experience-2026.json";

export type NbaServiceYearsSource = "NBA_OFFICIAL_PROFILE" | "DOCUMENTED_DEBUT" | "AGE_ESTIMATE";

export interface OpeningNbaServiceYears {
  years: number;
  source: NbaServiceYearsSource;
}

// The career opens before 2026-27. These are completed seasons through 2025-26.
const DOCUMENTED_COMPLETED_SEASONS: Record<string, number> = {
  "201959": 17, // Taj Gibson debuted in 2009-10; NBA player 201959.
  "2544": 23, // LeBron James debuted in 2003-04; NBA player 2544.
};

export function openingNbaServiceYears(playerId: string, age: number): OpeningNbaServiceYears {
  const nbaId = playerId.replace(/^nba:/u, "");
  const documented = DOCUMENTED_COMPLETED_SEASONS[nbaId];
  if (documented !== undefined) return { years: documented, source: "DOCUMENTED_DEBUT" };

  const official = (officialServiceYears as Record<string, number>)[nbaId];
  if (Number.isInteger(official) && official !== undefined && official >= 0) {
    // NBA experience, capped at seasons possible from NBA debut through 2025-26.
    // Missed seasons can still count toward service years.
    return { years: official, source: "NBA_OFFICIAL_PROFILE" };
  }

  // Unknown debut dates are estimates, never seeded random numbers presented as facts.
  return { years: Math.max(0, age - 20), source: "AGE_ESTIMATE" };
}

export function firstPassOpeningNbaServiceYears(playerId: string, age: number, source?: NbaServiceYearsSource | "GENERATED"): number {
  if (source === "NBA_OFFICIAL_PROFILE") {
    const nbaId = playerId.replace(/^nba:/u, "");
    const published = (publishedExperience as Record<string, number>)[nbaId];
    if (Number.isInteger(published) && published !== undefined) return Math.max(0, published - 1);
  }
  if (source === "AGE_ESTIMATE") return Math.max(0, age - 20);
  return openingNbaServiceYears(playerId, age).years;
}
