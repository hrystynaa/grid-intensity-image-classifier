import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { niceTicks } from '../../src/core/chartScale.js';
import { formatMetric, formatPercent } from '../../src/core/format.js';
import { createModelFile, parseModelFile } from '../../src/core/modelFile.js';
import { recognitionToCsv, runsToCsv, toCsv } from '../../src/core/resultsExport.js';

const validModel = (overrides = {}) => ({
  ...createModelFile({
    network: { sizes: [64, 3] },
    gridSize: 8,
    encoding: 'number',
    hiddenNeurons: 0,
    training: { epochsDone: 10 },
  }),
  ...overrides,
});

describe('chart ticks', () => {
  it('gives round ticks that cover the maximum', () => {
    assert.deepEqual(niceTicks(0.23), [0, 0.1, 0.2, 0.3]);
    assert.deepEqual(niceTicks(500), [0, 200, 400, 600]);
    assert.deepEqual(niceTicks(1), [0, 0.5, 1]);
  });

  it('handles empty and invalid ranges', () => {
    assert.deepEqual(niceTicks(0), [0, 1]);
    assert.deepEqual(niceTicks(Number.NaN), [0, 1]);
  });
});

describe('result formatting', () => {
  it('uses a decimal comma and a dash for missing values', () => {
    assert.equal(formatPercent(0.875), '87,5%');
    assert.equal(formatPercent(null), '—');
    assert.equal(formatMetric(0.12345), '0,123');
    assert.equal(formatMetric(undefined), '—');
  });
});

describe('CSV export', () => {
  const columns = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }];

  it('starts with a BOM and uses semicolons with decimal commas', () => {
    assert.equal(toCsv(columns, [{ a: 1.5, b: 'x' }]), '﻿A;B\r\n1,5;x\r\n');
  });

  it('quotes separators and neutralises spreadsheet formulas', () => {
    const csv = toCsv(columns, [{ a: 'x;y"z', b: '=SUM(A1)' }]);
    assert.ok(csv.includes('"x;y""z"'));
    assert.ok(csv.includes("'=SUM(A1)"));
  });

  it('exports runs and a recognition result', () => {
    const runs = runsToCsv([{ number: 1, groups: ['4k', 'fullhd'], stopped: true, validationAccuracy: 0.9 }]);
    assert.ok(runs.includes('4k, fullhd'));
    assert.ok(runs.includes('так'));
    assert.ok(runs.includes('0,9'));
    const recognition = recognitionToCsv({
      file: 'a.jpg', width: 10, height: 10, gridSize: 8, predictedLabel: 'Озеро',
      shares: { lake: 0.5, snowfield: 0.25, starry_sky: 0.25 }, recognitionMs: 12,
    });
    assert.ok(recognition.includes('Частка: Озеро'));
    assert.ok(recognition.includes('0,5;0,25;0,25'));
  });
});

describe('model file', () => {
  it('accepts a valid file', () => {
    const model = parseModelFile(JSON.stringify(validModel()));
    assert.equal(model.gridSize, 8);
  });

  it('accepts a network with a hidden layer', () => {
    const text = JSON.stringify(validModel({ hiddenNeurons: 5, network: { sizes: [64, 5, 3] } }));
    assert.equal(parseModelFile(text).hiddenNeurons, 5);
  });

  it('checks the input count of an 8-bit model', () => {
    const text = JSON.stringify(validModel({ encoding: 'bits', hiddenNeurons: 8, network: { sizes: [512, 8, 3] } }));
    assert.equal(parseModelFile(text).encoding, 'bits');
    const wrong = JSON.stringify(validModel({ encoding: 'bits', network: { sizes: [64, 3] } }));
    assert.throws(() => parseModelFile(wrong), /Будова/);
  });

  it('opens a model saved before the encoding choice', () => {
    const { encoding: _encoding, ...older } = validModel({ version: 1 });
    const model = parseModelFile(JSON.stringify(older));
    assert.equal(model.encoding, 'number');
    assert.equal(model.version, 2);
  });

  it('rejects damaged or foreign files', () => {
    for (const [text, pattern] of [
      [JSON.stringify(validModel({ encoding: 'other' })), /кодування/],
      ['not json', /JSON/],
      ['null', /не файл моделі/],
      [JSON.stringify({ format: 'other' }), /не файл моделі/],
      [JSON.stringify(validModel({ version: 99 })), /версія/],
      [JSON.stringify(validModel({ classes: ['a', 'b', 'c'] })), /Класи/],
      [JSON.stringify(validModel({ gridSize: 7 })), /сітки/],
      [JSON.stringify(validModel({ hiddenNeurons: -1 })), /прихований/],
      [JSON.stringify(validModel({ network: { sizes: [16, 3] } })), /Будова/],
      [JSON.stringify(validModel({ network: null })), /Будова/],
    ]) {
      assert.throws(() => parseModelFile(text), pattern, text.slice(0, 40));
    }
  });
});
