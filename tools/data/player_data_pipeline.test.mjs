import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NBA2K_ATTRIBUTE_FIELDS,
  applyRatingsSnapshot,
  createRatingsSnapshot,
  nbaOfficialHeadshotPath,
  nbaOfficialHeadshotUrl,
  transformApiPlayers,
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
