import { formatNumber } from './format.js';

export const GRID_SIZES = [4, 8, 12, 16, 24, 32];
export const DEFAULT_GRID_SIZE = 8;

export const TRAINING_LIMITS = {
  epochs: { min: 1, max: 10000, fallback: 500 },
  learningRate: { min: 0.0001, max: 1, fallback: 0.05 },
  hiddenNeurons: { min: 0, max: 256, fallback: 0 },
};

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

export function validateTrainingParams({ epochs, learningRate, gridSize, hiddenNeurons }) {
  const errors = {};
  const values = {};

  const epochResult = validateInteger(epochs, TRAINING_LIMITS.epochs, 'Кількість епох');
  if (epochResult.error) errors.epochs = epochResult.error;
  else values.epochs = epochResult.value;

  const rate = parseNumber(learningRate);
  const { min, max } = TRAINING_LIMITS.learningRate;
  if (!Number.isFinite(rate) || rate < min || rate > max) {
    errors.learningRate = 'Швидкість навчання: число від 0,0001 до 1.';
  } else {
    values.learningRate = rate;
  }

  const grid = parseNumber(gridSize);
  if (!GRID_SIZES.includes(grid)) errors.gridSize = 'Оберіть розмір сітки зі списку.';
  else values.gridSize = grid;

  const hiddenResult = validateInteger(hiddenNeurons, TRAINING_LIMITS.hiddenNeurons, 'Прихований шар');
  if (hiddenResult.error) errors.hiddenNeurons = hiddenResult.error;
  else values.hiddenNeurons = hiddenResult.value;

  return { valid: Object.keys(errors).length === 0, errors, values };
}
