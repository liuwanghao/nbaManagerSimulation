#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createRatingsSnapshot, playerNameKey } from "./player_data_pipeline.mjs";

const [officialHtmlPath = "/tmp/nba-league-players.html", ratingsInputPath = "/tmp/nba2kapi-current-2026-09-23.json", snapshotDate = "2026-09-23"] = process.argv.slice(2);
const base = new URL("../../src/data/", import.meta.url);
const officialHtml = await readFile(officialHtmlPath, "utf8");
const pageData = JSON.parse(officialHtml.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/su)?.[1] ?? "");
const official = pageData.props?.pageProps?.players;
if (!Array.isArray(official) || official.length < 500) throw new Error(`Unexpected NBA official roster size: ${official?.length ?? 0}`);
const apiPayload = JSON.parse(await readFile(ratingsInputPath, "utf8"));
if (!apiPayload.success || !Array.isArray(apiPayload.data) || apiPayload.data.length < 500) throw new Error("NBA2K API snapshot is incomplete");
const ratings = createRatingsSnapshot(apiPayload, null, { gameVersion: "2K27", capturedAt: `${snapshotDate}T00:00:00.000Z` });
const ratingByName = new Map(ratings.players.map((player) => [playerNameKey(player.name), player]));
const normalizePosition = (position) => ({ G: "SG", "G-F": "SG", "F-G": "SF", F: "SF", "F-C": "PF", "C-F": "C" })[position] ?? (new Set(["PG", "SG", "SF", "PF", "C"]).has(position) ? position : "SF");
const parseHeight = (height) => {
  const match = String(height ?? "").match(/^(\d+)-(\d+)$/u);
  return match ? (Number(match[1]) * 12 + Number(match[2])) * 2.54 : null;
};
const parseWeight = (weight) => Number.isFinite(Number(weight)) && Number(weight) > 0 ? Number(weight) * 0.45359237 : null;
const players = official.map((entry) => {
  const id = String(entry.PERSON_ID);
  const name = `${entry.PLAYER_FIRST_NAME} ${entry.PLAYER_LAST_NAME}`.trim();
  const rating = ratingByName.get(playerNameKey(name));
  return {
    canonicalPlayerId: `nba:${id}`,
    nbaPlayerId: id,
    hupuPlayerId: null,
    fullName: name,
    aliases: [],
    teamAbbreviation: entry.TEAM_ABBREVIATION,
    jerseyNumber: entry.JERSEY_NUMBER == null || entry.JERSEY_NUMBER === "" ? null : String(entry.JERSEY_NUMBER),
    position: normalizePosition(rating?.positions?.[0] ?? entry.POSITION),
    secondaryPosition: rating?.positions?.[1] ?? null,
    positionSource: rating ? "NBA2K" : "INFERRED",
    age: 25,
    heightCm: parseHeight(entry.HEIGHT),
    weightKg: parseWeight(entry.WEIGHT),
    portraitPath: `./player-portraits/nba-${id}.png`,
    season: "2026-27",
    stats: {},
    projection: {
      attributes: { shooting: 25, finishing: 25, playmaking: 25, perimeterDefense: 25, interiorDefense: 25, rebounding: 25, athleticism: 25, basketballIq: 25 },
      overall: 25,
      potential: 25,
      durability: 25,
      personalitySeed: `nba-official-${id}-${snapshotDate}`,
      qualityFlags: [
        rating ? "NBA_2K27_PROFILE_PENDING_MAPPING" : "NBA_2K27_PROFILE_UNAVAILABLE",
        "NBA_OFFICIAL_AGE_UNAVAILABLE",
        ...(parseHeight(entry.HEIGHT) === null ? ["NBA_OFFICIAL_HEIGHT_UNAVAILABLE"] : []),
        ...(parseWeight(entry.WEIGHT) === null ? ["NBA_OFFICIAL_WEIGHT_UNAVAILABLE"] : []),
      ],
    },
  };
});
const officialRosterPlayers = official.map((entry) => ({
  nbaPlayerId: String(entry.PERSON_ID),
  fullName: `${entry.PLAYER_FIRST_NAME} ${entry.PLAYER_LAST_NAME}`.trim(),
  teamAbbreviation: entry.TEAM_ABBREVIATION,
  jerseyNumber: entry.JERSEY_NUMBER == null || entry.JERSEY_NUMBER === "" ? null : String(entry.JERSEY_NUMBER),
  position: entry.POSITION ?? null,
  height: entry.HEIGHT ?? null,
  weight: entry.WEIGHT == null ? null : Number(entry.WEIGHT),
})).sort((a, b) => a.fullName.localeCompare(b.fullName));
const roster = {
  schemaVersion: 1,
  rosterVersion: `nba-official-2026-27-${snapshotDate}`,
  retrievedAt: `${snapshotDate}T00:00:00+08:00`,
  sourceId: "nba.com-official-players-directory",
  players: officialRosterPlayers,
};
const finalPlayers = players.map((player) => {
  const profile = ratingByName.get(playerNameKey(player.fullName));
  if (!profile?.positions?.length) return player;
  const mapped = profile.positions.map(normalizePosition);
  const unique = [...new Set(mapped)];
  player.position = unique[0];
  player.secondaryPosition = unique[1] ?? null;
  return player;
});
const matched = [];
const unmatched = [];
const mapping = JSON.parse(await readFile(new URL("./nba2k27-rating-map.json", base), "utf8"));
const clamp = (value) => Math.max(25, Math.min(99, Math.round(value)));
const weighted = (attributes, weights) => clamp(Object.entries(weights).reduce((sum, [key, weight]) => sum + attributes[key] * weight, 0));
const category = (attributes, weights) => clamp(Object.entries(weights).reduce((sum, [key, weight]) => sum + attributes[key] * weight, 0));
for (const player of finalPlayers) {
  const profile = ratingByName.get(playerNameKey(player.fullName));
  if (!profile) {
    unmatched.push({ nbaPlayerId: player.nbaPlayerId, fullName: player.fullName, teamAbbreviation: player.teamAbbreviation });
    continue;
  }
  const a = profile.attributes;
  player.projection.attributes = {
    shooting: category(a, { "Three-Point Shot": .3, "Mid-Range Shot": .25, "Free Throw": .1, "Close Shot": .1, "Offensive Consistency": .15, "Shot IQ": .1 }),
    finishing: category(a, { "Close Shot": .2, Layup: .25, "Driving Dunk": .15, "Standing Dunk": .1, "Post Hook": .1, "Post Fade": .1, "Post Control": .1 }),
    playmaking: category(a, { "Ball Handle": .25, "Speed with Ball": .15, "Pass Accuracy": .25, "Pass Vision": .15, "Pass IQ": .2 }),
    perimeterDefense: weighted(a, mapping.perimeterDefense),
    interiorDefense: weighted(a, mapping.interiorDefense),
    rebounding: category(a, { "Defensive Rebound": .65, "Offensive Rebound": .35 }),
    athleticism: category(a, { Speed: .2, Strength: .15, Agility: .2, Vertical: .15, Hustle: .15, Stamina: .15 }),
    basketballIq: weighted(a, mapping.basketballIq),
  };
  player.projection.overall = profile.overall;
  player.projection.potential = profile.overall;
  player.projection.durability = a["Overall Durability"];
  player.projection.qualityFlags = [
    "NBA_2K27_FULL_PROFILE", "NBA_2K27_API_SNAPSHOT", "NBA_2K27_POTENTIAL_UNAVAILABLE", "NBA_OFFICIAL_AGE_UNAVAILABLE",
    ...(player.heightCm === null ? ["NBA_OFFICIAL_HEIGHT_UNAVAILABLE"] : []),
    ...(player.weightKg === null ? ["NBA_OFFICIAL_WEIGHT_UNAVAILABLE"] : []),
  ];
  matched.push(player.nbaPlayerId);
}
const dataset = JSON.parse(await readFile(new URL("./nba-player-dataset.json", base), "utf8"));
dataset.datasetVersion = `nba-official-2026-27-${snapshotDate}+nba2k27-api-${ratings.snapshotVersion.slice(-10)}`;
dataset.generatedAt = `${snapshotDate}T00:00:00.000Z`;
dataset.ratingModelVersion = "nba2k27-api-full-profile-map-v1";
dataset.positionModelVersion = "nba2k27-official-roster-positions-v1";
dataset.source = { ...dataset.source, currentSeason: "2026-27", nba2k: { snapshotVersion: ratings.snapshotVersion, provider: "NBA2K API", url: "build-time NBA2K API snapshot; no runtime request", official: false, mappingVersion: mapping.version, syncedAt: ratings.capturedAt } };
dataset.players = finalPlayers.sort((a, b) => Number(a.nbaPlayerId) - Number(b.nbaPlayerId));
const report = {
  schemaVersion: 1,
  snapshotDate,
  rosterSource: "NBA.com official players directory",
  ratingSource: "NBA2K API 2K27 current profiles",
  officialRosterPlayers: officialRosterPlayers.length,
  matched2kPlayers: matched.length,
  unavailable2kPlayers: unmatched.length,
  unavailablePlayers: unmatched,
  oldPlayerProfilesDiscarded: true,
  unavailablePlayerFallback: "25 for ratings, 25 for overall/potential/durability; flagged NBA_2K27_PROFILE_UNAVAILABLE and excluded from 2K coverage. This is a schema/game-safe placeholder, not 2K ability data.",
  unprovidedFields: "NBA.com roster snapshot does not provide age; 25 is a schema fallback. The 2K API does not provide potential; matched players use 2K overall as a neutral potential fallback. Missing official height/weight remain null and are flagged.",
};
if (dataset.players.length !== officialRosterPlayers.length || new Set(dataset.players.map((p) => p.nbaPlayerId)).size !== dataset.players.length) throw new Error("Rebuilt dataset does not exactly match official unique NBA IDs");
if (dataset.players.some((player) => player.age === 25 && player.projection.overall === 25)) {
  throw new Error("Refusing to write age/rating placeholders. Preserve the prior dataset, resolve player ages, and run the engine fallback enrichment before publishing.");
}
await Promise.all([
  writeFile(new URL("./nba-current-roster.json", base), `${JSON.stringify(roster)}\n`),
  writeFile(new URL("./nba-player-dataset.json", base), `${JSON.stringify(dataset)}\n`),
  writeFile(new URL("./nba2k27-current-ratings.json", base), `${JSON.stringify(ratings)}\n`),
  writeFile(new URL("./nba-supplemental-player-projections.json", base), "[]\n"),
  writeFile(new URL("./player-data-sync-report.json", base), `${JSON.stringify(report, null, 2)}\n`),
]);
console.log(JSON.stringify({ officialRosterPlayers: officialRosterPlayers.length, matched2kPlayers: matched.length, unavailable2kPlayers: unmatched.length, report: new URL("./player-data-sync-report.json", base).pathname }, null, 2));
