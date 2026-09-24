#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  applyRatingsSnapshot,
  applyRatingsToPlayers,
  applyPlayerPositions,
  createRatingsSnapshot,
  nbaOfficialHeadshotPath,
  nbaOfficialHeadshotUrl,
  validatePlayerDataSync,
  validatePositionOverrideTargets,
} from "./player_data_pipeline.mjs";
import { isUnavailableNbaHeadshot } from "./portrait_assets.mjs";

const API_BASE_URL = "https://api.nba2kapi.com/api/versions";
const datasetPath = new URL("../../src/data/nba-player-dataset.json", import.meta.url);
const supplementalDatasetPath = new URL("../../src/data/nba-supplemental-player-projections.json", import.meta.url);
const rosterPath = new URL("../../src/data/nba-current-roster.json", import.meta.url);
const ratingsPath = new URL("../../src/data/nba2k27-current-ratings.json", import.meta.url);
const mappingPath = new URL("../../src/data/nba2k27-rating-map.json", import.meta.url);
const officialTop100Path = new URL("../../src/data/nba2k27-top100-ratings.json", import.meta.url);
const reportPath = new URL("../../src/data/player-data-sync-report.json", import.meta.url);
const positionOverridesPath = new URL("../../src/data/nba-player-position-overrides.json", import.meta.url);
const portraitDirectory = new URL("./portrait-source/", import.meta.url);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const officialPortraitsOnly = args.has("--official-portraits-only");
const positionsOnly = args.has("--positions-only");
const versionArg = [...args].find((arg) => arg.startsWith("--game-version="));
const gameVersion = (versionArg?.split("=")[1] ?? "2K27").toUpperCase();
const apiKey = process.env.NBA2K_API_KEY?.trim();
if (!officialPortraitsOnly && !positionsOnly && !apiKey) throw new Error("NBA2K_API_KEY is required. Store it in your shell environment; never in source code.");
if (!/^2K\d{2}$/u.test(gameVersion)) throw new Error(`Invalid game version: ${gameVersion}`);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function fetchPlayers() {
  const endpoint = `${API_BASE_URL}/${gameVersion}/players/bulk?teamType=curr`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "basketball-franchise-manager-data-sync/2.0",
      "X-API-Key": apiKey,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(`NBA2K API request failed: ${message}`);
  }
  return body;
}

async function writeJsonAtomic(url, value) {
  const temporaryUrl = new URL(`${url.pathname}.tmp`, "file://");
  await writeFile(temporaryUrl, `${JSON.stringify(value)}\n`);
  await rename(temporaryUrl, url);
}

