import { describe, expect, it } from "vitest";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { RETIRED_LEGEND_TEMPLATES } from "../../data/retiredLegendTemplates";
import { stableHash, stableSerialize } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { createCareer } from "../season/career";
import { playerOverall, processOffseasonPlayerLifecycle } from "./PlayerDevelopmentService";

function lifecycleState(seed = "player-lifecycle") {
  const state = createCareer(seed);
  state.league.seasonYear = 2027;
  state.league.seasonId = "2027-28";
  state.seeds.seasonSeed = stableHash(seed, "season", state.league.seasonId);
  return state;
}

function bundledLifecycleState(seed: string) {
  const state = createExpansionCareerFromBundledDataset(seed);
  state.league.seasonYear = 2027;
  state.league.seasonId = "2027-28";
  state.seeds.seasonSeed = stableHash(seed, "season", state.league.seasonId);
  return state;
}

function seasonSeedWithRetirementRoll(playerId: string, minimum: number, maximum: number): string {
  for (let index = 0; index < 20_000; index += 1) {
    const seasonSeed = stableHash("retirement-boundary", playerId, index);
    const roll = createRng(stableHash(seasonSeed, "retirement", playerId)).nextFloat();
    if (roll >= minimum && roll < maximum) return seasonSeed;
  }
  throw new Error(`No retirement roll found in [${minimum}, ${maximum})`);
}

