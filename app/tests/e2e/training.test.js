import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { parseImageHeader } from '../../src/core/imageHeader.js';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pageUrl = pathToFileURL(join(appDir, 'dist', 'index.html')).href;
const screenshotDir = process.env.E2E_SCREENSHOTS;
const PER_CLASS = 14;
const [WIDTH, HEIGHT] = [240, 180];
const LONG_TIMEOUT = 60000;

// Synthetic classes with different brightness layouts.
const PATTERNS = {
  lake: (x, y, shift) => (y < HEIGHT / 2 ? 170 + shift : 60 + shift),
  snowfield: (x, y, shift) => 225 + shift,
  starry_sky: (x, y, shift) => 18 + shift,
};

function patternImage(classId, shift) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const value = PATTERNS[classId](x, y, shift);
      pixels.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
}

describe('training and recognition', () => {
  let browser;
  let page;
  let root;
  let modelPath;
  const pageErrors = [];

  const shot = async (name) => {
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
  };

  const openDataset = async () => {
    await page.locator('#folderInput').setInputFiles(join(root, 'assets'));
    await page.locator('#progressCard[data-state="done"]').waitFor();
    await page.locator('#toTraining').click();
  };

  const download = async (selector) => {
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
    return { name: file.suggestedFilename(), path: await file.path() };
  };

  const shares = () =>
    page.locator('#classResults .class-result-value').evaluateAll((nodes) =>
      nodes.map((node) => Number(node.textContent.replace('%', '').replace(',', '.'))),
    );

  before(async () => {
    await mkdir(join(appDir, '.cache'), { recursive: true });
    root = await mkdtemp(join(appDir, '.cache', 'e2e-training-'));
    for (const classId of Object.keys(PATTERNS)) {
      const folder = join(root, 'assets', 'medium', classId);
      await mkdir(folder, { recursive: true });
      for (let i = 0; i < PER_CLASS; i++) {
        await patternImage(classId, i).png().toFile(join(folder, `${classId}_${i}.png`));
      }
    }
    await patternImage('snowfield', 3).png().toFile(join(root, 'snow.png'));
    await sharp({ create: { width: 3, height: 3, channels: 3, background: '#808080' } }).png().toFile(join(root, 'tiny.png'));
    await writeFile(join(root, 'bad-model.json'), '{"format":"other"}');
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: 'light' });
    page = await context.newPage();
    page.setDefaultTimeout(LONG_TIMEOUT);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(pageUrl);
    await openDataset();
  });

  after(async () => {
    await browser?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('keeps training disabled for invalid parameters', async () => {
    assert.equal(await page.locator('#startTraining').isEnabled(), true);
    await page.locator('#epochs').fill('0');
    assert.equal(await page.locator('#startTraining').isDisabled(), true);
    await page.locator('#epochs').fill('300');
    await page.locator('#learningRate').fill('0.3');
    await page.locator('#gridSize').selectOption('4');
    assert.equal(await page.locator('#startTraining').isEnabled(), true);
  });

  it('trains with real epoch progress, a chart and a run record', async () => {
    await page.locator('#startTraining').click();
    await page.locator('#runsBody tr').first().waitFor();
    await page.locator('#progressCard[data-state="done"]').waitFor();
    assert.match(await page.locator('#progressCount').innerText(), /300 із 300 епох · 100%/);
    assert.equal(await page.locator('#progressBar').getAttribute('aria-valuenow'), '100');
    assert.equal(await page.locator('#errorChart').isVisible(), true);
    assert.ok((await page.locator('#errorChart path.chart-line').getAttribute('d')).length > 50);

    const row = await page.locator('#runsBody tr').first().innerText();
    assert.match(row, /4×4/);
    assert.match(row, /100,0%/);
    const hiddenWidth = await page.locator('#runsWrap').evaluate((node) => node.scrollWidth - node.clientWidth);
    assert.ok(hiddenWidth <= 0, `run history hides ${hiddenWidth}px behind scrolling`);
    assert.equal(await page.locator('#resultValidation').innerText(), '100,0%');
    assert.match(await page.locator('#resultNote').innerText(), /Тестова частина \(6 зображень\)/);

    const logText = await page.locator('#logList').innerText();
    assert.match(logText, /навчання 30, перевірка 6, відкладено для тесту 6/);
    assert.match(logText, /Навчання завершено/);
    await shot('10-trained');
  });

  it('shows chart values as a table and supports the keyboard', async () => {
    await page.locator('#errorChart summary').click();
    assert.ok((await page.locator('#errorChart tbody tr').count()) > 10);
    await page.locator('#errorChart svg').focus();
    await page.keyboard.press('Home');
    assert.match(await page.locator('.chart-tooltip').innerText(), /Епоха 1/);
    await page.locator('#errorChart summary').click();
    await page.locator('#trainForm h3').click();
  });

  it('reuses features on the next run', async () => {
    await page.locator('#epochs').fill('20');
    await page.locator('#startTraining').click();
    await page.locator('#runsBody tr:nth-child(2)').waitFor();
    assert.match(await page.locator('#runsBody tr').first().innerText(), /з памʼяті/);
    await page.locator('#progressCard[data-state="done"]').waitFor();
  });

  it('stops training and keeps the partly trained model', async () => {
    await page.locator('#epochs').fill('10000');
    await page.locator('#gridSize').selectOption('32');
    await page.locator('#hiddenNeurons').fill('64');
    await page.locator('#startTraining').click();
    await page.waitForFunction(() => /[1-9][\d\s]* із 10\s000 епох/.test(document.querySelector('#progressCount').textContent));
    assert.equal(await page.locator('#epochs').isDisabled(), true);
    await page.locator('#stopTraining').click();
    await page.locator('#progressCard[data-state="cancelled"]').waitFor();
    assert.match(await page.locator('#progressTitle').innerText(), /Навчання зупинено/);
    assert.match(await page.locator('#runsBody tr').first().innerText(), /із 10\s000/);
    assert.equal(await page.locator('#startTraining').isEnabled(), true);
    await page.locator('#hiddenNeurons').fill('0');
    await page.locator('#gridSize').selectOption('4');
    await page.locator('#epochs').fill('300');
    await page.locator('#startTraining').click();
    await page.locator('#runsBody tr:nth-child(4)').waitFor();
    await page.locator('#progressCard[data-state="done"]').waitFor();
  });

  it('saves run results in CSV and JSON', async () => {
    const csv = await download('#saveRunsCsv');
    assert.equal(csv.name, 'результати-навчання.csv');
    const text = await readFile(csv.path, 'utf8');
    assert.ok(text.startsWith('﻿Запуск;'));
    assert.equal(text.trim().split('\r\n').length, 5);
    const json = await download('#saveRunsJson');
    const data = JSON.parse(await readFile(json.path, 'utf8'));
    assert.equal(data.runs.length, 4);
    assert.ok(data.runs[0].history.length > 0);
  });

  it('recognizes an image and saves the picture and the result', async () => {
    await page.locator('#tab-recognize').click();
    await page.locator('#imageInput').setInputFiles(join(root, 'snow.png'));
    await page.locator('#classResults li[data-best="true"]', { hasText: 'Снігова рівнина' }).waitFor();
    const values = await shares();
    assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) < 0.5, values.join());
    assert.match(await page.locator('#recognitionSummary').innerText(), /Найімовірніше: Снігова рівнина/);
    await shot('11-recognized');

    for (const format of ['png', 'jpg', 'bmp']) {
      const file = await download(`[data-save="${format}"]`);
      const header = parseImageHeader(new Uint8Array(await readFile(file.path)));
      assert.equal(header.format, format);
      assert.equal(header.width, WIDTH);
    }
    const json = JSON.parse(await readFile((await download('#saveResultJson')).path, 'utf8'));
    assert.equal(json.predicted, 'snowfield');
    assert.ok(Math.abs(Object.values(json.shares).reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
    const csv = await readFile((await download('#saveResultCsv')).path, 'utf8');
    assert.match(csv, /Снігова рівнина/);
  });

  it('reports an image smaller than the model grid', async () => {
    await page.locator('#imageInput').setInputFiles(join(root, 'tiny.png'));
    await page.locator('#recognitionSummary', { hasText: 'менше за сітку' }).waitFor();
    assert.equal(await page.locator('#saveResultJson').isDisabled(), true);
  });

  it('saves the model and gives the same answer after a reload', async () => {
    await page.locator('#imageInput').setInputFiles(join(root, 'snow.png'));
    await page.locator('#classResults li[data-best="true"]', { hasText: 'Снігова рівнина' }).waitFor();
    const before = await shares();
    await page.locator('#tab-train').click();
    const saved = await download('#saveModel');
    assert.match(saved.name, /^модель_сітка4_епох300\.json$/);
    modelPath = join(root, 'saved-model.json');
    await writeFile(modelPath, await readFile(saved.path));

    await page.reload();
    await page.locator('#tab-train').click();
    await page.locator('#modelInput').setInputFiles(join(root, 'bad-model.json'));
    await page.locator('.toast[data-level="error"]', { hasText: 'не файл моделі' }).waitFor();
    assert.equal(await page.locator('#saveModel').isDisabled(), true);

    await page.locator('#modelInput').setInputFiles(modelPath);
    await page.locator('#resultBody:not([hidden])').waitFor();
    assert.match(await page.locator('#resultNote').innerText(), /saved-model\.json/);
    await page.locator('#tab-recognize').click();
    await page.locator('#imageInput').setInputFiles(join(root, 'snow.png'));
    await page.locator('#classResults li[data-best="true"]', { hasText: 'Снігова рівнина' }).waitFor();
    assert.deepEqual(await shares(), before);
  });

  it('suggests a safe learning rate for large grids', async () => {
    await page.reload();
    await page.locator('#tab-train').click();
    await page.locator('#gridSize').selectOption('32');
    assert.equal(await page.locator('#learningRate').inputValue(), '0.00078');
    assert.equal(await page.locator('#learningRate-warning').isVisible(), false);
    await page.locator('#learningRate').fill('0.3');
    assert.equal(await page.locator('#learningRate-warning').isVisible(), true);
    assert.match(await page.locator('#learningRate-warning').innerText(), /Рекомендовано 0,00078/);
    await page.locator('#gridSize').selectOption('16');
    assert.equal(await page.locator('#learningRate').inputValue(), '0.3');
    await page.locator('#applyRate').click();
    assert.equal(await page.locator('#learningRate').inputValue(), '0.0031');
    assert.equal(await page.locator('#learningRate-warning').isVisible(), false);
    await page.locator('#gridSize').selectOption('8');
    assert.equal(await page.locator('#learningRate').inputValue(), '0.013');
  });

  it('trains, recognizes and reloads a model with 8 bits per cell', async () => {
    await page.locator('#tab-data').click();
    await openDataset();
    await page.locator('#gridSize').selectOption('4');
    assert.match(await page.locator('#networkSummary').innerText(), /16 входів → 8 прихованих → 3 виходи/);
    await page.locator('#encoding').selectOption('bits');
    assert.match(await page.locator('#networkSummary').innerText(), /128 входів → 8 прихованих → 3 виходи/);
    assert.equal(await page.locator('#learningRate').inputValue(), '0.5');
    await page.locator('#epochs').fill('150');
    await page.locator('#startTraining').click();
    await page.locator('#runsBody tr', { hasText: '8 бітів' }).waitFor();
    await page.locator('#progressCard[data-state="done"]').waitFor();
    assert.match(await page.locator('#resultNote').innerText(), /8 бітів на клітинку/);
    assert.match(await page.locator('#logList').innerText(), /з памʼяті|обчислено/);

    await page.locator('#tab-recognize').click();
    await page.locator('#imageInput').setInputFiles(join(root, 'snow.png'));
    await page.locator('#classResults li[data-best="true"]', { hasText: 'Снігова рівнина' }).waitFor();
    const before = await shares();
    const result = JSON.parse(await readFile((await download('#saveResultJson')).path, 'utf8'));
    assert.equal(result.encoding, 'bits');

    await page.locator('#tab-train').click();
    const saved = await download('#saveModel');
    const bitsModel = join(root, 'bits-model.json');
    await writeFile(bitsModel, await readFile(saved.path));
    assert.equal(JSON.parse(await readFile(bitsModel, 'utf8')).encoding, 'bits');

    await page.reload();
    await page.locator('#tab-train').click();
    assert.equal(await page.locator('#encoding').inputValue(), 'number');
    await page.locator('#modelInput').setInputFiles(bitsModel);
    await page.locator('#resultBody:not([hidden])').waitFor();
    assert.equal(await page.locator('#encoding').inputValue(), 'bits');
    await page.locator('#tab-recognize').click();
    await page.locator('#imageInput').setInputFiles(join(root, 'snow.png'));
    await page.locator('#classResults li[data-best="true"]', { hasText: 'Снігова рівнина' }).waitFor();
    assert.deepEqual(await shares(), before);
  });

  it('fits a phone screen after training', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#tab-train').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `train panel overflows by ${overflow}px`);
    await shot('12-phone-train');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  it('produced no uncaught page errors', () => {
    assert.deepEqual(pageErrors, []);
  });
});
