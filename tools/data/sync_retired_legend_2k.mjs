#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RETIRED_LEGEND_TEMPLATES } from "../../src/data/retiredLegendTemplates.ts";
import { NBA2K_ATTRIBUTE_FIELDS, deriveCategoryRatings } from "./player_data_pipeline.mjs";

const outputUrl = new URL("../../src/data/retiredLegend2kRatings.json", import.meta.url);
const mappingUrl = new URL("../../src/data/nba2k27-rating-map.json", import.meta.url);
const versionsEndpoint = "https://api.nba2kapi.com/api/versions";
const endpoint = (gameVersion, teamType) => `https://api.nba2kapi.com/api/versions/${gameVersion}/players/bulk?teamType=${teamType}`;
const nameKey = (value) => String(value ?? "").normalize("NFKD").replace(/[^a-z0-9]/giu, "").toLowerCase();
const clamp = (value) => Math.max(25, Math.min(99, Math.round(value)));
const VALID_POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);

function normalizedPositions(value) {
  if (!Array.isArray(value)) return null;
  const positions = [...new Set(value.filter((position) => VALID_POSITIONS.has(position)))];
  return positions.length ? positions : null;
}

function mappedAttributes(raw, mapping) {
  if (!raw || typeof raw !== "object") return null;
  const attributes = Object.fromEntries(Object.entries(NBA2K_ATTRIBUTE_FIELDS)
    .map(([label, key]) => [label, raw[key]]));
  const categories = deriveCategoryRatings(attributes);
  const weighted = (weights) => {
    const terms = Object.entries(weights);
    return terms.every(([key]) => Number.isFinite(attributes[key]))
      ? clamp(terms.reduce((sum, [key, weight]) => sum + attributes[key] * weight, 0))
      : null;
  };
  const result = {
    shooting: categories["Outside Scoring"],
    finishing: categories["Inside Scoring"],
    playmaking: categories.Playmaking,
    perimeterDefense: weighted(mapping.perimeterDefense),
    interiorDefense: weighted(mapping.interiorDefense),
    rebounding: categories.Rebounding,
    athleticism: categories.Athleticism,
    basketballIq: weighted(mapping.basketballIq),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function buildPeakRatings(templates, rows, mapping) {
  const byName = new Map();
  for (const row of rows) {
    if (!["class", "allt"].includes(row?.teamType) || !Number.isInteger(row.overall) || row.overall < 25 || row.overall > 99) continue;
    const key = nameKey(row.name);
    const previous = byName.get(key);
    if (!previous || row.overall > previous.overall || row.overall === previous.overall && row.teamType === "allt" && previous.teamType !== "allt") {
      byName.set(key, row);
    }
  }
  const players = [];
  const unmatched = [];
  for (const template of templates) {
    const row = byName.get(nameKey(template.sourceName));
    if (!row) {
      unmatched.push({ sourcePlayerId: template.sourcePlayerId, sourceName: template.sourceName });
      continue;
    }
    const positions = normalizedPositions(row.positions);
    players.push({
      sourcePlayerId: template.sourcePlayerId,
      sourceName: template.sourceName,
      peakOverall: row.overall,
      peakAttributes: mappedAttributes(row.attributes, mapping),
      ...(positions ? { positions } : {}),
      gameVersion: row.gameVersion,
      team: row.team,
      teamType: row.teamType,
    });
  }
  return { players, unmatched };
}

async function fetchVersions() {
  const response = await fetch(versionsEndpoint, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
    throw new Error(`Could not fetch available editions: ${payload?.error?.message ?? response.status}`);
  }
  return payload.data.map((edition) => edition.gameVersion).filter((version) => /^2K\d{2}$/u.test(version));
}

async function fetchRoster(gameVersion, teamType, apiKey) {
  const response = await fetch(endpoint(gameVersion, teamType), { headers: { Accept: "application/json", "X-API-Key": apiKey } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
    throw new Error(`Could not fetch ${gameVersion} ${teamType} ratings: ${payload?.error?.message ?? response.status}`);
  }
  return payload.data;
}

async function main() {
  const apiKey = process.env.NBA2K_API_KEY?.trim();
  if (!apiKey) throw new Error("NBA2K_API_KEY is required; set it in the shell environment, never in source code.");
  const mapping = JSON.parse(await readFile(mappingUrl, "utf8"));
  const gameVersions = await fetchVersions();
  if (!gameVersions.length) throw new Error("No NBA 2K editions are available from the API.");
  const rosters = await Promise.all(gameVersions.flatMap((version) => [
    fetchRoster(version, "class", apiKey),
    fetchRoster(version, "allt", apiKey),
  ]));
  const result = buildPeakRatings(RETIRED_LEGEND_TEMPLATES, rosters.flat(), mapping);
  const snapshot = {
    schemaVersion: 1,
    gameVersions,
    source: "nba2kapi highest available classic/all-time roster rating (community service; not affiliated with 2K)",
    capturedAt: new Date().toISOString(),
    players: result.players,
    unmatched: result.unmatched,
  };
  await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`Matched ${result.players.length}/${RETIRED_LEGEND_TEMPLATES.length} retired players across ${gameVersions.join(", ")}.\n`);
  if (result.unmatched.length) process.stdout.write(`Unmatched: ${result.unmatched.map((player) => player.sourceName).join(", ")}\n`);
  process.stdout.write("These are maxima across available API editions, not all 2K releases, verified rookie-season ratings, or development potential.\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
