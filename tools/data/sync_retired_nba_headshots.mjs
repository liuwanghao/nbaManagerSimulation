#!/usr/bin/env node

// Build offline retired-player portraits from the same NBA headshot endpoint
// used for current players. Keep the reviewed Commons asset when NBA has no face.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nbaOfficialHeadshotUrl } from "./player_data_pipeline.mjs";
import { isUnavailableNbaHeadshot } from "./portrait_assets.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);
const manifestPath = join(root, "src/data/retiredLegendPortraits.json");
const portraitDirectory = join(root, "public/retired-portraits");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const candidates = manifest.portraits.filter((entry) => entry.source !== "user-provided");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function requestImage(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "basketball-franchise-manager-retired-headshots/1.0" } });
    if (response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 4) throw new Error(`${response.status} ${url}`);
      await pause(Math.min(2000 * 2 ** attempt, 30000));
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    if (!response.headers.get("content-type")?.startsWith("image/png")) throw new Error(`Expected PNG: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`Invalid PNG: ${url}`);
    return bytes;
  }
  throw new Error(`Could not load ${url}`);
}

const stagingDirectory = await mkdtemp(join(tmpdir(), "retired-nba-headshots-"));
let cursor = 0;
const results = [];
try {
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < candidates.length) {
      const entry = candidates[cursor++];
      const officialUrl = nbaOfficialHeadshotUrl(entry.nbaPlayerId);
      let bytes = await requestImage(officialUrl);
      let source = "nba-official-cdn";
      let sourceUrl = officialUrl;
      if (!bytes || isUnavailableNbaHeadshot(bytes)) {
        sourceUrl = `https://res.nba.cn/media/img/players/head/260x190/${entry.nbaPlayerId}.png`;
        bytes = await requestImage(sourceUrl);
        source = "nba-china";
      }
      if (!bytes || isUnavailableNbaHeadshot(bytes)) {
        results.push({ entry, source: "existing" });
        continue;
      }
      const input = join(stagingDirectory, `${entry.nbaPlayerId}.png`);
      const output = join(stagingDirectory, `${entry.nbaPlayerId}.webp`);
      await writeFile(input, bytes);
      execFileSync("cwebp", ["-lossless", "-quiet", input, "-o", output]);
      const portrait = await readFile(output);
      results.push({ entry, source, sourceUrl, output, sha256: createHash("sha256").update(portrait).digest("hex") });
      process.stderr.write(`${results.length}/${candidates.length} ${entry.name}: ${source}\n`);
    }
  }));

  for (const result of results) {
    if (result.source === "existing") {
      const path = join(portraitDirectory, `nba-${result.entry.nbaPlayerId}.webp`);
      const bytes = await readFile(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== result.entry.sha256) throw new Error(`Unverified fallback portrait: ${result.entry.name}`);
      continue;
    }
    await copyFile(result.output, join(portraitDirectory, `nba-${result.entry.nbaPlayerId}.webp`));
    const entry = result.entry;
    entry.source = result.source;
    entry.sourceUrl = result.sourceUrl;
    entry.file = `nba-${entry.nbaPlayerId}.png`;
    entry.modified = "Original 260 × 190 NBA PNG converted losslessly to WebP without cropping.";
    entry.rightsReview = "NBA image usage authorization confirmed by the project owner.";
    entry.qualityStatus = "approved";
    entry.sha256 = result.sha256;
    for (const key of ["commonsPage", "license", "licenseUrl", "artist", "cropX", "cropY", "zoom"]) delete entry[key];
  }
  const temporaryManifest = `${manifestPath}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryManifest, manifestPath);
  const sources = Object.groupBy(results, (result) => result.source);
  process.stdout.write(`NBA CDN ${sources["nba-official-cdn"]?.length ?? 0}, NBA China ${sources["nba-china"]?.length ?? 0}, existing Commons ${sources.existing?.length ?? 0}.\n`);
  if (sources.existing?.length) process.stdout.write(`Fallback: ${sources.existing.map((result) => result.entry.name).join(", ")}\n`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
