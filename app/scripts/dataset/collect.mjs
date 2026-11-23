// Collects candidate photos per class and downloads small thumbnails for label review.
// Usage: node scripts/dataset/collect.mjs <workDir> <classes.json>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchWithRetry, isFreeLicense, searchFiles, sleep } from './commons.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workDir = resolve(process.argv[2] ?? join(appDir, '..', 'assets', '_work'));
const configPath = resolve(process.argv[3] ?? join(appDir, 'scripts', 'dataset', 'classes.json'));
const {
  targetPerClass: TARGET_PER_CLASS,
  pagesPerQuery: PAGES_PER_QUERY,
  queries: QUERIES,
  excludeCandidates: EXCLUDE_CANDIDATES = [],
} = JSON.parse(await readFile(configPath, 'utf8'));

const MAX_PER_AUTHOR = 8;
const MAX_PER_SERIES = 2;
const MAX_BYTES = 40 * 1024 * 1024;
const NEAR_DUPLICATE_BITS = 5;
const BASE_FILTER = 'filemime:image/jpeg filew:>3839 fileh:>2159';

const NOISE_TITLE = new RegExp(
  [
    'map', 'diagram', 'chart', 'plate', 'book', 'scan', 'page', 'herbarium', 'painting', 'drawing',
    'poster', 'stamp', 'satellite', 'iss[- ]?\\d', 'nasa', 'landsat', 'sentinel', 'aerial', 'drone',
    'panorama', 'pano', 'farm grasses', 'portrait', 'museum', 'church', 'castle', 'cathedral',
    'ship', 'boat', 'cow', 'horse', 'camel', 'sheep', 'pyramid', 'bird', 'flower',
    'gogh', 'etching', 'engraving', 'lithograph', 'illustration', 'nebula', 'concert', 'singer',
    'temple', 'monastery', 'hotel', 'statue', 'fox', 'bear', 'deer', 'wolf', 'seal', 'penguin',
    'aircraft', 'airplane', 'plane', 'helicopter', 'locomotive', 'train', 'observatory', 'telescope',
    'antenna', 'chicken', 'turkey', 'eagle', 'moon',
  ].map((word) => `\\b${word}s?\\b`).join('|'),
  'i',
);

const normalize = (text) =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const seriesKey = (title) =>
  normalize(title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\d_\-.,]+/g, ' ')
    .replace(/\b[a-z]\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function isUsable(file) {
  const aspect = file.width / file.height;
  return (
    file.thumbUrl &&
    aspect >= 1.25 &&
    aspect <= 2.0 &&
    file.bytes <= MAX_BYTES &&
    isFreeLicense(file.license) &&
    !NOISE_TITLE.test(file.title.replace(/^File:/, '').replace(/[_-]/g, ' '))
  );
}

async function gatherQuery(query) {
  const files = [];
  let offset = 0;
  for (let page = 0; page < PAGES_PER_QUERY && offset !== null; page++) {
    const result = await searchFiles(`${query} ${BASE_FILTER}`, { offset });
    files.push(...result.files.filter(isUsable));
    offset = result.nextOffset;
    await sleep(1200);
  }
  return files;
}

function roundRobin(perQuery, className, used) {
  const authors = new Map();
  const series = new Map();
  const picked = [];
  const cursors = perQuery.map(() => 0);
  let progressed = true;
  while (picked.length < TARGET_PER_CLASS && progressed) {
    progressed = false;
    for (let q = 0; q < perQuery.length && picked.length < TARGET_PER_CLASS; q++) {
      while (cursors[q] < perQuery[q].length) {
        const file = perQuery[q][cursors[q]++];
        const author = normalize(file.author);
        const key = seriesKey(file.title);
        if (used.has(file.sha1)) continue;
        if ((authors.get(author) ?? 0) >= MAX_PER_AUTHOR) continue;
        if ((series.get(key) ?? 0) >= MAX_PER_SERIES) continue;
        used.add(file.sha1);
        authors.set(author, (authors.get(author) ?? 0) + 1);
        series.set(key, (series.get(key) ?? 0) + 1);
        picked.push({ ...file, id: `${className}_${file.sha1.slice(0, 10)}`, className, series: key });
        progressed = true;
        break;
      }
    }
  }
  return picked;
}

async function differenceHash(path) {
  const pixels = await sharp(path).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return hash;
}

function hamming(a, b) {
  let value = a ^ b;
  let bits = 0;
  while (value) {
    value &= value - 1n;
    bits++;
  }
  return bits;
}

async function downloadThumbs(items) {
  let done = 0;
  const failed = new Set();
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      const path = join(workDir, 'thumbs', item.className, `${item.id}.jpg`);
      try {
        if (!existsSync(path)) {
          const response = await fetchWithRetry(item.thumbUrl);
          const data = Buffer.from(await response.arrayBuffer());
          await sharp(data).metadata();
          await writeFile(path, data);
          await sleep(350);
        }
      } catch (error) {
        failed.add(item.id);
        console.log(`thumb failed: ${item.id}: ${error.message}`);
      }
      if (++done % 50 === 0) console.log(`thumbnails ${done}/${items.length}`);
    }
  };
  await Promise.all([worker(), worker()]);
  return failed;
}

async function main() {
  await mkdir(workDir, { recursive: true });
  const rawPath = join(workDir, 'search-results.json');
  let raw = existsSync(rawPath) ? JSON.parse(await readFile(rawPath, 'utf8')) : {};

  for (const [className, queries] of Object.entries(QUERIES)) {
    raw[className] ??= {};
    for (const query of queries) {
      if (raw[className][query]) continue;
      try {
        raw[className][query] = await gatherQuery(query);
        console.log(`${className} | ${query}: ${raw[className][query].length} usable`);
        await writeFile(rawPath, JSON.stringify(raw));
      } catch (error) {
        console.log(`${className} | ${query}: skipped (${error.message})`);
      }
    }
  }

  const used = new Set();
  for (const path of EXCLUDE_CANDIDATES) {
    for (const item of JSON.parse(await readFile(path, 'utf8'))) used.add(item.sha1);
  }
  const candidates = [];
  for (const className of Object.keys(QUERIES)) {
    const picked = roundRobin(Object.values(raw[className]), className, used);
    await mkdir(join(workDir, 'thumbs', className), { recursive: true });
    console.log(`${className}: ${picked.length} candidates`);
    candidates.push(...picked);
  }

  const failed = await downloadThumbs(candidates);
  const hashed = [];
  let duplicates = 0;
  for (const item of candidates) {
    if (failed.has(item.id)) continue;
    const hash = await differenceHash(join(workDir, 'thumbs', item.className, `${item.id}.jpg`));
    if (hashed.some((other) => hamming(other.hash, hash) <= NEAR_DUPLICATE_BITS)) {
      duplicates++;
      continue;
    }
    hashed.push({ item, hash });
  }

  const final = hashed.map(({ item }) => item);
  await writeFile(join(workDir, 'candidates.json'), JSON.stringify(final, null, 1));
  const counts = Object.keys(QUERIES).map((c) => `${c}=${final.filter((f) => f.className === c).length}`);
  console.log(`done: ${counts.join(' ')} | near-duplicates removed: ${duplicates} | failed: ${failed.size}`);
}

await main();
