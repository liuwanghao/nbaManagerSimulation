import { stableHash } from "../game/random/hash";
import { createRng } from "../game/random/xoshiro";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";
import type { Player, PlayerPersonality, Position } from "../game/state/types";

const FIRST_NAMES = [
  "Adrian", "Andre", "Anton", "Blake", "Caleb", "Cameron", "Cedric", "Darius",
  "Devin", "Dominic", "Elias", "Elliot", "Emmett", "Felix", "Gavin", "Grant",
  "Isaiah", "Jalen", "Jamal", "Jonah", "Jordan", "Julian", "Kendrick", "Kieran",
  "Malcolm", "Marcus", "Micah", "Miles", "Nolan", "Owen", "Quentin", "Rafael",
  "Reece", "Roman", "Samson", "Silas", "Terrence", "Theo", "Tristan", "Tyrese",
  "Victor", "Wesley", "Xavier", "Zaire", "Avery", "Desmond", "Keon", "Landon",
] as const;

const LAST_NAMES = [
  "Aldridge", "Banks", "Barrett", "Bishop", "Boone", "Bowen", "Bradshaw", "Carver",
  "Clay", "Coleman", "Conley", "Dalton", "Dawson", "Ellison", "Everett", "Foster",
  "Gaines", "Garner", "Hale", "Hampton", "Harding", "Hayes", "Hollis", "Irving",
  "Jefferson", "Keaton", "Kendall", "Langston", "Lawson", "Mercer", "Merritt", "Monroe",
  "Nash", "Noble", "Palmer", "Prescott", "Ramsey", "Reeves", "Rowan", "Sampson",
  "Shepherd", "Sloan", "Sterling", "Sutton", "Vaughn", "Warren", "Whitaker", "Wilder",
] as const;

const PERSONALITIES: PlayerPersonality[] = [
  "COMPETITIVE", "MONEY_FOCUSED", "LOYAL", "ROLE_FOCUSED", "MARKET_FOCUSED", "BALANCED",
];

const BODY_RANGES: Record<Position, { height: [number, number]; weight: [number, number] }> = {
  PG: { height: [183, 193], weight: [78, 94] },
  SG: { height: [190, 200], weight: [84, 101] },
  SF: { height: [196, 205], weight: [91, 110] },
  PF: { height: [201, 211], weight: [100, 119] },
  C: { height: [206, 218], weight: [108, 132] },
};

const SECONDARY_POSITIONS: Record<Position, Position[]> = {
  PG: ["SG"],
  SG: ["PG", "SF"],
  SF: ["SG", "PF"],
  PF: ["SF", "C"],
  C: ["PF"],
};

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function nameStep(nameCount: number): number {
  let step = 97;
  while (greatestCommonDivisor(step, nameCount) !== 1) step += 2;
  return step;
}

export function fictionalNameAt(careerSeed: string, ordinal: number): string {
  const nameCount = FIRST_NAMES.length * LAST_NAMES.length;
  const offset = createRng(stableHash(careerSeed, "fictional_player_names")).int(0, nameCount - 1);
  const index = (offset + ordinal * nameStep(nameCount)) % nameCount;
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length)]}`;
}

export type FictionalPlayerProfile = Pick<Player,
  "name" | "heightCm" | "weightKg" | "secondaryPosition" | "birthDate" | "ageAtSnapshot"
  | "ageSource" | "serviceYears" | "serviceYearsSource" | "injuryRating" | "personality" | "marketPreference" | "profileSource"
>;

export function createFictionalPlayerProfile(
  careerSeed: string,
  ordinal: number,
  playerId: string,
  position: Position,
  age: number,
): FictionalPlayerProfile {
  const bodyRng = createRng(stableHash(careerSeed, playerId, "body"));
  const birthRng = createRng(stableHash(careerSeed, playerId, "birth"));
  const identityRng = createRng(stableHash(careerSeed, playerId, "identity"));
  const range = BODY_RANGES[position];
  const secondaryOptions = SECONDARY_POSITIONS[position];
  const month = birthRng.int(1, 6);
  const day = birthRng.int(1, 28);
  const secondaryPosition = secondaryOptions[identityRng.int(0, secondaryOptions.length - 1)];
  const serviceYears = identityRng.int(0, Math.max(0, Math.min(12, age - 19)));
  const injuryRating = identityRng.int(25, 99);
  const personality = PERSONALITIES[identityRng.int(0, PERSONALITIES.length - 1)];
  return {
    name: fictionalNameAt(careerSeed, ordinal),
    heightCm: bodyRng.int(range.height[0], range.height[1]),
    weightKg: bodyRng.int(range.weight[0], range.weight[1]),
    secondaryPosition,
    birthDate: `${2026 - age}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    ageAtSnapshot: age,
    ageSource: "GENERATED_BIRTH_DATE",
    serviceYears,
    serviceYearsSource: "GENERATED",
    injuryRating,
    personality,
    marketPreference: calculateMarketPreference(personality, age),
    profileSource: "FICTIONAL_FIXTURE",
  };
}
