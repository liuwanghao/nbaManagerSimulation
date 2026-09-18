#!/usr/bin/env node

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import {
  applyRatingsSnapshot,
  createRatingsSnapshot,
  nbaOfficialHeadshotPath,
  nbaOfficialHeadshotUrl,
  validatePlayerDataSync,
} from "./player_data_pipeline.mjs";

const API_BASE_URL = "https://api.nba2kapi.com/api/versions";
const datasetPath = new URL("../../src/data/nba-player-dataset.json", import.meta.url);
const rosterPath = new URL("../../src/data/nba-current-roster.json", import.meta.url);
const ratingsPath = new URL("../../src/data/nba2k27-current-ratings.json", import.meta.url);
const mappingPath = new URL("../../src/data/nba2k27-rating-map.json", import.meta.url);
const officialTop100Path = new URL("../../src/data/nba2k27-top100-ratings.json", import.meta.url);
const reportPath = new URL("../../src/data/player-data-sync-report.json", import.meta.url);
const portraitDirectory = new URL("../../public/player-portraits/", import.meta.url);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const officialPortraitsOnly = args.has("--official-portraits-only");
const versionArg = [...args].find((arg) => arg.startsWith("--game-version="));
const gameVersion = (versionArg?.split("=")[1] ?? "2K27").toUpperCase();
const apiKey = process.env.NBA2K_API_KEY?.trim();
if (!officialPortraitsOnly && !apiKey) throw new Error("NBA2K_API_KEY is required. Store it in your shell environment; never in source code.");
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
    if ((await stat(target)).size > 0) return target;
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

const [dataset, roster, previousRatings, mapping, officialTop100] = await Promise.all([
  readJson(datasetPath),
  readJson(rosterPath),
  readJson(ratingsPath),
  readJson(mappingPath),
  readJson(officialTop100Path),
]);

const apiPayload = officialPortraitsOnly ? null : await fetchPlayers();
const ratings = apiPayload
  ? createRatingsSnapshot(apiPayload, previousRatings, { gameVersion })
  : previousRatings;
const applied = apiPayload ? applyRatingsSnapshot(dataset, roster, ratings, mapping) : { dataset, aligned: 0 };
const officialPortraits = await syncOfficialPortraits(applied.dataset, !dryRun);
const report = {
  ...validatePlayerDataSync(applied.dataset, roster, ratings, officialTop100),
  syncedAt: ratings.capturedAt,
  dryRun,
  mode: officialPortraitsOnly ? "official-portraits-only" : "full-player-sync",
  alignedDatasetPlayers: applied.aligned,
  officialPortraits,
};

if (!dryRun) {
  await Promise.all([
    apiPayload ? writeJsonAtomic(ratingsPath, ratings) : Promise.resolve(),
    writeJsonAtomic(datasetPath, applied.dataset),
    writeJsonAtomic(reportPath, report),
  ]);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
