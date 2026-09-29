#!/usr/bin/env node

// Import the reviewed Commons files listed in retiredLegendPortraits.json.
// The script never searches by player name: an explicit file choice prevents a
// future search result or Wikipedia page image change from silently replacing a face.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const manifestPath = join(root, "src/data/retiredLegendPortraits.json");
const idModulePath = join(root, "src/data/retiredLegendPortraitIds.ts");
const runtimeIdsPath = join(root, "src/data/retiredLegendPortraitIds.ts");
const imageDirectory = join(root, "public/retired-portraits");
const attributionPath = join(root, "public/retired-portrait-attributions.html");
const userAgent = "nba-manager-retired-portrait-import/1.0 (Commons attribution metadata)";
const allowedLicenses = new Set(["CC BY 2.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "Public domain"]);
const force = process.argv.includes("--force");
const refreshIds = new Set(process.argv.find((arg) => arg.startsWith("--refresh-ids="))?.slice("--refresh-ids=".length).split(",") ?? []);
const metadataOnly = process.argv.includes("--metadata-only");
const offlineIndex = process.argv.includes("--offline-index");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[entity])
    .replace(/\s+/gu, " ").trim();
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 120000)
          : Math.min(5000 * 2 ** attempt, 120000);
        process.stderr.write(`Image host ${response.status}; waiting ${Math.round(delay / 1000)}s before retry\n`);
        lastError = new Error(`${response.status} ${response.statusText}`);
        await pause(delay);
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      await pause(600 * (attempt + 1));
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function commonsMetadata(files) {
  const result = new Map();
  for (let offset = 0; offset < files.length; offset += 40) {
    const params = new URLSearchParams({
      action: "query",
      titles: files.slice(offset, offset + 40).map((file) => `File:${file}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|sha1",
      iiurlwidth: "512",
      format: "json",
    });
    const data = await (await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`)).json();
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (page.missing || !page.imageinfo?.[0]) continue;
      result.set(page.title.slice(5).replaceAll("_", " "), page.imageinfo[0]);
    }
  }
  return result;
}

async function mapLimited(entries, limit, task) {
  let cursor = 0;
  const result = Array(entries.length);
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      result[index] = await task(entries[index], index);
    }
  }));
  return result;
}

async function saveManifest(manifest) {
  const temporary = `${manifestPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporary, manifestPath);
  const ids = manifest.portraits.filter((entry) => entry.sha256).map((entry) => entry.nbaPlayerId);
  const source = [
    "// Generated from retiredLegendPortraits.json by import_retired_legend_portraits.mjs.",
    "// Keep attribution URLs in the separate manifest, outside the offline game script.",
    "export const BUNDLED_RETIRED_PORTRAIT_IDS = [",
    ...ids.map((id) => `  ${JSON.stringify(id)},`),
    "] as const;",
    "",
  ].join("\n");
  await writeFile(runtimeIdsPath, source);
}

async function writeIdModule(entries) {
  const ids = entries.filter((entry) => entry.qualityStatus === "approved" && entry.sha256).map((entry) => entry.nbaPlayerId);
  const content = `// Generated by tools/data/import_retired_legend_portraits.mjs.\n// Only portraits with a recorded SHA-256 and completed visual review are exposed.\nexport const BUNDLED_RETIRED_PORTRAIT_IDS = ${JSON.stringify(ids, null, 2)} as const;\n`;
  const temporary = `${idModulePath}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, idModulePath);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = manifest.portraits;
if (!Array.isArray(entries) || entries.length !== 90) throw new Error("Expected exactly 90 curated retired-player portrait records");
if (new Set(entries.map((entry) => entry.nbaPlayerId)).size !== 90) throw new Error("Duplicate NBA portrait ID");
if (new Set(entries.map((entry) => entry.file)).size !== 90) throw new Error("Duplicate Commons file selection");
if (entries.some((entry) => !/^\d+$/u.test(entry.nbaPlayerId) || !entry.name || !entry.file)) throw new Error("Incomplete portrait identity");
if (entries.some((entry) => entry.cropY !== undefined && (typeof entry.cropY !== "number" || entry.cropY < 0 || entry.cropY > 1))) throw new Error("cropY must be a number from 0 (top) to 1 (bottom)");
if (entries.some((entry) => entry.cropX !== undefined && (typeof entry.cropX !== "number" || entry.cropX < 0 || entry.cropX > 1))) throw new Error("cropX must be a number from 0 (left) to 1 (right)");
if (entries.some((entry) => entry.zoom !== undefined && (typeof entry.zoom !== "number" || entry.zoom < 1 || entry.zoom > 3))) throw new Error("zoom must be a number from 1 to 3");
for (const entry of entries) entry.qualityStatus ??= entry.sha256 ? "needs_review" : "pending_download";
if (entries.some((entry) => !["approved", "needs_review", "needs_recrop", "pending_download"].includes(entry.qualityStatus))) throw new Error("Invalid portrait qualityStatus");
if (offlineIndex) {
  await saveManifest(manifest);
  await writeIdModule(entries);
  process.stdout.write("Rebuilt approved retired portrait ID list without network requests.\n");
  process.exit(0);
}

const metadata = await commonsMetadata(entries.map((entry) => entry.file));
for (const entry of entries) {
  const info = metadata.get(entry.file.replaceAll("_", " "));
  if (!info) throw new Error(`Commons file missing: ${entry.file}`);
  const external = info.extmetadata ?? {};
  const license = plainText(external.LicenseShortName?.value);
  const licenseUrl = external.LicenseUrl?.value ?? null;
  if (!allowedLicenses.has(license)) throw new Error(`Unsupported license for ${entry.name}: ${license}`);
  if (license !== "Public domain" && !/^https:\/\//u.test(licenseUrl ?? "")) throw new Error(`Missing license URL for ${entry.name}`);
  entry.commonsPage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(entry.file.replaceAll(" ", "_"))}`;
  entry.license = license;
  entry.licenseUrl = licenseUrl;
  entry.artist = plainText(external.Artist?.value) || "Unknown author";
  entry.modified = `${entry.cropY === 0 ? "Top-aligned" : entry.cropY === 1 ? "Bottom-aligned" : "Centered"} square crop${entry.zoom && entry.zoom > 1 ? ` with ${entry.zoom}× zoom` : ""}, resized to 256 × 256 pixels, converted to WebP.`;
  entry.rightsReview = license === "Public domain"
    ? "Commons public-domain claim; validity outside the United States and personality rights require review."
    : "Photograph copyright license recorded; personality rights require separate review.";
}
await saveManifest(manifest);
await writeIdModule(entries);