describe("PlayerDevelopmentService", () => {
  it("takes every retired legend template to superstar OVR by age 27", () => {
    let state = lifecycleState("all-retired-legends-grow");
    const prototype = state.players[state.teams[state.userTeamId].playerIds[0]];
    const legends = RETIRED_LEGEND_TEMPLATES.map((template, index) => {
      const player = structuredClone(prototype);
      player.id = `DRAFT-2027-${String(index + 1).padStart(3, "0")}`;
      player.name = template.sourceName;
      player.profileSource = "HISTORICAL_ARCHETYPE";
      player.historicalSourcePlayerId = template.sourcePlayerId;
      player.position = template.position;
      player.attributes = Object.fromEntries(Object.entries(template.rookieAttributes).map(([key, value]) => [key, value - 3])) as unknown as typeof player.attributes;
      player.birthDate = "2007-01-01";
      player.ageSource = "GENERATED_BIRTH_DATE";
      player.age = 20;
      player.truePotential = Math.max(90, template.peakOverall);
      player.seasonStats.games = 0;
      player.seasonStats.seconds = 0;
      return player;
    });
    state.players = Object.fromEntries(legends.map((player) => [player.id, player]));
    state.teams[state.userTeamId].playerIds = legends.map((player) => player.id);

    for (let year = 2027; year <= 2034; year += 1) {
      state.league.seasonYear = year;
      state.league.seasonId = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
      state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
      state = processOffseasonPlayerLifecycle(state);
    }
    for (const template of RETIRED_LEGEND_TEMPLATES) {
      const player = Object.values(state.players).find((candidate) => candidate.historicalSourcePlayerId === template.sourcePlayerId);
      expect(player, template.sourceName).toBeDefined();
      expect(playerOverall(player!)).toBeGreaterThanOrEqual(Math.max(90, template.peakOverall));
      expect(player?.contract.status).not.toBe("RETIRED");
    }
    const veteran = state.players[legends[0].id];
    veteran.birthDate = "1989-01-01";
    veteran.attributes = Object.fromEntries(Object.keys(veteran.attributes).map((key) => [key, 90])) as unknown as typeof veteran.attributes;
    veteran.career!.peakOverall = Math.max(90, RETIRED_LEGEND_TEMPLATES[0].peakOverall);
    state.league.seasonYear = 2027;
    const afterPrime = processOffseasonPlayerLifecycle(state).players[veteran.id];
    expect(playerOverall(afterPrime)).toBeLessThan(90);
  });

  it("grows a retired-star rookie into a 90+ player by prime age even with limited minutes", () => {
    let state = lifecycleState("historical-superstar-growth");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.id = "DRAFT-2027-001";
    player.profileSource = "HISTORICAL_ARCHETYPE";
    player.historicalSourcePlayerId = "nba:893";
    player.birthDate = "2007-01-01";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.age = 20;
    player.attributes = Object.fromEntries(Object.keys(player.attributes).map((key) => [key, 72])) as unknown as typeof player.attributes;
    player.truePotential = 90;
    player.developmentRate = 0.75;
    player.developmentVolatility = 0.5;
    player.rotationRole = "OUT";
    player.teamRole = "DEVELOPMENT";
    state.players = { [player.id]: player };
    state.teams[state.userTeamId].playerIds = [player.id];

    for (let year = 2027; year <= 2034; year += 1) {
      state.league.seasonYear = year;
      state.league.seasonId = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
      state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
      const previous = { ...state.players[player.id].attributes };
      state = processOffseasonPlayerLifecycle(state);
      const developed = state.players[player.id];
      expect(developed.contract.status).not.toBe("RETIRED");
      for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
        expect(developed.attributes[key] - previous[key]).toBeLessThanOrEqual(4);
      }
    }
    expect(state.players[player.id].age).toBe(27);
    expect(playerOverall(state.players[player.id])).toBeGreaterThanOrEqual(90);
  });

  it("records the before and after OVR for every player on the user's rollover roster", () => {
    const state = lifecycleState("user-overall-changes");
    const startingRoster = [...state.teams[state.userTeamId].playerIds];
    const before = Object.fromEntries(startingRoster.map((id) => [id, Math.round(playerOverall(state.players[id]))]));
    const next = processOffseasonPlayerLifecycle(state);
    const changes = next.playerLifecycle?.userTeamOverallChanges ?? [];

    expect(new Set(changes.map((entry) => entry.playerId))).toEqual(new Set(startingRoster));
    for (const change of changes) {
      expect(change.before).toBe(before[change.playerId]);
      expect(change.after).toBe(Math.round(playerOverall(next.players[change.playerId])));
    }
  });

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

  it("lets real prior-season production modestly influence young-player growth", () => {
    const state = lifecycleState("growth-season-performance");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.birthDate = "2007-01-10";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.attributes = { shooting: 65, finishing: 65, playmaking: 65, perimeterDefense: 65, interiorDefense: 65, rebounding: 65, athleticism: 65, basketballIq: 65 };
    player.truePotential = 84;
    player.developmentRate = 1.15;
    player.developmentVolatility = 0;
    player.rotationRole = "BENCH";
    player.teamRole = "ROTATION";
    player.seasonStats.games = 70;
    player.seasonStats.seconds = 70 * 24 * 60;

    const low = structuredClone(state);
    const lowStats = low.players[player.id].seasonStats;
    lowStats.pts = 5 * 70;
    lowStats.reb = 1 * 70;
    lowStats.ast = 1 * 70;
    lowStats.tov = 3 * 70;

    const high = structuredClone(state);
    const highStats = high.players[player.id].seasonStats;
    highStats.pts = 32 * 70;
    highStats.reb = 8 * 70;
    highStats.ast = 6 * 70;
    highStats.stl = 1 * 70;
    highStats.blk = 1 * 70;
    highStats.tov = 2 * 70;

    const lowAfter = processOffseasonPlayerLifecycle(low).players[player.id];
    const highAfter = processOffseasonPlayerLifecycle(high).players[player.id];
    expect(playerOverall(highAfter)).toBeGreaterThan(playerOverall(lowAfter));
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) {
      expect(highAfter.attributes[key] - lowAfter.attributes[key]).toBeLessThanOrEqual(1);
    }
  });

  it("ignores a synthetic opening baseline when there are no real games", () => {
    const state = lifecycleState("ignore-synthetic-growth");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.seasonStats.games = 0;
    player.seasonStats.seconds = 0;
    const synthetic = structuredClone(state);
    synthetic.players[player.id].career ??= {
      seasonsPlayed: 0, totals: structuredClone(player.seasonStats), peakOverall: playerOverall(player), peakImpact: playerOverall(player),
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
    };
    synthetic.players[player.id].career!.lastSeasonStats = { ...player.seasonStats, games: 82, seconds: 82 * 32 * 60, pts: 82 * 40 };
    synthetic.players[player.id].career!.lastSeasonStatsSource = "SYNTHETIC_OPENING";

    const baseline = processOffseasonPlayerLifecycle(state).players[player.id];
    const after = processOffseasonPlayerLifecycle(synthetic).players[player.id];
    expect(after.attributes).toEqual(baseline.attributes);
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

  it("ignores old-save assignments for players who no longer belong to the user's roster", () => {
    const state = lifecycleState("departed-training-growth");
    const [departedId, staleRosterId] = state.teams[state.userTeamId].playerIds;
    state.teams[state.userTeamId].playerIds = state.teams[state.userTeamId].playerIds.filter((id) => id !== departedId);
    state.teams.CHA.playerIds.push(departedId);
    for (const id of [departedId, staleRosterId]) {
      const player = state.players[id];
      player.teamId = "CHA";
      player.birthDate = "2005-01-10";
      player.ageSource = "GENERATED_BIRTH_DATE";
      player.attributes = { shooting: 60, finishing: 60, playmaking: 60, perimeterDefense: 60, interiorDefense: 60, rebounding: 60, athleticism: 60, basketballIq: 60 };
      player.truePotential = 84;
      player.developmentRate = 1;
      player.developmentVolatility = 0;
    }
    const baseline = processOffseasonPlayerLifecycle(state);
    state.trainingPlan = { seasonId: "2026-27", assignments: { [departedId]: "SHOOTING", [staleRosterId]: "DEFENSE", missing: "BALANCED" } };
    const focused = processOffseasonPlayerLifecycle(state);
    for (const id of [departedId, staleRosterId]) expect(focused.players[id].attributes).toEqual(baseline.players[id].attributes);
    expect(focused.playerLifecycle?.trainedPlayerIds).toEqual([]);
    expect(focused.trainingPlan?.assignments).toEqual({});
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

  it.each([21, 28, 33])("keeps a healthy employed %i-year-old even when the retirement draw would pass the old floor", (age) => {
    const state = lifecycleState(`healthy-retirement-${age}`);
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.birthDate = `${2027 - age}-01-01`;
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.attributes = { shooting: 40, finishing: 40, playmaking: 40, perimeterDefense: 40, interiorDefense: 40, rebounding: 40, athleticism: 40, basketballIq: 40 };
    player.injuryRating = 80;
    player.rotationRole = "BENCH";
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0, 0.001);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].age).toBe(age);
    expect(next.players[player.id].contract.status).toBe("STANDARD");
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(player.id);
  });

  it("allows exceptional early retirement after severe injury, while keeping its probability low", () => {
    const state = lifecycleState("injured-young-retirement");
    const player = state.players[state.teams.SEA.playerIds[0]];
    state.teams.SEA.playerIds = state.teams.SEA.playerIds.filter((id) => id !== player.id);
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.birthDate = "1999-01-01";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.injuryRating = 20;
    player.attributes = { shooting: 40, finishing: 40, playmaking: 40, perimeterDefense: 40, interiorDefense: 40, rebounding: 40, athleticism: 40, basketballIq: 40 };
    player.career = {
      seasonsPlayed: 2, totals: structuredClone(player.seasonStats), peakOverall: 65, peakImpact: 65,
      unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 82,
    };

    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0.03, 0.05);
    const survives = processOffseasonPlayerLifecycle(state);
    expect(survives.playerLifecycle?.retiredPlayerIds).not.toContain(player.id);

    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0, 0.001);
    const retires = processOffseasonPlayerLifecycle(state);
    expect(retires.playerLifecycle?.retiredPlayerIds).toContain(player.id);
  });

  it.each([26, 32, 34, 35, 37])("does not force a healthy %i-year-old to retire after two unemployed years", (age) => {
    const state = lifecycleState(`unemployed-under-38-${age}`);
    const player = state.players[state.teams.SEA.playerIds[0]];
    state.teams.SEA.playerIds = state.teams.SEA.playerIds.filter((id) => id !== player.id);
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.birthDate = `${2027 - age}-01-01`;
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.injuryRating = 80;
    player.rotationRole = "BENCH";
    player.attributes = { shooting: 60, finishing: 60, playmaking: 60, perimeterDefense: 60, interiorDefense: 60, rebounding: 60, athleticism: 60, basketballIq: 60 };
    player.career = {
      seasonsPlayed: 1, totals: structuredClone(player.seasonStats), peakOverall: 70, peakImpact: 70,
      unemployedGameDays: 180, unemployedLeagueYears: 1, careerInjuryGamesMissed: 0,
    };
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, age <= 34 ? 0 : 0.8, age <= 34 ? 0.001 : 0.9);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].age).toBe(age);
    expect(next.players[player.id].career?.unemployedLeagueYears).toBe(2);
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(player.id);
  });

  it.each([1, 2])("requires both age 38 and two unemployed years for the unemployment retirement floor (years=%i)", (years) => {
    const state = lifecycleState(`unemployed-age-38-${years}`);
    const player = state.players[state.teams.SEA.playerIds[0]];
    state.teams.SEA.playerIds = state.teams.SEA.playerIds.filter((id) => id !== player.id);
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.birthDate = "1989-01-01";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.injuryRating = 80;
    player.rotationRole = "BENCH";
    player.attributes = { shooting: 60, finishing: 60, playmaking: 60, perimeterDefense: 60, interiorDefense: 60, rebounding: 60, athleticism: 60, basketballIq: 60 };
    player.career = {
      seasonsPlayed: 1, totals: structuredClone(player.seasonStats), peakOverall: 70, peakImpact: 70,
      unemployedGameDays: (years - 1) * 180, unemployedLeagueYears: years - 1, careerInjuryGamesMissed: 0,
    };
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0.9, 0.91);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].age).toBe(38);
    expect(next.players[player.id].career?.unemployedLeagueYears).toBe(years);
    expect(next.playerLifecycle?.retiredPlayerIds.includes(player.id)).toBe(years === 2);
  });

  it("clears unemployment retirement risk when a veteran signs again", () => {
    const state = lifecycleState("reemployed-veteran-retirement");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.birthDate = "1989-01-01";
    player.ageSource = "GENERATED_BIRTH_DATE";
    player.injuryRating = 80;
    player.rotationRole = "BENCH";
    player.career = {
      seasonsPlayed: 1, totals: structuredClone(player.seasonStats), peakOverall: 70, peakImpact: 70,
      unemployedGameDays: 540, unemployedLeagueYears: 3, careerInjuryGamesMissed: 0,
    };
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0.9, 0.91);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].career?.unemployedGameDays).toBe(0);
    expect(next.players[player.id].career?.unemployedLeagueYears).toBe(0);
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(player.id);
  });

  it("continues to evaluate an older contracted player for retirement", () => {
    const state = lifecycleState("contracted-veteran-retirement");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.birthDate = "1989-01-01";
    player.ageSource = "GENERATED_BIRTH_DATE";
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(player.id, 0, 0.001);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[player.id].age).toBe(38);
    expect(next.playerLifecycle?.retiredPlayerIds).toContain(player.id);
  });

  it("keeps a healthy elite starter such as Durant through the first rollover despite an old-model retirement roll", () => {
    const state = bundledLifecycleState("durant-first-offseason");
    const durant = state.players["nba:201142"];
    expect(playerOverall(durant)).toBeGreaterThanOrEqual(80);
    expect(durant.contract.status).toBe("STANDARD");
    expect(durant.rotationRole).toBe("STARTER");
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(durant.id, 0.05, 0.08);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[durant.id].age).toBe(38);
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(durant.id);
  });

  it("protects a high-level veteran who played regularly before becoming a free agent", () => {
    const state = bundledLifecycleState("recent-veteran-playing-time");
    const durant = state.players["nba:201142"];
    state.teams[durant.teamId].playerIds = state.teams[durant.teamId].playerIds.filter((id) => id !== durant.id);
    durant.teamId = "FREE_AGENT";
    durant.contract.status = "UFA";
    durant.seasonStats.games = 60;
    durant.seasonStats.seconds = 60 * 30 * 60;
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(durant.id, 0.05, 0.08);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(durant.id);
  });

  it("reduces Dwight Powell's first unemployed-season retirement risk", () => {
    const state = bundledLifecycleState("powell-first-offseason");
    const powell = state.players["nba:203939"];
    expect(powell.teamId).toBe("FREE_AGENT");
    state.seeds.seasonSeed = seasonSeedWithRetirementRoll(powell.id, 0.32, 0.36);

    const next = processOffseasonPlayerLifecycle(state);
    expect(next.players[powell.id].age).toBe(36);
    expect(next.players[powell.id].career?.unemployedLeagueYears).toBe(1);
    expect(next.playerLifecycle?.retiredPlayerIds).not.toContain(powell.id);
    expect(next.players["nba:1626181"].contract.status).not.toBe("RETIRED");
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
