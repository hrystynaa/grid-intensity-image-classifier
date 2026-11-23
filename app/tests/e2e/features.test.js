import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { appDir, bundle, workerDefines } from '../../scripts/bundle.mjs';
import { encodeBmp } from '../../src/core/bmp.js';
import { extractCellMeans } from '../../src/core/features.js';

const CELLS = 8;
const EXACT = 1e-6;
const JPEG_TOLERANCE = 0.012;
const BLEND_TOLERANCE = 2 / 255;

function gradient(width, height, channels = 4) {
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      pixels[offset] = Math.round((x / (width - 1)) * 255);
      pixels[offset + 1] = Math.round((y / (height - 1)) * 255);
      pixels[offset + 2] = (x * 3 + y * 7) % 256;
      if (channels === 4) pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

async function referenceMeans(image) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { means: extractCellMeans(new Uint8Array(data), info.width, info.height, CELLS), width: info.width, height: info.height };
}

describe('feature workers', () => {
  let browser;
  let page;
  let root;
  const pageErrors = [];
  const references = {};

  before(async () => {
    await mkdir(join(appDir, '.cache'), { recursive: true });
    root = await mkdtemp(join(appDir, '.cache', 'e2e-features-'));

    const [width, height] = [97, 61];
    const raw = { raw: { width, height, channels: 4 } };
    const pixels = gradient(width, height);
    const write = (name, data) => writeFile(join(root, name), data);

    await sharp(pixels, raw).png().toFile(join(root, 'gradient.png'));
    references['gradient.png'] = { ...(await referenceMeans(sharp(pixels, raw))), tolerance: EXACT };

    await write('gradient.bmp', encodeBmp(new Uint8Array(pixels), width, height));
    references['gradient.bmp'] = { ...references['gradient.png'] };

    await sharp(pixels, raw).jpeg({ quality: 95 }).toFile(join(root, 'photo.jpg'));
    references['photo.jpg'] = { ...(await referenceMeans(sharp(join(root, 'photo.jpg')))), tolerance: JPEG_TOLERANCE };

    await sharp(pixels, raw).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toFile(join(root, 'rotated.jpg'));
    references['rotated.jpg'] = { ...(await referenceMeans(sharp(join(root, 'rotated.jpg')).rotate())), tolerance: JPEG_TOLERANCE };

    const translucent = Buffer.from(pixels);
    for (let offset = 3; offset < translucent.length; offset += 4) translucent[offset] = 128;
    await sharp(translucent, raw).png().toFile(join(root, 'transparent.png'));
    references['transparent.png'] = {
      ...(await referenceMeans(sharp(join(root, 'transparent.png')).flatten({ background: '#ffffff' }))),
      tolerance: BLEND_TOLERANCE,
    };

    await write('broken.jpg', 'not an image');
    await sharp(gradient(4, 4), { raw: { width: 4, height: 4, channels: 4 } }).png().toFile(join(root, 'tiny.png'));

    const poolPath = join(appDir, 'src', 'workers', 'featurePool.js').replaceAll('\\', '/');
    const harnessEntry = join(root, 'harness.js');
    await writeFile(
      harnessEntry,
      `import { createFeatureExtractor } from ${JSON.stringify(poolPath)};
      window.runExtraction = async (size, cells) => {
        const files = [...document.querySelector('#files').files];
        const extractor = createFeatureExtractor({ size });
        const steps = [];
        const results = await extractor.extract(files.map((file) => ({ file })), cells, { onProgress: (done) => steps.push(done) });
        extractor.dispose();
        return {
          steps,
          names: files.map((file) => file.name),
          results: results.map((result) => ({ ...result, isFloat32: result.means instanceof Float32Array, means: result.means ? [...result.means] : null })),
        };
      };`,
    );
    const script = await bundle(harnessEntry, { format: 'iife', define: await workerDefines() });
    const harnessPage = join(root, 'harness.html');
    await writeFile(harnessPage, `<!doctype html><meta charset="utf-8"><input id="files" type="file" multiple><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(pathToFileURL(harnessPage).href);
    await page.locator('#files').setInputFiles(
      [...Object.keys(references), 'broken.jpg', 'tiny.png'].map((name) => join(root, name)),
    );
  });

  after(async () => {
    await browser?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  const byName = ({ names, results }) => Object.fromEntries(names.map((name, index) => [name, results[index]]));

  it('matches reference means for PNG, BMP, JPG, EXIF rotation and transparency', async () => {
    const output = await page.evaluate(([size, cells]) => window.runExtraction(size, cells), [4, CELLS]);
    const results = byName(output);
    for (const [name, reference] of Object.entries(references)) {
      const result = results[name];
      assert.equal(result.ok, true, `${name}: ${result.reason} ${result.error ?? ''}`);
      assert.equal(result.isFloat32, true, name);
      assert.equal(result.width, reference.width, `${name} width`);
      assert.equal(result.height, reference.height, `${name} height`);
      const worst = Math.max(...result.means.map((value, index) => Math.abs(value - reference.means[index])));
      assert.ok(worst <= reference.tolerance, `${name}: largest difference ${worst}`);
    }
  });

  it('reports broken and too small images without stopping', async () => {
    const output = await page.evaluate(([size, cells]) => window.runExtraction(size, cells), [2, CELLS]);
    const results = byName(output);
    assert.equal(results['broken.jpg'].reason, 'decode');
    assert.equal(results['tiny.png'].reason, 'tooSmall');
    assert.deepEqual(output.steps, output.names.map((_, index) => index + 1));
  });

  it('gives identical features with one worker and with several', async () => {
    const one = await page.evaluate(([size, cells]) => window.runExtraction(size, cells), [1, CELLS]);
    const many = await page.evaluate(([size, cells]) => window.runExtraction(size, cells), [4, CELLS]);
    assert.deepEqual(one.results.map((result) => result.means), many.results.map((result) => result.means));
  });

  it('produced no uncaught page errors', () => {
    assert.deepEqual(pageErrors, []);
  });
});
