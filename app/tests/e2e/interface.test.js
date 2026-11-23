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
const COLORS = { lake: '#2f7f9c', snowfield: '#eef3f6', starry_sky: '#10131f' };
const GROUPS = { '4k': [640, 360, 'jpg'], fullhd: [320, 180, 'jpg'], icons_32: [32, 32, 'png'] };
const PER_CLASS = 4;

async function createFixture(root) {
  const assets = join(root, 'assets');
  for (const [group, [width, height, extension]] of Object.entries(GROUPS)) {
    for (const [classId, background] of Object.entries(COLORS)) {
      const folder = join(assets, group, classId);
      await mkdir(folder, { recursive: true });
      for (let i = 0; i < PER_CLASS; i++) {
        const image = sharp({ create: { width, height, channels: 3, background } });
        await (extension === 'png' ? image.png() : image.jpeg()).toFile(join(folder, `${classId}_${i}.${extension}`));
      }
    }
  }
  await writeFile(join(assets, '4k', 'lake', 'broken.jpg'), 'not an image');
  await writeFile(join(assets, '4k', 'lake', 'notes.txt'), 'text');
  await mkdir(join(assets, '_work', 'lake'), { recursive: true });
  await writeFile(join(assets, '_work', 'lake', 'service.jpg'), 'service');
  await writeFile(join(root, 'bad.txt'), 'not an image');
  await writeFile(join(root, 'fake.png'), 'not an image');
  await writeFile(join(root, 'empty.jpg'), '');
  await sharp({ create: { width: 200, height: 100, channels: 3, background: '#336699' } }).png().toFile(join(root, 'photo.png'));
  return assets;
}

