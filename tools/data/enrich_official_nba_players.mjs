#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { applyRatingsToPlayers, playerNameKey } from "./player_data_pipeline.mjs";

const root = new URL("../../src/data/", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));
const referencePath = process.argv[2];
if (!referencePath) throw new Error("Pass the prior NBA player dataset as the first argument");
const reference = JSON.parse(await readFile(referencePath, "utf8"));
const [dataset, roster, freeAgents, profiles, birthdateOverrides, salaryAges, ratings, mapping, report] = await Promise.all([
  read("nba-player-dataset.json"), read("nba-current-roster.json"), read("nba-2026-free-agents.json"),
  read("nba-official-player-profiles.json"), read("nba-player-birthdate-overrides.json"),
  read("nba-salary-age-2026.json"), read("nba2k27-current-ratings.json"),
  read("nba2k27-rating-map.json"), read("player-data-sync-report.json"),
]);
const priorById = new Map(reference.players.map((player) => [player.nbaPlayerId, player]));
const rosterIds = new Set(roster.players.map((player) => player.nbaPlayerId));
const freeAgentIds = new Set(freeAgents.players.map((player) => player.nbaPlayerId));
const snapshotDate = roster.retrievedAt.slice(0, 10);
const asOf = new Date(`${snapshotDate}T00:00:00Z`);
const clamp = (value, minimum = 25, maximum = 99) => Math.max(minimum, Math.min(maximum, Math.round(value)));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const hash = (value) => [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 2166136261);

function ageFromBirthDate(birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(birthDate ?? "")) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  return asOf.getUTCFullYear() - birth.getUTCFullYear()
    - Number(asOf.getUTCMonth() < birth.getUTCMonth()
      || asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate());
}

function enrichIdentity(player) {
  const prior = priorById.get(player.nbaPlayerId);
  const official = profiles.profiles[player.nbaPlayerId];
  const override = birthdateOverrides[player.nbaPlayerId];
  const birthDate = official?.birthDate ?? override?.birthDate;
  const age = ageFromBirthDate(birthDate) ?? salaryAges[player.nbaPlayerId];
  if (!Number.isInteger(age) || age < 18 || age > 50) throw new Error(`Missing valid age for ${player.fullName}`);
  player.age = age;
  player.projection.qualityFlags = player.projection.qualityFlags.filter((flag) => ![
    "NBA_OFFICIAL_AGE_UNAVAILABLE", "BIRTHDATE_VERIFIED", "HUPU_SALARY_AGE", "NBA_2025_26_AGE",
  ].includes(flag));
  player.projection.qualityFlags.push(birthDate ? "BIRTHDATE_VERIFIED" : "HUPU_SALARY_AGE");
  if (!Object.keys(player.stats ?? {}).length) {
    if (prior && Object.keys(prior.stats ?? {}).length) player.stats = prior.stats;
    else if (official?.stats && Object.keys(official.stats).length) player.stats = { base: official.stats };
  }
  return player;
}

const POSITION_DELTAS = {
  PG: [2, -1, 8, 1, -8, -7, 1, 4],
  SG: [5, 1, 2, 2, -5, -3, 2, 1],
  SF: [2, 2, 0, 2, 0, 1, 1, 1],
  PF: [-2, 4, -3, 0, 4, 5, 0, 1],
  C: [-6, 6, -7, -3, 8, 8, 0, 0],
};
const ATTRIBUTE_KEYS = ["shooting", "finishing", "playmaking", "perimeterDefense", "interiorDefense", "rebounding", "athleticism", "basketballIq"];

function inferredProjection(player) {
  const base = player.stats?.base ?? {};
  const pts = number(base.PTS);
  const reb = number(base.REB);
  const ast = number(base.AST);
  const minutes = number(base.MIN);
  const hasStats = pts > 0 || reb > 0 || ast > 0 || minutes > 0;
  const center = 58 + hash(player.nbaPlayerId) % 8;
  const deltas = POSITION_DELTAS[player.position];
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key, index) => [key, clamp(center + deltas[index]) ]));
  if (hasStats) {
    attributes.shooting = clamp(attributes.shooting + pts * 0.55);
    attributes.finishing = clamp(attributes.finishing + pts * 0.35);
    attributes.playmaking = clamp(attributes.playmaking + ast * 1.65);
    attributes.rebounding = clamp(attributes.rebounding + reb * 1.3);
    attributes.basketballIq = clamp(attributes.basketballIq + Math.min(4, minutes * 0.12));
  }
  const weighted = ATTRIBUTE_KEYS.reduce((sum, key) => sum + attributes[key], 0) / ATTRIBUTE_KEYS.length;
  const overall = clamp(weighted + (hasStats ? Math.min(5, pts * 0.35) : 0), 55, 75);
  return {
    attributes,
    overall,
    potential: clamp(overall + Math.max(0, 26 - player.age) * 1.8),
    durability: clamp(58 + hash(`${player.nbaPlayerId}:durability`) % 24),
    personalitySeed: player.projection.personalitySeed,
    qualityFlags: [
      ...player.projection.qualityFlags.filter((flag) => !flag.startsWith("NBA_2K27_") && !flag.startsWith("ENGINE_")),
      "NBA_2K27_PROFILE_UNAVAILABLE", hasStats ? "ENGINE_BASIC_STATS_ESTIMATE" : "ENGINE_POSITIONAL_ESTIMATE",
    ],
  };
}

