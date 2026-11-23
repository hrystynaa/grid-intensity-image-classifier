import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, indexOfMax, toShares } from '../../src/core/metrics.js';
import { createRandom, shuffleInPlace } from '../../src/core/random.js';
import { photoKey, splitByPhoto, splitSizes } from '../../src/core/split.js';
import { TRAINING_LIMITS } from '../../src/core/validation.js';
import { restoreNetwork, runNetwork, trainNetwork } from '../../src/nn/network.js';

const CLASSES = ['lake', 'snowfield', 'starry_sky'];
const GROUPS = ['4k', 'fullhd', 'icons_32'];

function photoEntries(perClass) {
  return CLASSES.flatMap((classId) =>
    Array.from({ length: perClass }, (_, photo) =>
      GROUPS.map((group) => ({ classId, group, path: `assets/${group}/${classId}/${classId}_${photo}.jpg` })),
    ).flat(),
  );
}

// Three separable classes: each lights up a different third of the features.
function syntheticSamples(perClass, seed, size = 12) {
  const random = createRandom(seed);
  return Array.from({ length: perClass * 3 }, (_, index) => {
    const classIndex = index % 3;
    const means = Float32Array.from({ length: size }, (_, feature) => {
      const active = Math.floor((feature * 3) / size) === classIndex;
      return (active ? 0.75 : 0.15) + random() * 0.1;
    });
    return { means, classIndex };
  });
}

const baseConfig = () => ({
  train: syntheticSamples(20, 11),
  validation: syntheticSamples(6, 22),
  classCount: 3,
  epochs: 60,
  learningRate: 0.3,
  seed: 5,
});

