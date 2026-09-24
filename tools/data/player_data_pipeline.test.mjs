import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NBA2K_ATTRIBUTE_FIELDS,
  applyPlayerPositions,
  applyRatingsSnapshot,
  createRatingsSnapshot,
  nbaOfficialHeadshotPath,
  nbaOfficialHeadshotUrl,
  transformApiPlayers,
  validatePositionList,
  validatePositionOverrides,
  validatePositionOverrideTargets,
} from "./player_data_pipeline.mjs";

function apiPlayer(overrides = {}) {
  return {
    slug: "test-player",
    name: "Test Player",
    team: "Boston Celtics",
    teamType: "curr",
    overall: 88,
    positions: ["PG"],
    attributes: Object.fromEntries(Object.values(NBA2K_ATTRIBUTE_FIELDS).map((key) => [key, 80])),
    lastUpdated: "2026-09-16T00:00:00.000Z",
    playerImage: "https://images.example.test/test-player.png",
    ...overrides,
  };
}

const exactCategories = {
  "Outside Scoring": 92,
  "Inside Scoring": 78,
  Playmaking: 90,
  Athleticism: 83,
  Defense: 74,
  Rebounding: 55,
};

describe("NBA2K API player data pipeline", () => {
  it("validates one or two distinct five-position values", () => {
    assert.deepEqual(validatePositionList(["PF", "C"]), ["PF", "C"]);
    assert.throws(() => validatePositionList([]), /one or two/u);
    assert.throws(() => validatePositionList(["PG", "S"]), /invalid position/u);
    assert.throws(() => validatePositionList(["SG", "SG"]), /duplicate positions/u);
    assert.throws(() => validatePositionList(["PG", "SG", "SF"]), /one or two/u);
  });

  it("writes 2K primary and secondary positions while applying curated overrides", () => {
    const dataset = {
      schemaVersion: 1,
      players: [
        { nbaPlayerId: "1", fullName: "Test Player", position: "SF" },
        { nbaPlayerId: "2", fullName: "Myles Turner", position: "PF" },
        { nbaPlayerId: "3", fullName: "Unmatched Player", position: "SG" },
      ],
    };
    const roster = { players: [
      { nbaPlayerId: "1", fullName: "Test Player" },
      { nbaPlayerId: "2", fullName: "Myles Turner" },
    ] };
    const ratings = { players: [
      { name: "Test Player", positions: ["PG", "SG"] },
      { name: "Myles Turner", positions: ["C"] },
    ] };
    const overrides = {
      schemaVersion: 1,
      version: "test-overrides",
      sourceId: "curated-player-position-overrides",
      players: [{ nbaPlayerId: "2", fullName: "Myles Turner", positions: ["PF", "C"], reason: "Test correction" }],
    };

    const result = applyPlayerPositions(dataset, roster, ratings, overrides);
    assert.deepEqual(result.dataset.players.map(({ position, secondaryPosition, positionSource }) => ({
      position, secondaryPosition, positionSource,
    })), [
      { position: "PG", secondaryPosition: "SG", positionSource: "NBA2K" },
      { position: "PF", secondaryPosition: "C", positionSource: "MANUAL_OVERRIDE" },
      { position: "SG", secondaryPosition: null, positionSource: "INFERRED" },
    ]);
    assert.equal(result.dataset.schemaVersion, 2);
    assert.equal(result.appliedFrom2k, 1);
    assert.equal(result.appliedFromOverrides, 1);
    assert.equal(result.retainedInferred, 1);
  });

  it("rejects stale or ambiguous curated position overrides", () => {
    const valid = {
      schemaVersion: 1,
      version: "test-overrides",
      sourceId: "curated-player-position-overrides",
      players: [{ nbaPlayerId: "1", fullName: "Test Player", positions: ["PG"], reason: "Test correction" }],
    };
    assert.equal(validatePositionOverrides(valid), valid);
    assert.throws(() => validatePositionOverrides({ ...valid, players: [{ ...valid.players[0], reason: "" }] }), /requires a reason/u);
    assert.throws(() => applyPlayerPositions(
      { players: [{ nbaPlayerId: "1", fullName: "Test Player", position: "PG" }] },
      { players: [{ nbaPlayerId: "1", fullName: "Different Player" }] },
      { players: [] },
      valid,
    ), /does not match the NBA roster/u);
    assert.throws(() => validatePositionOverrideTargets(valid, []), /does not match a known player/u);
  });

  it("applies a curated 2K position to a player outside the current NBA roster", () => {
    const overrides = {
      schemaVersion: 1,
      version: "test-overrides",
      sourceId: "curated-player-position-overrides",
      players: [{ nbaPlayerId: "1641715", fullName: "Cam Whitmore", positions: ["SF", "PF"], reason: "Verified 2K positions" }],
    };
    const dataset = { players: [{ nbaPlayerId: "1641715", fullName: "Cam Whitmore", position: "SG" }] };
    validatePositionOverrideTargets(overrides, dataset.players);
    const result = applyPlayerPositions(dataset, { players: [] }, { players: [] }, overrides);
    assert.deepEqual(result.dataset.players[0], {
      nbaPlayerId: "1641715",
      fullName: "Cam Whitmore",
      position: "SF",
      secondaryPosition: "PF",
      positionSource: "MANUAL_OVERRIDE",
    });
  });

  it("uses the stable NBA Player ID for an official offline headshot", () => {
    assert.equal(nbaOfficialHeadshotUrl("1629029"), "https://cdn.nba.com/headshots/nba/latest/260x190/1629029.png");
    assert.equal(nbaOfficialHeadshotPath("1629029"), "./player-portraits/nba-1629029.png");
    assert.throws(() => nbaOfficialHeadshotUrl("not-an-id"), /Invalid NBA player id/);
  });

  it("preserves exact legacy categories while replacing the API profile", () => {
    const result = transformApiPlayers([apiPlayer()], {
      players: [{ name: "Test Player", categoryRatings: exactCategories, potentialGrade: "A-" }],
    });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].categoryRatings, exactCategories);
    assert.equal(result[0].categoryRatingsSource, "LEGACY_EXACT");
    assert.equal(result[0].attributes["Three-Point Shot"], 80);
    assert.equal(result[0].portraitPath, null);
  });

  it("derives complete deterministic categories for API-only players", () => {
    const [result] = transformApiPlayers([apiPlayer({ name: "New Player" })]);
    assert.deepEqual(result.categoryRatings, {
      "Outside Scoring": 80,
      "Inside Scoring": 80,
      Playmaking: 80,
      Athleticism: 80,
      Defense: 80,
      Rebounding: 80,
    });
    assert.equal(result.categoryRatingsSource, "DERIVED_FROM_ATTRIBUTES");
  });

  it("updates ratings without letting API team data replace official roster identity", () => {
    const ratings = createRatingsSnapshot({
      success: true,
      data: [apiPlayer({ team: "Free Agency" })],
      meta: { gameVersion: "2K27" },
    }, { players: [{ name: "Test Player", categoryRatings: exactCategories }] }, {
      gameVersion: "2K27",
      capturedAt: "2026-09-18T00:00:00.000Z",
    });
    ratings.players[0].portraitPath = "./player-portraits/test-player.png";
    const dataset = {
      datasetVersion: "nba-api-2025-26+nba2k27-old",
      ratingModelVersion: "old",
      source: {},
      players: [{
        canonicalPlayerId: "nba:1",
        nbaPlayerId: "1",
        fullName: "Test Player",
        teamAbbreviation: "BOS",
        projection: {
          attributes: {}, overall: 60, potential: 91, durability: 70,
          qualityFlags: ["NBA_2K27_COMMUNITY_MIRROR"],
        },
      }],
    };
    const roster = { players: [{ nbaPlayerId: "1", fullName: "Test Player", teamAbbreviation: "BOS" }] };
    const mapping = {
      version: "test-map",
      perimeterDefense: { "Perimeter Defense": 1 },
      interiorDefense: { "Interior Defense": 1 },
      basketballIq: { "Shot IQ": 1 },
      potentialByGrade: {},
    };
    const applied = applyRatingsSnapshot(dataset, roster, ratings, mapping).dataset;
    assert.equal(applied.players[0].teamAbbreviation, "BOS");
    assert.equal(applied.players[0].projection.overall, 88);
    assert.equal(applied.players[0].projection.potential, 91);
    assert.equal(applied.players[0].portraitPath, "./player-portraits/test-player.png");
    assert.deepEqual(applied.players[0].projection.attributes, {
      shooting: 92,
      finishing: 78,
      playmaking: 90,
      perimeterDefense: 80,
      interiorDefense: 80,
      rebounding: 55,
      athleticism: 83,
      basketballIq: 80,
    });
    assert.ok(applied.players[0].projection.qualityFlags.includes("NBA_2K27_API_SNAPSHOT"));
  });
});
