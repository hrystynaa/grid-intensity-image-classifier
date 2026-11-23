import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeBmp } from '../../src/core/bmp.js';
import {
  buildDataset,
  filterEntries,
  parseDatasetPath,
  scanEntries,
  selectionStatus,
  summarizeGroups,
  summarizeSelection,
} from '../../src/core/dataset.js';
import { formatAspectRatio, formatBytes, formatDuration, formatImages, pluralUk } from '../../src/core/format.js';
import { cellBoundaries } from '../../src/core/gridLayout.js';
import { parseImageHeader, readFileHeader } from '../../src/core/imageHeader.js';
import { createOperationLog } from '../../src/core/operationLog.js';
import { computeProgress } from '../../src/core/progress.js';
import { isRateTooHigh, recommendedLearningRate, validateTrainingParams } from '../../src/core/validation.js';

const png = (width, height, colorType = 2) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = colorType;
  return bytes;
};

const jpeg = (width, height, padding = 0) => {
  const app = [0xff, 0xe1, ((padding + 2) >> 8) & 255, (padding + 2) & 255, ...new Array(padding).fill(0xaa)];
  const frame = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app, ...frame, 0xff, 0xda, 0, 2]);
};

const fileAt = (path, bytes = png(4, 4)) => {
  const file = new File([bytes], path.split('/').at(-1));
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

describe('format', () => {
  it('formats byte sizes', () => {
    assert.equal(formatBytes(512), '512 Б');
    assert.equal(formatBytes(1536), '1,50 КБ');
    assert.equal(formatBytes(1024 ** 3), '1,00 ГБ');
    assert.equal(formatBytes(-1), '—');
  });

  it('formats durations across unit boundaries', () => {
    assert.equal(formatDuration(850), '850 мс');
    assert.equal(formatDuration(1200), '1,2 с');
    assert.equal(formatDuration(59960), '1 хв 00 с');
    assert.equal(formatDuration(125000), '2 хв 05 с');
    assert.equal(formatDuration(3720000), '1 год 02 хв');
    assert.equal(formatDuration(null), '—');
  });

  it('uses correct Ukrainian plural forms', () => {
    const form = (count) => pluralUk(count, 'файл', 'файли', 'файлів');
    assert.deepEqual([1, 2, 4, 5, 11, 14, 21, 22, 25, 101, 112].map(form), [
      'файл', 'файли', 'файли', 'файлів', 'файлів', 'файлів', 'файл', 'файли', 'файлів', 'файл', 'файлів',
    ]);
    assert.equal(formatImages(1), '1 зображення');
    assert.equal(formatImages(36), '36 зображень');
  });

  it('reduces simple aspect ratios', () => {
    assert.equal(formatAspectRatio(3840, 2160), '16:9');
    assert.equal(formatAspectRatio(32, 32), '1:1');
    assert.equal(formatAspectRatio(3001, 2000), '1,50:1');
  });
});

describe('grid layout', () => {
  it('splits sizes that are not divisible by the grid without gaps', () => {
    const boundaries = cellBoundaries(10, 3);
    assert.deepEqual(boundaries, [0, 3, 6, 10]);
    assert.equal(boundaries.at(-1), 10);
  });

  it('keeps every cell non-empty when the side is at least the grid size', () => {
    const boundaries = cellBoundaries(32, 32);
    assert.ok(boundaries.slice(1).every((value, index) => value > boundaries[index]));
  });
});

describe('image headers', () => {
  it('reads PNG dimensions and channels', () => {
    assert.deepEqual(parseImageHeader(png(640, 480, 6)), { format: 'png', width: 640, height: 480, channels: 4 });
  });

  it('reads JPEG dimensions after metadata segments', () => {
    assert.deepEqual(parseImageHeader(jpeg(3840, 2160, 5000)), { format: 'jpg', width: 3840, height: 2160, channels: 3 });
  });

  it('reads a JPEG header located beyond the first chunk', async () => {
    const parts = [new Uint8Array([0xff, 0xd8])];
    for (let i = 0; i < 4; i++) {
      const segment = new Uint8Array(65535 + 2);
      segment.set([0xff, 0xe2, 0xff, 0xff]);
      parts.push(segment);
    }
    parts.push(jpeg(1920, 1080).slice(2));
    const header = await readFileHeader(new File(parts, 'large.jpg'));
    assert.equal(header.width, 1920);
    assert.equal(header.height, 1080);
  });

  it('reads BMP dimensions with top-down height', () => {
    const bmp = encodeBmp(new Uint8Array(4 * 6).fill(255), 3, 2);
    new DataView(bmp.buffer).setInt32(22, -2, true);
    const header = parseImageHeader(bmp);
    assert.equal(header.width, 3);
    assert.equal(header.height, 2);
  });

  it('rejects truncated, empty and unknown data', () => {
    assert.equal(parseImageHeader(new Uint8Array()), null);
    assert.equal(parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff])), null);
    assert.equal(parseImageHeader(new TextEncoder().encode('this is not an image')), null);
    assert.equal(parseImageHeader(png(0, 10)), null);
  });
});

