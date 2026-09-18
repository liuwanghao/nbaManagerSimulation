import { TEAM_DEFINITIONS } from "./league";
import { createRng } from "../game/random/xoshiro";
import { stableHash } from "../game/random/hash";
import { createFictionalPlayerProfile } from "./playerProfiles";
import {
  emptyPlayerSeasonStats,
  type Player,
  type PlayerAttributes,
  type Position,
  type RotationRole,
  type Team,
  type TeamRole,
} from "../game/state/types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const ROTATION_ROLES: RotationRole[] = [
  "STARTER", "STARTER", "STARTER", "STARTER", "STARTER",
  "SIXTH_MAN", "ROTATION", "ROTATION", "ROTATION", "BENCH",
  "BENCH", "BENCH", "BENCH", "BENCH", "BENCH",
];

const TEAM_ROLES: TeamRole[] = [
  "FRANCHISE_CORE", "KEY_PLAYER", "KEY_PLAYER", "ROTATION", "ROTATION",
  "ROTATION", "ROTATION", "DEVELOPMENT", "DEVELOPMENT", "BENCH",
  "BENCH", "BENCH", "BENCH", "BENCH", "BENCH",
];

const clampRating = (value: number): number => Math.max(25, Math.min(99, Math.round(value)));

function attributesFor(seed: string, rosterIndex: number): PlayerAttributes {
  const rng = createRng(seed);
  const tier = rosterIndex < 2 ? 82 : rosterIndex < 5 ? 75 : rosterIndex < 10 ? 68 : 61;
  const rating = (offset = 0) => clampRating(tier + offset + rng.normalLike(5));
  return {
    shooting: rating(),
    finishing: rating(),
    playmaking: rating(),
    perimeterDefense: rating(),
    interiorDefense: rating(),
    rebounding: rating(),
    athleticism: rating(1),
    basketballIq: rating(2),
  };
}

export function createFixtureDataset(careerSeed: string): {
  teams: Record<string, Team>;
  players: Record<string, Player>;
} {
  const teams: Record<string, Team> = {};
  const players: Record<string, Player> = {};
  let playerOrdinal = 0;

  for (const definition of TEAM_DEFINITIONS) {
    const playerIds: string[] = [];
    for (let rosterIndex = 0; rosterIndex < 15; rosterIndex += 1) {
      const id = `${definition.id}-P${String(rosterIndex + 1).padStart(2, "0")}`;
      const seed = stableHash(careerSeed, "fixture_player", id);
      const rng = createRng(seed);
      const contractRng = createRng(stableHash(seed, "contract"));
      const salaryTier = rosterIndex < 2 ? 28_000_000 : rosterIndex < 5 ? 14_000_000 : rosterIndex < 10 ? 6_000_000 : 2_000_000;
      const salary = salaryTier + contractRng.int(0, Math.max(500_000, Math.floor(salaryTier * 0.35)));
      const yearsRemaining = 1 + contractRng.int(0, rosterIndex < 5 ? 3 : 2);
      const status = rosterIndex === 14 ? "UFA" : rosterIndex === 13 ? "RFA" : "STANDARD";
      const optionType = rosterIndex === 11 ? "TEAM" : rosterIndex === 12 ? "PLAYER" : "NONE";
      const age = 20 + rng.int(0, 13);
      const position = POSITIONS[rosterIndex % POSITIONS.length];
      const profile = createFictionalPlayerProfile(careerSeed, playerOrdinal, id, position, age);
      playerIds.push(id);
      players[id] = {
        id,
        teamId: definition.id,
        ...profile,
        age,
        position,
        attributes: attributesFor(seed, rosterIndex),
        threeRate: 0.27 + rng.nextFloat() * 0.23,
        usageTendency: 50 + rng.int(0, 45),
        health: 100,
        morale: 50,
        fatigue: 0,
        form: 0,
        rotationRole: ROTATION_ROLES[rosterIndex],
        teamRole: TEAM_ROLES[rosterIndex],
        available: true,
        serviceRosterDays: 0,
        birdTeamId: status === "STANDARD" ? definition.id : null,
        birdYears: status === "STANDARD" ? 1 : 0,
        contract: {
          salary,
          yearsRemaining: status === "STANDARD" ? yearsRemaining : 0,
          guaranteedAmount: status === "STANDARD" ? salary * yearsRemaining : 0,
          status,
          optionType,
          optionDecision: optionType === "NONE" ? "NOT_APPLICABLE" : "PENDING",
        },
        seasonStats: emptyPlayerSeasonStats(),
        postseasonStats: emptyPlayerSeasonStats(),
      };
      playerOrdinal += 1;
    }
    teams[definition.id] = { ...definition, playerIds };
  }

  return { teams, players };
}
