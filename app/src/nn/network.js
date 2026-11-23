// The browser build bundles its GPU dependency, so tests and the app run the same code.
import { NeuralNetwork } from 'brain.js/dist/browser.js';
import { evaluate } from '../core/metrics.js';
import { createRandom, shuffleInPlace } from '../core/random.js';

// Brain.js stops early at its default threshold; this value makes it run every requested epoch.
const NO_EARLY_STOP = 1e-12;
const MAX_HISTORY_POINTS = 300;
const YIELD_INTERVAL_MS = 40;

const oneHot = (index, size) => Array.from({ length: size }, (_, i) => (i === index ? 1 : 0));

// Brain.js reads Math.random while creating weights, so it is seeded only for that moment.
function withRandom(random, action) {
  const original = Math.random;
  Math.random = random;
  try {
    return action();
  } finally {
    Math.random = original;
  }
}

export const runNetwork = (net, means) => net.run(Array.from(means));

export async function trainNetwork({
  train,
  validation = [],
  classCount,
  hiddenNeurons = 0,
  epochs,
  learningRate,
  seed = 1,
  onEpoch,
  shouldStop,
  now = () => performance.now(),
  pause = () => new Promise((resolve) => setTimeout(resolve)),
}) {
  const random = createRandom(seed);
  const net = new NeuralNetwork({ hiddenLayers: hiddenNeurons > 0 ? [hiddenNeurons] : [] });
  // Brain.js treats typed arrays as lookup objects, so features are passed as plain arrays.
  const data = train.map((sample) => ({
    input: Array.from(sample.means),
    output: oneHot(sample.classIndex, classCount),
  }));
  shuffleInPlace(data, random);

  const { preparedData, status, endTime } = withRandom(random, () =>
    net.prepTraining(data, { iterations: epochs, errorThresh: NO_EARLY_STOP, learningRate, log: false }),
  );

  const predict = (means) => runNetwork(net, means);
  const historyStep = Math.max(1, Math.ceil(epochs / MAX_HISTORY_POINTS));
  const history = [];
  const started = now();
  let lastYield = started;
  let stopped = false;

  while (net.trainingTick(preparedData, status, endTime)) {
    // Weights change after every example, so the order is reshuffled for each epoch.
    shuffleInPlace(preparedData, random);
    const epoch = status.iterations;
    if (epoch % historyStep === 0 || epoch === epochs) {
      history.push({
        epoch,
        error: status.error,
        validationAccuracy: validation.length ? evaluate(predict, validation, classCount).accuracy : null,
      });
    }
    onEpoch?.({ epoch, total: epochs, error: status.error });
    if (now() - lastYield >= YIELD_INTERVAL_MS) {
      await pause();
      lastYield = now();
      if (epoch < epochs && shouldStop?.()) {
        stopped = true;
        break;
      }
    }
  }

  const trainMs = now() - started;
  if (stopped && history.at(-1)?.epoch !== status.iterations) {
    history.push({
      epoch: status.iterations,
      error: status.error,
      validationAccuracy: validation.length ? evaluate(predict, validation, classCount).accuracy : null,
    });
  }

  return {
    net,
    stopped,
    trainMs,
    epochsDone: status.iterations,
    finalError: status.error,
    history,
    trainMetrics: evaluate(predict, train, classCount),
    validationMetrics: evaluate(predict, validation, classCount),
  };
}

export const restoreNetwork = (json) => new NeuralNetwork().fromJSON(json);
