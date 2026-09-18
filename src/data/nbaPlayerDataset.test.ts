import { describe, expect, it } from "vitest";
import { calculateAttributeOverall } from "../game/player/PlayerRatingService";
import { CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { NBA_PLAYER_DATASET, validateNbaPlayerDataset } from "./nbaPlayerDataset";
import nba2k27 from "./nba2k27-top100-ratings.json";
import fullRatings from "./nba2k27-current-ratings.json";
import ratingMap from "./nba2k27-rating-map.json";
import syncReport from "./player-data-sync-report.json";

describe("NBA player dataset", () => {
  it("loads a versioned offline current-player snapshot", () => {
    expect(NBA_PLAYER_DATASET.schemaVersion).toBe(1);
    expect(NBA_PLAYER_DATASET.datasetVersion).toContain("nba-api-");
    expect(NBA_PLAYER_DATASET.ratingModelVersion).toBe("nba2k27-api-full-profile-map-v1");
    expect(NBA_PLAYER_DATASET.source.nba2k?.snapshotVersion).toMatch(/^nba2kapi-2k27-/u);
    expect(NBA_PLAYER_DATASET.source.nba2k?.provider).toBe("NBA2K API");
    expect(NBA_PLAYER_DATASET.source.nba2k?.official).toBe(false);
    expect(NBA_PLAYER_DATASET.source.nba2k?.mappingVersion).toBe(ratingMap.version);
    expect(NBA_PLAYER_DATASET.players.length).toBeGreaterThanOrEqual(270);
    expect(new Set(NBA_PLAYER_DATASET.players.map((player) => player.canonicalPlayerId)).size).toBe(NBA_PLAYER_DATASET.players.length);
    for (const player of NBA_PLAYER_DATASET.players) {
      expect(calculateAttributeOverall(player.projection.attributes, player.position)).toBeGreaterThanOrEqual(25);
      expect(player.projection.qualityFlags).toBeInstanceOf(Array);
    }
  });

  it("keeps recognizable stars in the elite tier without inflating the league", () => {
    const byName = new Map(NBA_PLAYER_DATASET.players.map((player) => [player.fullName, player]));
    expect(byName.get("Jalen Brunson")?.projection.overall).toBe(96);
    expect(byName.get("Nikola Jokić")?.projection.overall).toBe(97);
    expect(byName.get("Shai Gilgeous-Alexander")?.projection.overall).toBe(97);

    const overalls = NBA_PLAYER_DATASET.players.map((player) => player.projection.overall);
    const average = overalls.reduce((total, value) => total + value, 0) / overalls.length;
    expect(average).toBeGreaterThanOrEqual(68);
    expect(average).toBeLessThanOrEqual(76);
    expect(overalls.filter((value) => value >= 90).length).toBeGreaterThanOrEqual(5);
    expect(overalls.filter((value) => value >= 90).length).toBeLessThanOrEqual(25);
  });

  it("matches every available player in the official NBA 2K27 Top 100 snapshot", () => {
    const normalize = (value: string): string => value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-z0-9]/giu, "")
      .toLowerCase();
    const byName = new Map(NBA_PLAYER_DATASET.players.map((player) => [normalize(player.fullName), player]));
    byName.set("jimmybutler", byName.get("jimmybutleriii") as (typeof NBA_PLAYER_DATASET.players)[number]);
    const matched = nba2k27.ratings.filter((rating) => byName.has(normalize(rating.name)));
    expect(nba2k27.ratings).toHaveLength(100);
    expect(matched).toHaveLength(100);
    for (const rating of matched) {
      const player = byName.get(normalize(rating.name));
      expect(player?.projection.overall, rating.name).toBe(rating.overall);
      expect(player?.projection.qualityFlags, rating.name).toContain("NBA_2K27_FULL_PROFILE");
    }
  });

  it("maps the versioned full-profile snapshot into simulation attributes", () => {
    expect(fullRatings.game).toBe("NBA 2K27");
    expect(fullRatings.source.official).toBe(false);
    expect(fullRatings.players.length).toBeGreaterThanOrEqual(600);
    expect(fullRatings.source.provider).toBe("NBA2K API");

    const currentPlayers = NBA_PLAYER_DATASET.players.filter((player) => CURRENT_NBA_ROSTER_BY_ID.has(player.nbaPlayerId));
    const aligned = currentPlayers.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE"));
    expect(currentPlayers.length).toBeGreaterThanOrEqual(560);
    expect(aligned.length / currentPlayers.length).toBeGreaterThan(0.91);

    const byName = new Map(NBA_PLAYER_DATASET.players.map((player) => [player.fullName, player]));
    expect(byName.get("Jalen Brunson")?.projection).toMatchObject({
      overall: 96,
      attributes: { shooting: 93, playmaking: 90, athleticism: 83 },
    });
    expect(byName.get("Tyrese Haliburton")?.projection.overall).toBe(90);
    expect(byName.get("Kyrie Irving")?.projection.overall).toBe(87);
    expect(byName.get("Damian Lillard")?.projection.overall).toBe(86);

    expect(syncReport.snapshotVersion).toBe(fullRatings.snapshotVersion);
    expect(syncReport.currentCoveragePercent).toBeGreaterThanOrEqual(90);
    expect(syncReport.officialTop100Matched).toBe(100);
    expect(syncReport.officialTop100MeanAbsoluteError).toBe(0);
    expect(syncReport.teamAuthority).toBe("nba-current-roster.json");
    const portraits = NBA_PLAYER_DATASET.players.filter((player) => player.portraitPath);
    expect(portraits.length).toBeGreaterThanOrEqual(620);
    expect(portraits.every((player) => player.portraitPath?.startsWith("./player-portraits/"))).toBe(true);
    expect(portraits.every((player) => !player.portraitPath?.startsWith("http"))).toBe(true);
  });

  it("rejects duplicate canonical IDs and unknown schemas", () => {
    expect(() => validateNbaPlayerDataset({ ...NBA_PLAYER_DATASET, schemaVersion: 2 })).toThrow(/Unsupported/u);
    expect(() => validateNbaPlayerDataset({
      ...NBA_PLAYER_DATASET,
      players: [NBA_PLAYER_DATASET.players[0], NBA_PLAYER_DATASET.players[0]],
    })).toThrow(/Duplicate NBA player/u);
  });
});
