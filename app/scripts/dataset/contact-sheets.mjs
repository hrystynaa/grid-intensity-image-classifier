// Renders numbered contact sheets so class labels can be reviewed by eye.
// Usage: node scripts/dataset/contact-sheets.mjs <workDir>

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workDir = resolve(process.argv[2] ?? join(appDir, '..', 'assets', '_work'));
const sheetsDir = join(workDir, 'sheets');

const COLUMNS = 10;
const ROWS = 6;
const CELL_WIDTH = 150;
const CELL_HEIGHT = 100;
const GAP = 4;

const label = (text) =>
  Buffer.from(
    `<svg width="44" height="20"><rect width="44" height="20" fill="black"/>` +
      `<text x="22" y="15" font-family="Arial" font-size="15" font-weight="bold" fill="#ffff00" text-anchor="middle">${text}</text></svg>`,
  );

async function renderSheet(items, startIndex, path) {
  const width = COLUMNS * (CELL_WIDTH + GAP) + GAP;
  const height = Math.ceil(items.length / COLUMNS) * (CELL_HEIGHT + GAP) + GAP;
  const layers = [];
  for (let i = 0; i < items.length; i++) {
    const left = GAP + (i % COLUMNS) * (CELL_WIDTH + GAP);
    const top = GAP + Math.floor(i / COLUMNS) * (CELL_HEIGHT + GAP);
    const thumb = join(workDir, 'thumbs', items[i].className, `${items[i].id}.jpg`);
    const input = await sharp(thumb).resize(CELL_WIDTH, CELL_HEIGHT, { fit: 'cover' }).toBuffer();
    layers.push({ input, left, top }, { input: label(startIndex + i), left, top });
  }
  await sharp({ create: { width, height, channels: 3, background: '#333333' } })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toFile(path);
}

const candidates = JSON.parse(await readFile(join(workDir, 'candidates.json'), 'utf8'));
await rm(sheetsDir, { recursive: true, force: true });
await mkdir(sheetsDir, { recursive: true });

const index = {};
for (const className of [...new Set(candidates.map((c) => c.className))]) {
  const items = candidates.filter((c) => c.className === className);
  index[className] = items.map((c) => c.id);
  const perSheet = COLUMNS * ROWS;
  for (let s = 0; s * perSheet < items.length; s++) {
    const name = `${className}_${String(s + 1).padStart(2, '0')}.jpg`;
    await renderSheet(items.slice(s * perSheet, (s + 1) * perSheet), s * perSheet, join(sheetsDir, name));
    console.log(name);
  }
}
await writeFile(join(workDir, 'sheet-index.json'), JSON.stringify(index));
