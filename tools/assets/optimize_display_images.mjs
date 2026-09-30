import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Uses an existing Sharp installation; this tool does not install project dependencies.
const require = createRequire(import.meta.url);
const moduleFlag = process.argv.indexOf('--sharp-module');
const sharp = require(moduleFlag >= 0 ? resolve(process.argv[moduleFlag + 1]) : 'sharp');
const originalRoot = resolve('tools/assets/image-sources');
await mkdir(originalRoot, { recursive: true });
const originals = ['expansion-logos/seattle-default.png', 'expansion-logos/las-vegas-default.png', 'story/season-opening-portrait.png'];
for (const file of originals) {
  const saved = resolve(originalRoot, file);
  await mkdir(dirname(saved), { recursive: true });
  try { await stat(saved); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(resolve('public', file), saved);
  }
}
const jobs = [
  { source: 'public/branding/home-logo-cutout.png', output: 'public/branding/home-logo-display.webp', width: 660, format: 'webp' },
  { source: 'public/branding/home-logo-cutout.png', output: 'public/branding/favicon.png', width: 64, format: 'png' },
  ...['seattle-default.png', 'las-vegas-default.png'].map(name => ({ source: `tools/assets/image-sources/expansion-logos/${name}`, output: `public/expansion-logos/${name}`, width: 256, format: 'png', palette: true })),
  { source: 'tools/assets/image-sources/story/season-opening-portrait.png', output: 'public/story/season-opening-portrait.webp', width: 891, format: 'webp' },
];
const report = [];
for (const job of jobs) {
  let image = sharp(job.source).rotate().resize({ width: job.width, withoutEnlargement: true });
  image = job.format === 'webp' ? image.webp({ quality: 88, alphaQuality: 100, effort: 6 }) : image.png({ compressionLevel: 9, ...(job.palette ? { palette: true, colours: 256, quality: 95, effort: 10 } : {}) });
  await image.toFile(job.output);
  const source = await readFile(job.source);
  const output = await readFile(job.output);
  const metadata = await sharp(job.output).metadata();
  report.push({ ...job, originalBytes: source.length, bytes: output.length, height: metadata.height, hasAlpha: metadata.hasAlpha, sha256: createHash('sha256').update(output).digest('hex') });
}
await mkdir('reports/image-loading/2026-09-30', { recursive: true });
await writeFile('reports/image-loading/2026-09-30/assets.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.map(({ output, originalBytes, bytes, width, height }) => ({ output, originalBytes, bytes, width, height })), null, 2));
