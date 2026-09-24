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
    expect(NBA_PLAYER_DATASET.schemaVersion).toBe(2);
    expect(NBA_PLAYER_DATASET.datasetVersion).toContain("nba-official-2026-27-2026-09-23");
    expect(NBA_PLAYER_DATASET.ratingModelVersion).toBe("nba2k27-api-full-profile-map-v1");
    expect(NBA_PLAYER_DATASET.positionModelVersion).toBe("nba2k27-official-roster-positions-v1");
    expect(NBA_PLAYER_DATASET.source.nba2k?.snapshotVersion).toMatch(/^nba2kapi-2k27-/u);
    expect(NBA_PLAYER_DATASET.source.nba2k?.provider).toBe("NBA2K API");
    expect(NBA_PLAYER_DATASET.source.nba2k?.official).toBe(false);
    expect(NBA_PLAYER_DATASET.source.nba2k?.mappingVersion).toBe(ratingMap.version);
    expect(NBA_PLAYER_DATASET.players).toHaveLength(580);
    expect(new Set(NBA_PLAYER_DATASET.players.map((player) => player.canonicalPlayerId)).size).toBe(NBA_PLAYER_DATASET.players.length);
    for (const player of NBA_PLAYER_DATASET.players) {
      expect(calculateAttributeOverall(player.projection.attributes, player.position)).toBeGreaterThanOrEqual(25);
      expect(player.projection.qualityFlags).toBeInstanceOf(Array);
      expect(["NBA2K", "MANUAL_OVERRIDE", "INFERRED"]).toContain(player.positionSource);
      expect(player.secondaryPosition).not.toBe(player.position);
    }
  });

  it("stores NBA 2K primary and secondary positions in the dataset", () => {
    const turner = NBA_PLAYER_DATASET.players.find((player) => player.nbaPlayerId === "1626167");
    const whitmore = NBA_PLAYER_DATASET.players.find((player) => player.nbaPlayerId === "1641715");
    expect(turner).toMatchObject({
      fullName: "Myles Turner",
      position: "C",
      secondaryPosition: null,
      positionSource: "NBA2K",
    });
    expect(whitmore).toMatchObject({
      fullName: "Cam Whitmore",
      position: "SF",
      secondaryPosition: "PF",
      positionSource: "NBA2K",
    });
    expect(NBA_PLAYER_DATASET.players.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE"))).toHaveLength(545);
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
      attributes: { shooting: 93, playmaking: 91, athleticism: 83 },
    });
    expect(byName.get("Tyrese Haliburton")?.projection.overall).toBe(90);
    expect(byName.get("Kyrie Irving")?.projection.overall).toBe(87);
    expect(byName.get("Damian Lillard")?.projection.overall).toBe(86);

    expect(syncReport.snapshotDate).toBe("2026-09-23");
    expect(syncReport.officialRosterPlayers).toBe(577);
    expect(syncReport.matched2kPlayers).toBe(542);
    expect(syncReport.unavailable2kPlayers).toBe(35);
    expect(syncReport.oldPlayerProfilesDiscarded).toBe(true);
    expect(syncReport.unavailablePlayers).toHaveLength(35);
    const portraits = NBA_PLAYER_DATASET.players.filter((player) => player.portraitPath);
    expect(portraits.length).toBe(580);
    expect(portraits.every((player) => player.portraitPath?.startsWith("./player-portraits/"))).toBe(true);
    expect(portraits.every((player) => !player.portraitPath?.startsWith("http"))).toBe(true);
    expect(NBA_PLAYER_DATASET.players.every((player) => player.age >= 18 && player.age <= 50)).toBe(true);
    expect(NBA_PLAYER_DATASET.players.every((player) => !player.projection.qualityFlags.includes("NBA_2025_26_AGE"))).toBe(true);
    expect(new Set(NBA_PLAYER_DATASET.players.map((player) => player.age)).size).toBeGreaterThan(15);
    expect(NBA_PLAYER_DATASET.players.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_PROFILE_UNAVAILABLE")))
      .toHaveLength(35);
    expect(NBA_PLAYER_DATASET.players.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_PROFILE_UNAVAILABLE"))
      .every((player) => player.projection.overall > 25)).toBe(true);
  });

  it("rejects duplicate canonical IDs and unknown schemas", () => {
    expect(() => validateNbaPlayerDataset({ ...NBA_PLAYER_DATASET, schemaVersion: 1 })).toThrow(/Unsupported/u);
    expect(() => validateNbaPlayerDataset({
      ...NBA_PLAYER_DATASET,
      players: [NBA_PLAYER_DATASET.players[0], NBA_PLAYER_DATASET.players[0]],
    })).toThrow(/Duplicate NBA player/u);
    expect(() => validateNbaPlayerDataset({
      ...NBA_PLAYER_DATASET,
      players: [{ ...NBA_PLAYER_DATASET.players[0], secondaryPosition: NBA_PLAYER_DATASET.players[0].position }],
    })).toThrow(/Duplicate positions/u);
  });
});
