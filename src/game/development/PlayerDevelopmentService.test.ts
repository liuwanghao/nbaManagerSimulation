import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { playerOverall, processOffseasonPlayerLifecycle } from "./PlayerDevelopmentService";

function lifecycleState(seed = "player-lifecycle") {
  const state = createCareer(seed);
  state.league.seasonYear = 2027;
  state.league.seasonId = "2027-28";
  state.seeds.seasonSeed = stableHash(seed, "season", state.league.seasonId);
  return state;
}

describe("PlayerDevelopmentService", () => {
  it("derives age from birth date and applies development/regression per attribute", () => {
    const state = lifecycleState();
    const young = state.players[state.teams.SEA.playerIds[0]];
    young.birthDate = "2007-01-10";
    young.ageSource = "GENERATED_BIRTH_DATE";
    young.attributes = { shooting: 60, finishing: 60, playmaking: 60, perimeterDefense: 60, interiorDefense: 60, rebounding: 60, athleticism: 60, basketballIq: 80 };
    young.truePotential = 92;
    young.developmentRate = 1.2;
    young.developmentVolatility = 0;
    young.seasonStats.games = 82;
    young.seasonStats.seconds = 82 * 30 * 60;

    const veteran = state.players[state.teams.ATL.playerIds[0]];
    veteran.birthDate = "1989-01-10";
    veteran.ageSource = "GENERATED_BIRTH_DATE";
    veteran.attributes = { shooting: 82, finishing: 82, playmaking: 82, perimeterDefense: 82, interiorDefense: 82, rebounding: 82, athleticism: 82, basketballIq: 82 };
    veteran.truePotential = 82;
    veteran.developmentRate = 1;
    veteran.developmentVolatility = 0;
    veteran.injuryRating = 60;

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[young.id].age).toBe(20);
    expect(playerOverall(next.players[young.id])).toBeGreaterThan(playerOverall(young));
    expect(next.players[veteran.id].age).toBe(38);
    const athleticismLoss = veteran.attributes.athleticism - next.players[veteran.id].attributes.athleticism;
    const shootingLoss = veteran.attributes.shooting - next.players[veteran.id].attributes.shooting;
    expect(athleticismLoss).toBeGreaterThan(shootingLoss);
  });

  it("uses snapshot fallback age only at league-year rollover", () => {
    const state = lifecycleState("fallback-age");
    const player = state.players[state.teams.BOS.playerIds[0]];
    player.ageSource = "SNAPSHOT_FALLBACK";
    player.ageAtSnapshot = 24;
    player.age = 99;
    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].age).toBe(25);
  });

  it("uses training as a growth weight and consumes the plan at rollover", () => {
    const state = lifecycleState("training-weights");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.birthDate = "2005-01-10";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.attributes = { shooting: 60, finishing: 60, playmaking: 60, perimeterDefense: 60, interiorDefense: 60, rebounding: 60, athleticism: 60, basketballIq: 60 };
    player.truePotential = 84;
    player.developmentRate = 1;
    player.developmentVolatility = 0;
    player.seasonStats = { games: 0, seconds: 0, pts: 0, fgm: 0, fga: 0, threePm: 0, threePa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };

    const baseline = processOffseasonPlayerLifecycle(state);
    state.trainingPlan = { seasonId: "2026-27", assignments: { [player.id]: "SHOOTING" } };
    const focused = processOffseasonPlayerLifecycle(state);

    expect(focused.players[player.id].attributes.shooting).toBeGreaterThan(baseline.players[player.id].attributes.shooting);
    expect(focused.playerLifecycle?.trainedPlayerIds).toEqual([player.id]);
    expect(focused.trainingPlan).toEqual({ seasonId: state.league.seasonId, assignments: {} });
  });

  it("allows an elite young prospect to reach the 90+ tail without exceeding annual caps", () => {
    let state = lifecycleState("elite-development-tail");
    const playerId = state.teams.SEA.playerIds[0];
    const prospect = state.players[playerId];
    prospect.birthDate = "2008-01-10";
    prospect.ageSource = "GENERATED_BIRTH_DATE";
    prospect.attributes = { shooting: 78, finishing: 78, playmaking: 78, perimeterDefense: 78, interiorDefense: 78, rebounding: 78, athleticism: 78, basketballIq: 78 };
    prospect.truePotential = 96;
    prospect.developmentRate = 1.2;
    prospect.developmentVolatility = 0;
    prospect.rotationRole = "STARTER";
    prospect.teamRole = "FRANCHISE_CORE";
    prospect.seasonStats.games = 82;
    prospect.seasonStats.seconds = 82 * 32 * 60;

    for (let year = 0; year < 7; year += 1) {
      state.league.seasonYear = 2027 + year;
      state.league.seasonId = `${2027 + year}-${String(28 + year).padStart(2, "0")}`;
      state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
      const before = structuredClone(state.players[playerId].attributes);
      state = processOffseasonPlayerLifecycle(state);
      const after = state.players[playerId].attributes;
      for (const key of Object.keys(after) as Array<keyof typeof after>) {
        expect(after[key] - before[key]).toBeLessThanOrEqual(4);
      }
    }

    expect(playerOverall(state.players[playerId])).toBeGreaterThanOrEqual(90);
    expect(playerOverall(state.players[playerId])).toBeLessThanOrEqual(99);
  });

  it("retires deterministic elderly free agents and removes every ownership/cap reference", () => {
    const state = lifecycleState("retirement-commit");
    const candidates = Object.values(state.players).slice(0, 24);
    for (const player of candidates) {
      state.teams[player.teamId].playerIds = state.teams[player.teamId].playerIds.filter((id) => id !== player.id);
      player.teamId = "FREE_AGENT";
      player.birthDate = "1977-01-01";
      player.ageSource = "GENERATED_BIRTH_DATE";
      player.contract.status = "UFA";
      player.attributes = { shooting: 50, finishing: 45, playmaking: 48, perimeterDefense: 44, interiorDefense: 45, rebounding: 48, athleticism: 40, basketballIq: 58 };
      player.career = {
        seasonsPlayed: 12, totals: structuredClone(player.seasonStats), peakOverall: 76, peakImpact: 78,
        unemployedGameDays: 360, unemployedLeagueYears: 2, careerInjuryGamesMissed: 90,
        honors: { allStar: 6, mvp: 2, dpoy: 0, roy: 0, mip: 0, sixthMan: 0, championships: 1, finalsMvp: 1 },
        hallOfFameEligibleData: true,
      };
      state.capState.capHolds.push({ playerId: player.id, teamId: "ATL", amount: 2_000_000, type: "BIRD_UFA" });
    }
    const next = processOffseasonPlayerLifecycle(state);
    expect(next.playerLifecycle?.retirementOutflow).toBeGreaterThan(0);
    expect(next.playerLifecycle?.hallOfFameInducteeIds.length).toBeGreaterThan(0);
    for (const playerId of next.playerLifecycle?.retiredPlayerIds ?? []) {
      expect(next.players[playerId].teamId).toBe("RETIRED");
      expect(next.players[playerId].contract.status).toBe("RETIRED");
      expect(Object.values(next.teams).some((team) => team.playerIds.includes(playerId))).toBe(false);
      expect(next.capState.capHolds.some((hold) => hold.playerId === playerId)).toBe(false);
      expect(next.players[playerId].career?.retirementSeason).toBe("2027-28");
      if (next.playerLifecycle?.hallOfFameInducteeIds.includes(playerId)) {
        expect(next.players[playerId].career?.hallOfFame).toBe(true);
        expect(next.players[playerId].career?.hallOfFameScore).toBeGreaterThanOrEqual(75);
      }
    }
  });

  it("replays the complete all-league lifecycle from the same seed", () => {
    const state = lifecycleState("lifecycle-replay");
    const first = processOffseasonPlayerLifecycle(state);
    const second = processOffseasonPlayerLifecycle(state);
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
    expect(first.playerLifecycle?.activePlayerCount).toBeGreaterThan(400);
    expect(first.playerLifecycle?.developedPlayerIds.length).toBeGreaterThan(0);
    expect(first.playerLifecycle?.regressedPlayerIds.length).toBeGreaterThan(0);
  });
});