const rows = entries.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td><a href="${escapeHtml(entry.commonsPage)}">${escapeHtml(entry.file)}</a></td><td>${escapeHtml(entry.artist)}</td><td>${entry.licenseUrl ? `<a href="${escapeHtml(entry.licenseUrl)}">${escapeHtml(entry.license)}</a>` : escapeHtml(entry.license)}</td><td>${escapeHtml(entry.modified)}</td><td>${escapeHtml(entry.rightsReview)}</td></tr>`).join("\n");
const attribution = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>退役球员头像来源与署名</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#222}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top}tr:nth-child(even){background:#f5f5f5}a{color:#0645ad}@media(max-width:700px){table{display:block;overflow-x:auto;white-space:nowrap}}</style></head><body><h1>退役球员头像来源与署名</h1><p>下列图片从 Wikimedia Commons 所列文件制作。逐张列出作者、摄影版权许可与处理方式。标注 CC BY-SA 的裁切、缩放和格式转换后单张头像仍按对应原许可提供；每张图的改动列在下表。人物姓名、肖像及球队标识的使用权与照片版权相互独立；Commons 许可不代表球员或 NBA 对本游戏的认可。标注公有领域的图片可能只在特定法域成立。</p><table><thead><tr><th>球员</th><th>来源</th><th>作者</th><th>摄影版权许可</th><th>修改</th><th>权利复核</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`;
await writeFile(attributionPath, attribution);
if (metadataOnly) {
  process.stdout.write("Updated metadata and attribution for 90 Commons portrait candidates.\n");
  process.exit(0);
}

const tempDirectory = await mkdtemp(join(tmpdir(), "retired-portraits-"));
await mkdir(imageDirectory, { recursive: true });
try {
  await mapLimited(entries, 1, async (entry, index) => {
    const info = metadata.get(entry.file.replaceAll("_", " "));
    const output = join(imageDirectory, `nba-${entry.nbaPlayerId}.webp`);
    let portraitBytes = force || refreshIds.has(entry.nbaPlayerId) ? null : await readFile(output).catch(() => null);
    if (portraitBytes && (portraitBytes.toString("ascii", 0, 4) !== "RIFF" || portraitBytes.toString("ascii", 8, 12) !== "WEBP")) throw new Error(`Invalid existing WebP for ${entry.name}`);
    if (portraitBytes && entry.sha256 && createHash("sha256").update(portraitBytes).digest("hex") !== entry.sha256) throw new Error(`Existing portrait changed for ${entry.name}`);
    if (!portraitBytes) {
      const sourceUrl = info.thumburl ?? info.url;
      const bytes = Buffer.from(await (await fetchWithRetry(sourceUrl)).arrayBuffer());
      if (!bytes.length) throw new Error(`Empty image for ${entry.name}`);
      const extension = new URL(sourceUrl).pathname.match(/\.(jpe?g|png|webp)$/iu)?.[1] ?? "image";
      const input = join(tempDirectory, `${entry.nbaPlayerId}.${extension}`);
      await writeFile(input, bytes);
      const cropY = entry.cropY ?? 0.5;
      const cropX = entry.cropX ?? 0.5;
      const scaledSize = Math.round(256 * (entry.zoom ?? 1));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", `scale=${scaledSize}:${scaledSize}:force_original_aspect_ratio=increase,crop=256:256:(in_w-256)*${cropX}:(in_h-256)*${cropY}`, "-frames:v", "1", "-c:v", "libwebp", "-q:v", "83", output]);
      portraitBytes = await readFile(output);
      entry.qualityStatus = "needs_review";
      await pause(1200);
    }
    entry.sha256 = createHash("sha256").update(portraitBytes).digest("hex");
    await saveManifest(manifest);
    await writeIdModule(entries);
    process.stderr.write(`${index + 1}/90 ${entry.name} (${entry.license})\n`);
  });
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

process.stdout.write(`Imported ${entries.length} independent WebP portraits and wrote attribution page.\n`);