describe('seeded random', () => {
  it('repeats for one seed and differs for another', () => {
    const take = (seed) => {
      const random = createRandom(seed);
      return Array.from({ length: 5 }, random);
    };
    assert.deepEqual(take(7), take(7));
    assert.notDeepEqual(take(7), take(8));
    assert.ok(take(7).every((value) => value >= 0 && value < 1));
  });

  it('shuffles without losing items', () => {
    const shuffled = shuffleInPlace(Array.from({ length: 50 }, (_, i) => i), createRandom(3));
    assert.deepEqual([...shuffled].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i));
    assert.notDeepEqual(shuffled, Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('split by source photo', () => {
  it('gets the planned part sizes', () => {
    assert.deepEqual(splitSizes(150), { train: 105, validation: 23, test: 22 });
    assert.deepEqual(splitSizes(4), { train: 2, validation: 1, test: 1 });
    assert.deepEqual(splitSizes(3), { train: 1, validation: 1, test: 1 });
    assert.deepEqual(splitSizes(2), { train: 1, validation: 1, test: 0 });
    assert.deepEqual(splitSizes(1), { train: 1, validation: 0, test: 0 });
    assert.deepEqual(splitSizes(0), { train: 0, validation: 0, test: 0 });
  });

  it('never places one photo in two parts, in any quality group', () => {
    const parts = splitByPhoto(photoEntries(40));
    const owner = new Map();
    for (const [part, entries] of Object.entries(parts)) {
      for (const entry of entries) {
        const key = photoKey(entry);
        assert.equal(owner.get(key) ?? part, part, `${key} leaked`);
        owner.set(key, part);
      }
    }
    assert.equal(owner.size, 120);
    assert.equal(parts.train.length + parts.validation.length + parts.test.length, 360);
  });

  it('keeps class proportions', () => {
    const parts = splitByPhoto(photoEntries(40));
    for (const part of Object.values(parts)) {
      const counts = CLASSES.map((classId) => part.filter((entry) => entry.classId === classId).length);
      assert.equal(new Set(counts).size, 1);
    }
  });

  it('does not depend on file order', () => {
    const entries = photoEntries(20);
    const paths = (parts) => Object.values(parts).map((part) => part.map((entry) => entry.path).sort());
    const reversed = splitByPhoto([...entries].reverse(), { seed: 9 });
    assert.deepEqual(paths(splitByPhoto(entries, { seed: 9 })), paths(reversed));
    assert.notDeepEqual(paths(splitByPhoto(entries, { seed: 9 })), paths(splitByPhoto(entries, { seed: 10 })));
  });
});

describe('metrics', () => {
  it('finds the largest output and scales to shares', () => {
    assert.equal(indexOfMax([0.1, 0.9, 0.3]), 1);
    assert.deepEqual(toShares([1, 1, 2]), [0.25, 0.25, 0.5]);
    assert.deepEqual(toShares([0, 0]), [0.5, 0.5]);
  });

  it('counts accuracy and the confusion matrix', () => {
    const answers = { a: [1, 0], b: [0, 1] };
    const samples = [{ means: 'a', classIndex: 0 }, { means: 'b', classIndex: 0 }, { means: 'b', classIndex: 1 }];
    const result = evaluate((means) => answers[means], samples, 2);
    assert.equal(result.correct, 2);
    assert.equal(result.accuracy, 2 / 3);
    assert.deepEqual(result.confusion, [[1, 1], [0, 1]]);
    assert.equal(evaluate(() => [1, 0], [], 2).accuracy, null);
  });
});

describe('network training', () => {
  it('runs exactly the requested epochs and learns separable classes', async () => {
    const seen = [];
    const result = await trainNetwork({ ...baseConfig(), onEpoch: ({ epoch }) => seen.push(epoch) });
    assert.equal(result.epochsDone, 60);
    assert.deepEqual(seen, Array.from({ length: 60 }, (_, i) => i + 1));
    assert.equal(result.stopped, false);
    assert.equal(result.validationMetrics.accuracy, 1);
    assert.ok(result.history.at(-1).error < result.history[0].error);
  });

  it('accepts the largest learning rate allowed by the form', async () => {
    const result = await trainNetwork({ ...baseConfig(), epochs: 2, learningRate: TRAINING_LIMITS.learningRate.max });
    assert.equal(result.epochsDone, 2);
  });

  it('builds a true single-layer network when there are no hidden neurons', async () => {
    const single = await trainNetwork({ ...baseConfig(), epochs: 1 });
    assert.deepEqual(Array.from(single.net.sizes), [12, 3]);
    const hidden = await trainNetwork({ ...baseConfig(), epochs: 1, hiddenNeurons: 5 });
    assert.deepEqual(Array.from(hidden.net.sizes), [12, 5, 3]);
  });

  it('repeats a run with the same seed and leaves Math.random untouched', async () => {
    const original = Math.random;
    const first = await trainNetwork(baseConfig());
    const second = await trainNetwork(baseConfig());
    const other = await trainNetwork({ ...baseConfig(), seed: 6 });
    assert.equal(Math.random, original);
    assert.deepEqual(first.history.map((p) => p.error), second.history.map((p) => p.error));
    assert.notDeepEqual(first.history.map((p) => p.error), other.history.map((p) => p.error));
  });

  it('limits history size and always keeps the last epoch', async () => {
    const result = await trainNetwork({ ...baseConfig(), train: syntheticSamples(2, 1), epochs: 1000 });
    assert.ok(result.history.length <= 300);
    assert.equal(result.history.at(-1).epoch, 1000);
  });

  it('stops between epochs and keeps the partly trained model', async () => {
    let clock = 0;
    const result = await trainNetwork({
      ...baseConfig(),
      epochs: 500,
      now: () => (clock += 100),
      pause: async () => {},
      shouldStop: () => clock > 1000,
    });
    assert.equal(result.stopped, true);
    assert.ok(result.epochsDone > 0 && result.epochsDone < 500);
    assert.equal(result.history.at(-1).epoch, result.epochsDone);
  });

  it('keeps answers after saving and loading the model', async () => {
    const { net } = await trainNetwork(baseConfig());
    const restored = restoreNetwork(JSON.parse(JSON.stringify(net.toJSON())));
    for (const sample of syntheticSamples(2, 33)) {
      const before = Array.from(runNetwork(net, sample.means));
      const after = Array.from(runNetwork(restored, sample.means));
      before.forEach((value, index) => assert.ok(Math.abs(value - after[index]) < 1e-6));
    }
  });
});
