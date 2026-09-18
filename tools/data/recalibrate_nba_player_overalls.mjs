#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const datasetPath = new URL("../../src/data/nba-player-dataset.json", import.meta.url);
const nba2kPath = new URL("../../src/data/nba2k27-top100-ratings.json", import.meta.url);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const nba2k = JSON.parse(await readFile(nba2kPath, "utf8"));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const normalizeName = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]/giu, "").toLowerCase();
const datasetAliases = new Map([["jimmybutler", "jimmybutleriii"]]);

function productionOverall(base) {
  return Math.round(clamp(
    64
      + number(base.PTS) * 0.72
      + number(base.REB) * 0.36
      + number(base.AST) * 0.45
      + number(base.MIN) * 0.13,
    61,
    96,
  ));
}

const playersByName = new Map(dataset.players.flatMap((player) => [player.fullName, ...(player.aliases ?? [])]
  .map((name) => [normalizeName(name), player])));
const officialRatings = new Map();
const missingOfficialPlayers = [];
for (const rating of nba2k.ratings) {
  const normalized = normalizeName(rating.name);
  const player = playersByName.get(normalized) ?? playersByName.get(datasetAliases.get(normalized));
  if (!player) {
    missingOfficialPlayers.push(rating.name);
    continue;
  }
  officialRatings.set(player.canonicalPlayerId, rating.overall);
}

for (const player of dataset.players) {
  const productionTier = productionOverall(player.stats?.base ?? {});
  const officialOverall = officialRatings.get(player.canonicalPlayerId);
  const overall = officialOverall ?? productionTier;
  player.projection.overall = overall;
  player.projection.potential = Math.round(clamp(overall + Math.max(0, 26 - player.age) * 1.8, 50, 99));
  player.projection.qualityFlags = (player.projection.qualityFlags ?? []).filter((flag) => flag !== "NBA_2K27_TOP_100_OVR");
  if (officialOverall !== undefined) player.projection.qualityFlags.push("NBA_2K27_TOP_100_OVR");
}

dataset.ratingModelVersion = "nba2k27-top100+production-tier-v3";
await writeFile(datasetPath, `${JSON.stringify(dataset)}\n`);

const overalls = dataset.players.map((player) => player.projection.overall);
const average = overalls.reduce((total, value) => total + value, 0) / overalls.length;
console.log(JSON.stringify({
  players: overalls.length,
  average: Number(average.toFixed(2)),
  minimum: Math.min(...overalls),
  maximum: Math.max(...overalls),
  elite90Plus: overalls.filter((value) => value >= 90).length,
  nba2kAligned: officialRatings.size,
  nba2kUnavailable: missingOfficialPlayers,
}, null, 2));