describe('BMP encoder', () => {
  it('writes a valid header, bottom-up rows and BGR order', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
    const bmp = encodeBmp(rgba, 2, 2);
    const view = new DataView(bmp.buffer);
    assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM');
    assert.equal(view.getUint32(2, true), bmp.length);
    assert.equal(view.getUint16(28, true), 24);
    assert.equal(bmp.length, 54 + 2 * 8);
    assert.deepEqual([...bmp.slice(54, 60)], [255, 0, 0, 30, 20, 10]);
    assert.deepEqual([...bmp.slice(62, 68)], [0, 0, 255, 0, 255, 0]);
  });

  it('pads rows to four bytes', () => {
    assert.equal(encodeBmp(new Uint8Array(4 * 3).fill(255), 3, 1).length, 54 + 12);
    assert.equal(encodeBmp(new Uint8Array(4 * 5).fill(255), 5, 1).length, 54 + 16);
  });

  it('blends transparency over white', () => {
    const bmp = encodeBmp(new Uint8Array([0, 0, 0, 0]), 1, 1);
    assert.deepEqual([...bmp.slice(54, 57)], [255, 255, 255]);
  });

  it('rejects inconsistent buffers', () => {
    assert.throws(() => encodeBmp(new Uint8Array(3), 1, 1), RangeError);
    assert.throws(() => encodeBmp(new Uint8Array(0), 0, 0), RangeError);
  });
});

