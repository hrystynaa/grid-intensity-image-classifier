import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeFeatures, encodingLabel, encodingShortLabel, inputCount, isEncoding } from '../../src/core/encoding.js';
import { createRandom } from '../../src/core/random.js';
import { restoreNetwork, runNetwork, trainNetwork } from '../../src/nn/network.js';

const levelsOf = (bits) => {
  const levels = [];
  for (let cell = 0; cell < bits.length; cell += 8) {
    levels.push(bits.slice(cell, cell + 8).reduce((value, bit) => value * 2 + bit, 0));
  }
  return levels;
};

describe('input encoding', () => {
  it('counts network inputs', () => {
    assert.equal(inputCount(8, 'number'), 64);
    assert.equal(inputCount(16, 'number'), 256);
    assert.equal(inputCount(16, 'bits'), 2048);
    assert.equal(inputCount(4, 'bits'), 128);
  });

  it('keeps one number per cell unchanged', () => {
    const means = Float32Array.of(0, 0.25, 1);
    assert.equal(encodeFeatures(means, 'number'), means);
  });

  it('writes 8 bits per cell, most significant first', () => {
    const bits = encodeFeatures(Float32Array.of(0, 1, 128 / 255, 1 / 255), 'bits');
    assert.deepEqual([...bits], [
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
      1, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('restores every brightness level from its bits', () => {
    const levels = Array.from({ length: 256 }, (_, level) => level);
    const bits = encodeFeatures(Float32Array.from(levels, (level) => level / 255), 'bits');
    assert.equal(bits.length, 2048);
    assert.deepEqual(levelsOf([...bits]), levels);
  });

  it('keeps values slightly outside the range valid', () => {
    assert.deepEqual([...encodeFeatures(Float32Array.of(-0.01, 1.01), 'bits')], [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('rejects an unknown encoding and names the known ones', () => {
    assert.throws(() => encodeFeatures(Float32Array.of(0.5), 'other'), RangeError);
    assert.equal(isEncoding('bits'), true);
    assert.equal(isEncoding('other'), false);
    assert.equal(encodingLabel('bits'), '8 бітів на клітинку');
    assert.equal(encodingShortLabel('number'), 'Одне число');
  });

  it('trains a network on bit inputs and keeps its answers after saving', async () => {
    const random = createRandom(4);
    const samples = (count) => Array.from({ length: count * 3 }, (_, index) => {
      const classIndex = index % 3;
      // These levels stay away from 128, where a tiny change would flip every bit.
      const base = [0.1, 0.4, 0.9][classIndex];
      const means = Float32Array.from({ length: 4 }, () => base + (random() - 0.5) * 0.04);
      return { means: encodeFeatures(means, 'bits'), classIndex };
    });
    const result = await trainNetwork({
      train: samples(12),
      validation: samples(4),
      classCount: 3,
      hiddenNeurons: 8,
      epochs: 150,
      learningRate: 0.3,
      seed: 3,
    });
    assert.deepEqual(Array.from(result.net.sizes), [32, 8, 3]);
    assert.equal(result.validationMetrics.accuracy, 1);
    const restored = restoreNetwork(JSON.parse(JSON.stringify(result.net.toJSON())));
    const probe = samples(1)[0].means;
    Array.from(runNetwork(result.net, probe)).forEach((value, index) => {
      assert.ok(Math.abs(value - runNetwork(restored, probe)[index]) < 1e-6);
    });
  });
});