describe('interface', () => {
  let browser;
  let page;
  let root;
  let assets;
  const pageErrors = [];

  const shot = async (name) => {
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
  };

  before(async () => {
    await mkdir(join(appDir, '.cache'), { recursive: true });
    root = await mkdtemp(join(appDir, '.cache', 'e2e-'));
    assets = await createFixture(root);
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, colorScheme: 'light' });
    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(pageUrl);
  });

  after(async () => {
    await browser?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('opens from a local file with safe initial states', async () => {
    assert.equal(await page.title(), 'Розпізнавання пейзажів');
    assert.equal(await page.locator('h1').innerText(), 'Розпізнавання пейзажів');
    assert.equal(await page.locator('.brand p').count(), 0);
    assert.equal(await page.locator('#toTraining').isDisabled(), true);
    assert.match(await page.locator('#logList').innerText(), /Застосунок запущено/);
    assert.equal(await page.locator('#progressBar').getAttribute('aria-valuenow'), '0');
    await shot('01-start');
  });

  it('scans a folder, reports ignored and broken files and shows real progress', async () => {
    await page.locator('#folderInput').setInputFiles(assets);
    await page.locator('#progressCard[data-state="done"]').waitFor();
    assert.equal(await page.locator('#selTotal').innerText(), '36');
    assert.equal(await page.locator('#selClasses').innerText(), '3');
    assert.equal(await page.locator('#groupsBody tr').count(), 3);
    assert.equal(await page.locator('#progressBar').getAttribute('aria-valuenow'), '100');
    assert.match(await page.locator('#progressCount').innerText(), /37 із 37 зображень/);
    const status = await page.locator('#folderStatus').innerText();
    assert.match(status, /пошкоджених: 1/);
    assert.match(status, /службових: 1/);
    assert.equal(await page.locator('#cancelTask').isVisible(), false);
    assert.match(await page.locator('#logList').innerText(), /broken\.jpg/);
    assert.equal(await page.locator('#selectionMessage').getAttribute('data-level'), 'warn');
    await shot('02-data');
  });

  it('lets the user select the whole folder, one group or two groups', async () => {
    await page.locator('input[data-group="fullhd"]').uncheck();
    assert.equal(await page.locator('#selTotal').innerText(), '24');
    assert.equal(await page.locator('#allGroups').evaluate((box) => box.indeterminate), true);
    await page.locator('input[data-group="4k"]').uncheck();
    assert.equal(await page.locator('#selTotal').innerText(), '12');
    await page.locator('#allGroups').check();
    assert.equal(await page.locator('#selTotal').innerText(), '36');
    await page.locator('#allGroups').uncheck();
    assert.equal(await page.locator('#selTotal').innerText(), '0');
    assert.equal(await page.locator('#toTraining').isDisabled(), true);
    await page.locator('#allGroups').check();
  });

  it('filters by file format', async () => {
    await page.locator('input[data-format="png"]').uncheck();
    assert.equal(await page.locator('#selTotal').innerText(), '24');
    assert.equal(await page.locator('input[data-format="bmp"]').isDisabled(), true);
    await page.locator('input[data-format="png"]').check();
  });

  it('validates training parameters', async () => {
    await page.locator('#toTraining').click();
    assert.equal(await page.locator('#panel-train').isVisible(), true);
    assert.match(await page.locator('#trainDataset').innerText(), /36 зображень/);
    await page.locator('#learningRate').fill('0');
    await page.locator('#learningRate').blur();
    assert.match(await page.locator('#learningRate-error').innerText(), /від 0,0001 до 1/);
    await page.locator('#epochs').fill('1.5');
    assert.equal(await page.locator('#epochs').getAttribute('aria-invalid'), 'true');
    await shot('03-train-errors');
    await page.locator('#learningRate').fill('0.05');
    await page.locator('#epochs').fill('500');
    assert.equal(await page.locator('#learningRate-error').isVisible(), false);
    await page.locator('#gridSize').selectOption('16');
    assert.match(await page.locator('#networkSummary').innerText(), /256 входів/);
    await page.locator('#hiddenNeurons').fill('12');
    assert.match(await page.locator('#networkSummary').innerText(), /12 прихованих/);
    await page.locator('#hiddenNeurons').fill('0');
    await shot('04-train');
  });

  it('rejects invalid image files with a clear message', async () => {
    await page.locator('#tab-recognize').click();
    assert.equal(await page.locator('[data-save="png"]').isDisabled(), true);
    assert.equal(await page.locator('#infoButton svg').isVisible(), true);
    assert.match(await page.locator('#infoButton').innerText(), /Інформація про зображення/);
    for (const [file, pattern] of [
      ['bad.txt', /не підтримується/],
      ['empty.jpg', /порожній/],
      ['fake.png', /не відповідає/],
    ]) {
      await page.locator('#imageInput').setInputFiles(join(root, file));
      await page.locator('.toast[data-level="error"]', { hasText: pattern }).first().waitFor();
    }
    assert.equal(await page.locator('#imageCanvas').isVisible(), false);
    assert.equal(await page.locator('[data-save="png"]').isDisabled(), true);
  });

  it('loads an image, shows information and the grid', async () => {
    await page.locator('#imageInput').setInputFiles(join(root, 'photo.png'));
    await page.locator('#imageCanvas:not([hidden])').waitFor();
    assert.match(await page.locator('#imageCaption').innerText(), /200×100/);
    assert.equal(await page.locator('#dropPlaceholder').isVisible(), false);
    assert.equal(await page.locator('#progressRate').innerText(), '—');
    const shown = await page.locator('#imageCanvas').boundingBox();
    assert.ok(shown.width > 400, `small image is shown ${shown.width}px wide`);
    await page.locator('#infoButton').click();
    const info = await page.locator('#infoList').innerText();
    assert.match(info, /200 × 100 px/);
    assert.match(info, /Розширення файлу\s+\.png/);
    assert.match(info, /Розмір файлу/);
    assert.match(info, /PNG/);
    assert.match(info, /2:1/);
    await shot('05-info');
    await page.locator('#closeInfo').click();
    const before = await page.locator('#imageCanvas').evaluate((c) => c.toDataURL());
    await page.locator('#showGrid').check();
    const after = await page.locator('#imageCanvas').evaluate((c) => c.toDataURL());
    assert.notEqual(before, after);
    await shot('06-recognize');
  });

  it('saves the result in PNG, JPG and BMP', async () => {
    for (const format of ['png', 'jpg', 'bmp']) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-save="${format}"]`).click()]);
      assert.equal(download.suggestedFilename(), `photo_grid16.${format}`);
      const data = await readFile(await download.path());
      const header = parseImageHeader(new Uint8Array(data));
      assert.equal(header.format, format);
      assert.equal(header.width, 200);
      assert.equal(header.height, 100);
    }
    assert.match(await page.locator('#logList').innerText(), /photo_grid16\.bmp/);
  });

  it('exports the operation log to a file', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveLog').click()]);
    assert.match(download.suggestedFilename(), /^журнал-операцій-.*\.log$/);
    const text = await readFile(await download.path(), 'utf8');
    assert.match(text, /\[SUCCESS\] Збережено photo_grid16\.png/);
  });

  it('clears the image and disables dependent controls', async () => {
    await page.locator('#clearImage').click();
    assert.equal(await page.locator('#imageCanvas').isVisible(), false);
    assert.equal(await page.locator('#dropPlaceholder').isVisible(), true);
    assert.equal(await page.locator('[data-save="bmp"]').isDisabled(), true);
    assert.equal(await page.locator('#infoButton').isDisabled(), true);
  });

  it('gives every control a clear name', async () => {
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select')]
        .filter((control) => {
          const text = control.tagName === 'BUTTON' ? control.textContent : '';
          const name = control.getAttribute('aria-label') || control.labels?.[0]?.textContent || text;
          return !name.trim();
        })
        .map((control) => control.id || control.outerHTML.slice(0, 80)),
    );
    assert.deepEqual(unnamed, []);
  });

  it('fits a phone screen without horizontal page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of ['data', 'train', 'recognize']) {
      await page.locator(`#tab-${tab}`).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${tab} overflows by ${overflow}px`);
      await shot(`07-phone-${tab}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  it('produced no uncaught page errors', () => {
    assert.deepEqual(pageErrors, []);
  });
});