describe('dataset structure', () => {
  it('accepts the whole assets folder and a single group folder', () => {
    assert.deepEqual(parseDatasetPath('assets/4k/lake/a.jpg'), { group: '4k', classId: 'lake', format: 'jpg' });
    assert.deepEqual(parseDatasetPath('icons_32/starry_sky/a.PNG'), { group: 'icons_32', classId: 'starry_sky', format: 'png' });
  });

  it('explains why a file is ignored', () => {
    assert.equal(parseDatasetPath('assets/_work/thumbs/lake/a.jpg').reason, 'service');
    assert.equal(parseDatasetPath('assets/4k/lake/notes.txt').reason, 'unsupported');
    assert.equal(parseDatasetPath('lake/a.jpg').reason, 'structure');
    assert.equal(parseDatasetPath('assets/deep/4k/lake/a.jpg').reason, 'structure');
    assert.equal(parseDatasetPath('assets/4k/cats/a.jpg').reason, 'unknownClass');
  });

  it('builds entries, counts ignored files and filters a selection', () => {
    const dataset = buildDataset([
      fileAt('assets/4k/lake/a.png'),
      fileAt('assets/4k/snowfield/b.png'),
      fileAt('assets/icons_32/lake/c.png'),
      fileAt('assets/_work/lake/d.png'),
      fileAt('assets/4k/lake/e.txt'),
    ]);
    assert.equal(dataset.rootName, 'assets');
    assert.equal(dataset.entries.length, 3);
    assert.equal(dataset.ignored.service, 1);
    assert.equal(dataset.ignored.unsupported, 1);
    const onlyIcons = filterEntries(dataset.entries, { groups: new Set(['icons_32']), formats: new Set(['png']) });
    assert.equal(onlyIcons.length, 1);
    assert.equal(summarizeGroups(dataset.entries)[0].id, '4k');
  });

  it('marks corrupted files and wrong extensions during scanning', async () => {
    const { entries } = buildDataset([
      fileAt('assets/4k/lake/ok.png'),
      fileAt('assets/4k/lake/wrong.jpg'),
      fileAt('assets/4k/lake/broken.png', new Uint8Array([1, 2, 3])),
    ]);
    const seen = [];
    const { valid, broken } = await scanEntries(entries, { onProgress: (done) => seen.push(done) });
    assert.deepEqual(valid.map((e) => e.file.name), ['ok.png']);
    assert.equal(valid[0].width, 4);
    assert.equal(broken.length, 2);
    assert.deepEqual([...seen].sort(), [1, 2, 3]);
  });

  it('stops scanning when cancelled', async () => {
    const { entries } = buildDataset([fileAt('assets/4k/lake/a.png')]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(scanEntries(entries, { signal: controller.signal }));
  });

  it('reports the selection state', () => {
    const status = (lake, snowfield, starry_sky) =>
      selectionStatus(summarizeSelection([
        ...Array(lake).fill({ classId: 'lake', size: 1 }),
        ...Array(snowfield).fill({ classId: 'snowfield', size: 1 }),
        ...Array(starry_sky).fill({ classId: 'starry_sky', size: 1 }),
      ]));
    assert.equal(status(0, 0, 0).level, 'error');
    assert.equal(status(300, 0, 0).canTrain, false);
    assert.equal(status(150, 150, 0).level, 'warn');
    assert.equal(status(50, 50, 50).level, 'warn');
    assert.equal(status(84, 83, 83).level, 'warn');
    assert.equal(status(150, 150, 30).level, 'warn');
    assert.equal(status(150, 150, 150).level, 'ok');
  });
});

describe('progress', () => {
  it('computes percent, rate and remaining time', () => {
    const state = computeProgress({ done: 25, total: 100, elapsedMs: 5000 });
    assert.equal(state.percent, 25);
    assert.equal(state.ratePerSecond, 5);
    assert.equal(state.etaMs, 15000);
  });

  it('shows 100 percent only when complete', () => {
    assert.equal(computeProgress({ done: 999, total: 1000, elapsedMs: 10 }).percent, 99);
    assert.equal(computeProgress({ done: 1000, total: 1000, elapsedMs: 10 }).etaMs, 0);
  });

  it('has no estimate before the first step', () => {
    const state = computeProgress({ done: 0, total: 10, elapsedMs: 100 });
    assert.equal(state.etaMs, null);
    assert.equal(state.ratePerSecond, 0);
  });
});

describe('operation log', () => {
  it('stores, limits and exports entries', () => {
    const log = createOperationLog({ limit: 2, now: () => new Date(2026, 10, 23, 10, 5, 9) });
    log.add('info', 'one');
    log.add('warn', 'two');
    log.add('error', 'three');
    assert.deepEqual(log.entries().map((e) => e.message), ['two', 'three']);
    assert.equal(log.toText().split('\r\n')[1], '2026-11-23 10:05:09 [ERROR] three');
    assert.throws(() => log.add('fatal', 'x'), RangeError);
  });
});

describe('training parameter validation', () => {
  const good = { epochs: '500', learningRate: '0.05', gridSize: '8', encoding: 'number', hiddenNeurons: '8' };
  const GRIDS = [4, 8, 12, 16, 24, 32];

  it('recommends a smaller learning rate for larger grids', () => {
    assert.deepEqual(GRIDS.map((grid) => recommendedLearningRate(grid)), [0.05, 0.013, 0.0056, 0.0031, 0.0014, 0.00078]);
    assert.deepEqual(GRIDS.map((grid) => recommendedLearningRate(grid, 'bits')), [0.5, 0.39, 0.17, 0.098, 0.043, 0.024]);
  });

  it('flags only rates that were measured as unstable', () => {
    assert.equal(isRateTooHigh(0.05, 32), true);
    assert.equal(isRateTooHigh(0.03, 32), false);
    assert.equal(isRateTooHigh(0.3, 16), true);
    assert.equal(isRateTooHigh(0.1, 16), false);
    assert.equal(isRateTooHigh(0.9, 8), false);
    assert.equal(isRateTooHigh(0.3, 16, 'bits'), true);
    assert.equal(isRateTooHigh(0.15, 16, 'bits'), false);
    assert.equal(isRateTooHigh(0.9, 8, 'bits'), true);
    assert.equal(isRateTooHigh(0.99, 4, 'bits'), false);
    for (const encoding of ['number', 'bits']) {
      for (const grid of GRIDS) assert.equal(isRateTooHigh(recommendedLearningRate(grid, encoding), grid, encoding), false);
    }
  });

  it('accepts valid values, including a decimal comma', () => {
    const result = validateTrainingParams({ ...good, learningRate: '0,05' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.values, { epochs: 500, learningRate: 0.05, gridSize: 8, encoding: 'number', hiddenNeurons: 8 });
  });

  it('accepts boundary values', () => {
    assert.equal(validateTrainingParams({ ...good, epochs: '1', learningRate: '0.0001' }).valid, true);
    assert.equal(validateTrainingParams({ ...good, epochs: '10000', learningRate: '0.99', hiddenNeurons: '256' }).valid, true);
  });

  it('rejects invalid values with a field error', () => {
    for (const [field, value] of [
      ['epochs', '0'], ['epochs', '10001'], ['epochs', '1.5'], ['epochs', ''], ['epochs', 'abc'],
      ['learningRate', '0'], ['learningRate', '1'], ['learningRate', '1.01'], ['learningRate', '-0.1'], ['learningRate', ''],
      ['gridSize', '7'], ['encoding', 'other'], ['encoding', ''], ['hiddenNeurons', '-1'], ['hiddenNeurons', '257'],
    ]) {
      const result = validateTrainingParams({ ...good, [field]: value });
      assert.equal(result.valid, false, `${field}=${value}`);
      assert.ok(result.errors[field], `${field}=${value}`);
    }
  });
});
