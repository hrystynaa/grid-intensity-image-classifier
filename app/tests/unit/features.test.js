import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCellMeans, luminance } from '../../src/core/features.js';
import { cellBoundaries } from '../../src/core/gridLayout.js';

const FLOAT32_TOLERANCE = 1e-6;

const assertClose = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < FLOAT32_TOLERANCE, `${message ?? 'value'}: ${actual} != ${expected}`);

function imageFrom(width, height, pixel) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      rgba.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return rgba;
}

// Independent reference: averages each cell by testing every pixel against the boundaries.
function bruteForceMeans(rgba, width, height, cells) {
  const xs = cellBoundaries(width, cells);
  const ys = cellBoundaries(height, cells);
  const result = [];
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (x >= xs[column] && x < xs[column + 1] && y >= ys[row] && y < ys[row + 1]) {
            const offset = (y * width + x) * 4;
            sum += luminance(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
            count++;
          }
        }
      }
      result.push(sum / count / 255);
    }
  }
  return result;
}

describe('luminance', () => {
  it('uses the Y-prime weights', () => {
    assertClose(luminance(255, 0, 0), 76.245);
    assertClose(luminance(0, 255, 0), 149.685);
    assertClose(luminance(0, 0, 255), 29.07);
    assertClose(luminance(255, 255, 255), 255);
  });
});

describe('cell means', () => {
  it('returns exact values for a uniform image', () => {
    const means = extractCellMeans(imageFrom(8, 8, () => [255, 255, 255]), 8, 8, 4);
    assert.equal(means.length, 16);
    for (const value of means) assertClose(value, 1);
    for (const value of extractCellMeans(imageFrom(8, 8, () => [0, 0, 0]), 8, 8, 4)) assert.equal(value, 0);
  });

  it('stores cells row by row', () => {
    const rgba = imageFrom(2, 2, (x, y) => {
      const gray = [[0, 51], [102, 255]][y][x];
      return [gray, gray, gray];
    });
    const means = extractCellMeans(rgba, 2, 2, 2);
    [0, 0.2, 0.4, 1].forEach((expected, index) => assertClose(means[index], expected, `cell ${index}`));
  });

  it('averages all pixels of a cell', () => {
    const rgba = imageFrom(4, 2, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
    for (const value of extractCellMeans(rgba, 4, 2, 2)) assertClose(value, 0.5);
  });

  it('matches a brute-force reference when the size is not divisible by the grid', () => {
    for (const [width, height, cells] of [[10, 7, 3], [33, 17, 8], [101, 64, 16], [32, 32, 32], [17, 40, 4]]) {
      const rgba = imageFrom(width, height, (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 91) % 256, (x * y * 13) % 256]);
      const expected = bruteForceMeans(rgba, width, height, cells);
      const actual = extractCellMeans(rgba, width, height, cells);
      assert.equal(actual.length, cells * cells);
      expected.forEach((value, index) => assertClose(actual[index], value, `${width}x${height}/${cells} cell ${index}`));
    }
  });

  it('ignores the alpha channel', () => {
    const opaque = imageFrom(4, 4, () => [120, 60, 30, 255]);
    const transparent = imageFrom(4, 4, () => [120, 60, 30, 0]);
    assert.deepEqual(extractCellMeans(opaque, 4, 4, 2), extractCellMeans(transparent, 4, 4, 2));
  });

  it('rejects inconsistent input', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    assert.throws(() => extractCellMeans(rgba, 4, 4, 5), /smaller than the grid/);
    assert.throws(() => extractCellMeans(rgba, 4, 5, 2), /does not match/);
    assert.throws(() => extractCellMeans(rgba, 4, 4, 0), RangeError);
    assert.throws(() => extractCellMeans(rgba, 4, 4, 1.5), RangeError);
    assert.throws(() => extractCellMeans(new Uint8ClampedArray(0), 0, 0, 1), RangeError);
  });
});
