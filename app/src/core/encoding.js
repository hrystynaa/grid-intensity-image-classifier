const BITS_PER_CELL = 8;
const MAX_LEVEL = 255;

export const ENCODINGS = [
  { id: 'number', label: 'Одне число на клітинку', shortLabel: 'Одне число', inputsPerCell: 1 },
  { id: 'bits', label: '8 бітів на клітинку', shortLabel: '8 бітів', inputsPerCell: BITS_PER_CELL },
];

export const DEFAULT_ENCODING = 'number';

const findEncoding = (id) => ENCODINGS.find((item) => item.id === id);

export const isEncoding = (id) => Boolean(findEncoding(id));
export const encodingLabel = (id) => findEncoding(id)?.label ?? id;
export const encodingShortLabel = (id) => findEncoding(id)?.shortLabel ?? id;
export const inputCount = (gridSize, encoding) => gridSize ** 2 * findEncoding(encoding).inputsPerCell;

// Turns cell means in [0, 1] into network inputs. Bits go from the most significant to the least.
export function encodeFeatures(means, encoding) {
  if (encoding === 'number') return means;
  if (encoding !== 'bits') throw new RangeError(`Unknown encoding: ${encoding}`);
  const inputs = new Uint8Array(means.length * BITS_PER_CELL);
  for (let cell = 0; cell < means.length; cell++) {
    const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(means[cell] * MAX_LEVEL)));
    for (let bit = 0; bit < BITS_PER_CELL; bit++) {
      inputs[cell * BITS_PER_CELL + bit] = (level >> (BITS_PER_CELL - 1 - bit)) & 1;
    }
  }
  return inputs;
}
