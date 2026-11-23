// Downloads verified full-resolution originals for the photos accepted during label review.
// Usage: node scripts/dataset/download-originals.mjs [assetsDir]

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchWithRetry, sleep } from './commons.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetsDir = resolve(process.argv[2] ?? join(appDir, '..', 'assets'));
const workDir = join(assetsDir, '_work');
const reviewDir = join(workDir, 'final-review');
const originalsDir = join(assetsDir, '_originals');
const progressPath = join(originalsDir, 'progress.json');

const PER_CLASS = 150;
const MIN_WIDTH = 3840;
const MIN_HEIGHT = 2160;
const WORKERS = 1;
const MAX_BYTES_PER_SECOND = 1024 * 1024;
const MIN_PAUSE_MS = 2000;
const SHUFFLE_SEED = 2026;

function seededShuffle(list, seed) {
  const items = [...list];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function loadAccepted() {
  const byClass = {};
  const seen = new Set();
  const files = (await readdir(reviewDir)).filter((f) => /^review-round\d+\.json$/.test(f)).sort();
  for (const file of files) {
    const review = JSON.parse(await readFile(join(reviewDir, file), 'utf8'));
    for (const [className, { work, accepted }] of Object.entries(review)) {
      const index = JSON.parse(await readFile(join(workDir, work, 'sheet-index.json'), 'utf8'))[className];
      const candidates = JSON.parse(await readFile(join(workDir, work, 'candidates.json'), 'utf8'));
      const byId = new Map(candidates.map((c) => [c.id, c]));
      byClass[className] ??= [];
      for (const position of accepted) {
        const item = byId.get(index[position]);
        if (!item || seen.has(item.sha1)) continue;
        seen.add(item.sha1);
        byClass[className].push(item);
      }
    }
  }
  return byClass;
}

async function fetchOriginal(item) {
  const path = join(originalsDir, item.className, `${item.id}.jpg`);
  const response = await fetchWithRetry(item.url);
  const data = Buffer.from(await response.arrayBuffer());
  const sha1 = createHash('sha1').update(data).digest('hex');
  if (sha1 !== item.sha1) throw new Error('checksum mismatch');

  const meta = await sharp(data).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) throw new Error(`too small after orientation: ${width}x${height}`);
  await sharp(data, { failOn: 'error' }).resize(16).raw().toBuffer();

  const partial = `${path}.part`;
  await writeFile(partial, data);
  await rename(partial, path);
  return { ok: true, width, height, bytes: data.length };
}

async function main() {
  const byClass = await loadAccepted();
  await mkdir(originalsDir, { recursive: true });
  const progress = existsSync(progressPath) ? JSON.parse(await readFile(progressPath, 'utf8')) : {};
  const save = () => writeFile(progressPath, JSON.stringify(progress));
  const selection = [];

  for (const [className, items] of Object.entries(byClass)) {
    await mkdir(join(originalsDir, className), { recursive: true });
    const ordered = seededShuffle(items, SHUFFLE_SEED);
    console.log(`${className}: ${ordered.length} accepted`);
    const isDone = (item) => progress[item.id]?.ok && existsSync(join(originalsDir, className, `${item.id}.jpg`));
    let okCount = ordered.filter(isDone).length;
    let cursor = 0;

    const worker = async () => {
      while (okCount < PER_CLASS && cursor < ordered.length) {
        const item = ordered[cursor++];
        if (isDone(item) || progress[item.id]?.error) continue;
        try {
          progress[item.id] = await fetchOriginal(item);
          okCount++;
          if (okCount % 10 === 0) console.log(`${className}: ${okCount}/${PER_CLASS}`);
        } catch (error) {
          await rm(join(originalsDir, className, `${item.id}.jpg.part`), { force: true });
          if (error.transient) throw error;
          progress[item.id] = { ok: false, error: error.message };
          console.log(`${className}: skipped ${item.id}: ${error.message}`);
        }
        await save();
        const bytes = progress[item.id]?.bytes ?? 0;
        await sleep(Math.max(MIN_PAUSE_MS, (bytes / MAX_BYTES_PER_SECOND) * 1000));
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));

    const finished = ordered.filter(isDone).slice(0, PER_CLASS);
    console.log(`${className}: finished with ${finished.length} verified originals`);
    selection.push(...finished.map((item) => ({ ...item, ...progress[item.id] })));
  }

  await writeFile(join(originalsDir, 'selection.json'), JSON.stringify(selection, null, 1));
  const totalBytes = selection.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`done: ${selection.length} images, ${(totalBytes / 1024 ** 3).toFixed(2)} GB`);
}

await main();