function imageExtension(response, sourceUrl) {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  const match = sourceUrl.match(/\.(webp|png|jpe?g)(?:[?#]|$)/iu);
  return match?.[1].toLowerCase().replace("jpeg", "jpg") ?? null;
}

async function mapConcurrent(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function existingOfficialPortrait(nbaPlayerId) {
  const target = new URL(`nba-${nbaPlayerId}.png`, portraitDirectory);
  try {
    const bytes = await readFile(target);
    if (bytes.length && !isUnavailableNbaHeadshot(bytes)) return target;
  } catch {
    // Missing files are expected on the first official-photo sync.
  }
  return null;
}

async function downloadOfficialPortrait(player) {
  if (await existingOfficialPortrait(player.nbaPlayerId)) {
    return { status: "reused", portraitPath: nbaOfficialHeadshotPath(player.nbaPlayerId) };
  }
  const sourceUrl = nbaOfficialHeadshotUrl(player.nbaPlayerId);
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "basketball-franchise-manager-data-sync/2.1" },
  });
  if (!response.ok) return { status: "unavailable", error: `${response.status} ${response.statusText}` };
  if (imageExtension(response, sourceUrl) !== "png") return { status: "failed", error: "NBA CDN returned a non-PNG headshot" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return { status: "failed", error: "NBA CDN returned an empty headshot" };
  if (isUnavailableNbaHeadshot(bytes)) return { status: "unavailable", error: "NBA CDN returned its generic silhouette" };
  await writeFile(new URL(`nba-${player.nbaPlayerId}.png`, portraitDirectory), bytes);
  return { status: "downloaded", portraitPath: nbaOfficialHeadshotPath(player.nbaPlayerId) };
}

async function syncOfficialPortraits(dataset, shouldDownload) {
  const candidates = dataset.players.filter((player) => /^\d+$/u.test(String(player.nbaPlayerId)));
  if (!shouldDownload) return { source: "NBA official CDN", candidates: candidates.length, downloaded: 0, reused: 0, unavailable: 0, failed: 0 };
  await mkdir(portraitDirectory, { recursive: true });
  let completed = 0;
  const results = await mapConcurrent(candidates, 8, async (player) => {
    try {
      const result = await downloadOfficialPortrait(player);
      // New rookies occasionally lack an official CDN asset; their existing
      // local 2K portrait remains the intentional offline fallback.
      if (result.portraitPath) player.portraitPath = result.portraitPath;
      return result;
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      completed += 1;
      if (completed % 50 === 0 || completed === candidates.length) process.stderr.write(`NBA 官方头像 ${completed}/${candidates.length}\n`);
    }
  });
  return {
    source: "NBA official CDN",
    candidates: candidates.length,
    downloaded: results.filter((result) => result.status === "downloaded").length,
    reused: results.filter((result) => result.status === "reused").length,
    unavailable: results.filter((result) => result.status === "unavailable").length,
    failed: results.filter((result) => result.status === "failed").length,
    failureReasons: [...new Set(results.filter((result) => result.status === "failed").map((result) => result.error))].slice(0, 5),
  };
}

const [dataset, supplementalPlayers, roster, previousRatings, mapping, officialTop100, positionOverrides] = await Promise.all([
  readJson(datasetPath),
  readJson(supplementalDatasetPath),
  readJson(rosterPath),
  readJson(ratingsPath),
  readJson(mappingPath),
  readJson(officialTop100Path),
  readJson(positionOverridesPath),
]);

const apiPayload = officialPortraitsOnly || positionsOnly ? null : await fetchPlayers();
const ratings = apiPayload
  ? createRatingsSnapshot(apiPayload, previousRatings, { gameVersion })
  : previousRatings;
const applied = apiPayload ? applyRatingsSnapshot(dataset, roster, ratings, mapping) : { dataset, aligned: 0 };
const appliedSupplemental = apiPayload
  ? applyRatingsToPlayers(supplementalPlayers, roster, ratings, mapping)
  : { players: supplementalPlayers, aligned: 0 };
validatePositionOverrideTargets(positionOverrides, [...dataset.players, ...supplementalPlayers, ...roster.players]);
const positioned = applyPlayerPositions(applied.dataset, roster, ratings, positionOverrides);
const positionedSupplemental = applyPlayerPositions({ players: appliedSupplemental.players }, roster, ratings, positionOverrides);
const currentRosterIds = new Set(roster.players.map((player) => player.nbaPlayerId));
const currentRosterInferredPositions = positioned.dataset.players
  .filter((player) => currentRosterIds.has(player.nbaPlayerId) && player.positionSource === "INFERRED")
  .map((player) => ({ nbaPlayerId: player.nbaPlayerId, fullName: player.fullName }));
const officialPortraits = positionsOnly
  ? { source: "NBA official CDN", candidates: positioned.dataset.players.length, downloaded: 0, reused: 0, unavailable: 0, failed: 0 }
  : await syncOfficialPortraits(positioned.dataset, !dryRun);
const report = {
  ...validatePlayerDataSync(positioned.dataset, roster, ratings, officialTop100),
  syncedAt: ratings.capturedAt,
  dryRun,
  mode: positionsOnly ? "positions-only" : officialPortraitsOnly ? "official-portraits-only" : "full-player-sync",
  alignedDatasetPlayers: applied.aligned,
  positionedFrom2k: positioned.appliedFrom2k,
  positionedFromOverrides: positioned.appliedFromOverrides,
  retainedInferredPositions: positioned.retainedInferred,
  currentRosterRetainedInferredPositions: currentRosterInferredPositions.length,
  currentRosterInferredPositionPlayers: currentRosterInferredPositions,
  supplementalAligned: appliedSupplemental.aligned,
  supplementalPositionedFrom2k: positionedSupplemental.appliedFrom2k,
  supplementalPositionedFromOverrides: positionedSupplemental.appliedFromOverrides,
  supplementalRetainedInferredPositions: positionedSupplemental.retainedInferred,
  positionOverridesVersion: positionOverrides.version,
  officialPortraits,
};

if (!dryRun) {
  await Promise.all([
    apiPayload ? writeJsonAtomic(ratingsPath, ratings) : Promise.resolve(),
    writeJsonAtomic(datasetPath, positioned.dataset),
    writeJsonAtomic(supplementalDatasetPath, positionedSupplemental.dataset.players),
    writeJsonAtomic(reportPath, report),
  ]);
  if (!positionsOnly) execFileSync(process.execPath, [new URL("./build_portrait_atlas.mjs", import.meta.url).pathname], { stdio: "inherit" });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
