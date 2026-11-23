import { DEFAULT_ENCODING, inputCount, isEncoding } from './encoding.js';
import { formatNumber } from './format.js';

export const GRID_SIZES = [4, 8, 12, 16, 24, 32];
export const DEFAULT_GRID_SIZE = 8;

export const TRAINING_LIMITS = {
  epochs: { min: 1, max: 10000, fallback: 500 },
  // Brain.js rejects a learning rate of 1 or more.
  learningRate: { min: 0.0001, max: 0.99, fallback: 0.013 },
  hiddenNeurons: { min: 0, max: 256, fallback: 8 },
};

// Weights change after every image, so the effective step grows with the number of inputs.
// Limits on rate * inputs come from cross-validation and differ per encoding.
const RATE_RULES = {
  number: { stable: 0.8, unstable: 40, maxRecommended: 0.05, smallestUnstableGrid: 16 },
  bits: { stable: 200, unstable: 400, maxRecommended: 0.5, smallestUnstableGrid: 8 },
};

export function recommendedLearningRate(gridSize, encoding = DEFAULT_ENCODING) {
  const { stable, maxRecommended } = RATE_RULES[encoding];
  return Math.min(maxRecommended, Number((stable / inputCount(gridSize, encoding)).toPrecision(2)));
}

export function isRateTooHigh(rate, gridSize, encoding = DEFAULT_ENCODING) {
  const { unstable, smallestUnstableGrid } = RATE_RULES[encoding];
  return gridSize >= smallestUnstableGrid && rate * inputCount(gridSize, encoding) > unstable;
}

const parseNumber = (raw) => {
  const text = String(raw ?? '').trim().replace(',', '.');
  return text === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text) ? NaN : Number(text);
};

function validateInteger(raw, { min, max }, name) {
  const value = parseNumber(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { error: `${name}: ціле число від ${formatNumber(min)} до ${formatNumber(max)}.` };
  }
  return { value };
}

export function validateTrainingParams({ epochs, learningRate, gridSize, encoding, hiddenNeurons }) {
  const errors = {};
  const values = {};

  const epochResult = validateInteger(epochs, TRAINING_LIMITS.epochs, 'Кількість епох');
  if (epochResult.error) errors.epochs = epochResult.error;
  else values.epochs = epochResult.value;

  const rate = parseNumber(learningRate);
  const { min, max } = TRAINING_LIMITS.learningRate;
  if (!Number.isFinite(rate) || rate < min || rate > max) {
    errors.learningRate = 'Швидкість навчання: число від 0,0001 до 0,99.';
  } else {
    values.learningRate = rate;
  }

  const grid = parseNumber(gridSize);
  if (!GRID_SIZES.includes(grid)) errors.gridSize = 'Оберіть розмір сітки зі списку.';
  else values.gridSize = grid;

  if (!isEncoding(encoding)) errors.encoding = 'Оберіть кодування яскравості зі списку.';
  else values.encoding = encoding;

  const hiddenResult = validateInteger(hiddenNeurons, TRAINING_LIMITS.hiddenNeurons, 'Прихований шар');
  if (hiddenResult.error) errors.hiddenNeurons = hiddenResult.error;
  else values.hiddenNeurons = hiddenResult.value;

  return { valid: Object.keys(errors).length === 0, errors, values };
}
