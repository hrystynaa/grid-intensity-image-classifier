import { CLASSES } from './classes.js';
import { DEFAULT_ENCODING, inputCount, isEncoding } from './encoding.js';
import { GRID_SIZES, TRAINING_LIMITS } from './validation.js';

export const MODEL_FORMAT = 'grid-intensity-model';
export const MODEL_VERSION = 2;
// Version 1 files were saved before the encoding choice existed and always used one number per cell.
const VERSION_WITHOUT_ENCODING = 1;

export function createModelFile({ network, gridSize, encoding, hiddenNeurons, training }) {
  return {
    format: MODEL_FORMAT,
    version: MODEL_VERSION,
    classes: CLASSES.map((item) => item.id),
    gridSize,
    encoding,
    hiddenNeurons,
    training,
    network,
  };
}

export function parseModelFile(text) {
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    throw new Error('Файл моделі не є коректним JSON.');
  }
  if (model?.format !== MODEL_FORMAT) throw new Error('Це не файл моделі цього застосунку.');
  if (model.version !== MODEL_VERSION && model.version !== VERSION_WITHOUT_ENCODING) {
    throw new Error(`Непідтримувана версія файлу моделі: ${model.version}.`);
  }

  const expected = CLASSES.map((item) => item.id);
  if (!Array.isArray(model.classes) || model.classes.join() !== expected.join()) {
    throw new Error('Класи моделі не збігаються з класами застосунку.');
  }
  if (!GRID_SIZES.includes(model.gridSize)) throw new Error('Файл моделі містить непідтримуваний розмір сітки.');

  const encoding = model.version === VERSION_WITHOUT_ENCODING ? DEFAULT_ENCODING : model.encoding;
  if (!isEncoding(encoding)) throw new Error('Файл моделі містить невідоме кодування яскравості.');

  const { min, max } = TRAINING_LIMITS.hiddenNeurons;
  if (!Number.isInteger(model.hiddenNeurons) || model.hiddenNeurons < min || model.hiddenNeurons > max) {
    throw new Error('Файл моделі містить некоректний прихований шар.');
  }

  const inputs = inputCount(model.gridSize, encoding);
  const sizes = model.hiddenNeurons ? [inputs, model.hiddenNeurons, expected.length] : [inputs, expected.length];
  if (!Array.isArray(model.network?.sizes) || model.network.sizes.join() !== sizes.join()) {
    throw new Error('Будова мережі у файлі не відповідає її параметрам.');
  }
  return { ...model, version: MODEL_VERSION, encoding };
}