for (const player of dataset.players) {
  enrichIdentity(player);
  if (player.projection.qualityFlags.includes("NBA_2K27_PROFILE_UNAVAILABLE")) player.projection = inferredProjection(player);
  else player.projection.potential = clamp(Math.max(player.projection.overall, player.projection.overall + Math.max(0, 26 - player.age) * 1.8));
}

const freeAgentPlayers = freeAgents.players.map((entry) => {
  const prior = priorById.get(entry.nbaPlayerId);
  if (!prior) throw new Error(`Missing prior player profile for free agent ${entry.fullName}`);
  const player = structuredClone(prior);
  player.fullName = entry.fullName;
  player.teamAbbreviation = "FA";
  player.season = dataset.source.currentSeason;
  const rating = ratings.players.find((candidate) => playerNameKey(candidate.name) === playerNameKey(entry.fullName));
  const positions = [...new Set((rating?.positions ?? []).filter((position) => POSITION_DELTAS[position]))];
  player.position = positions[0] ?? player.position;
  player.secondaryPosition = positions[1] ?? null;
  player.positionSource = positions.length ? "NBA2K" : "INFERRED";
  return enrichIdentity(player);
});
const alignedFreeAgents = applyRatingsToPlayers(freeAgentPlayers, { players: [] }, ratings, mapping).players;
for (const player of alignedFreeAgents) {
  if (!player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE")) player.projection = inferredProjection(player);
  player.projection.potential = clamp(Math.max(player.projection.overall, player.projection.overall + Math.max(0, 26 - player.age) * 1.8));
}
if (dataset.players.some((player) => !rosterIds.has(player.nbaPlayerId) && !freeAgentIds.has(player.nbaPlayerId))) {
  throw new Error("Dataset contains a player absent from both roster and free-agent snapshots");
}
if (alignedFreeAgents.some((player) => rosterIds.has(player.nbaPlayerId))) throw new Error("Roster/free-agent overlap remains");

report.officialRosterPlayers = roster.players.length;
report.matched2kPlayers = dataset.players.filter((player) => rosterIds.has(player.nbaPlayerId) && player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE")).length;
report.unavailable2kPlayers = dataset.players.filter((player) => rosterIds.has(player.nbaPlayerId) && player.projection.qualityFlags.includes("NBA_2K27_PROFILE_UNAVAILABLE")).length;
report.freeAgentPlayers = alignedFreeAgents.length;
report.freeAgentMatched2kPlayers = alignedFreeAgents.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE")).length;
report.ageCoverage = dataset.players.filter((player) => Number.isInteger(player.age) && player.age >= 18 && player.age <= 50).length;
report.unavailablePlayerFallback = "Missing 2K profiles use deterministic, position- and NBA-stat-based engine estimates; all estimates are explicitly flagged.";
report.unprovidedFields = "Player ages use official or independently verified birthdates, or the 2026-27 Hupu salary workbook. NBA 2K does not provide potential, so age-adjusted engine potential is estimated.";

await Promise.all([
  writeFile(new URL("nba-player-dataset.json", root), `${JSON.stringify(dataset)}\n`),
  writeFile(new URL("nba-free-agent-projections.json", root), `${JSON.stringify(alignedFreeAgents)}\n`),
  writeFile(new URL("player-data-sync-report.json", root), `${JSON.stringify(report, null, 2)}\n`),
]);
console.log(JSON.stringify({ roster: roster.players.length, dataset: dataset.players.length, freeAgents: alignedFreeAgents.length, matched2k: report.matched2kPlayers, inferred: report.unavailable2kPlayers }));
