import { createRandom, shuffleInPlace } from './random.js';

const TRAIN_SHARE = 0.7;

// The same photo in different quality groups has the same file name within its class.
export function photoKey(entry) {
  const name = entry.path.split(/[\\/]/).at(-1);
  const dot = name.lastIndexOf('.');
  return `${entry.classId}/${(dot > 0 ? name.slice(0, dot) : name).toLowerCase()}`;
}

export function splitSizes(count) {
  if (count < 3) return { train: Math.min(count, 1), validation: Math.max(count - 1, 0), test: 0 };
  const train = Math.min(Math.round(count * TRAIN_SHARE), count - 2);
  const validation = Math.ceil((count - train) / 2);
  return { train, validation, test: count - train - validation };
}

// Splits by source photo within each class, so no photo reaches two parts in any quality.
export function splitByPhoto(entries, { seed = 1 } = {}) {
  const photosByClass = new Map();
  for (const entry of entries) {
    const photos = photosByClass.get(entry.classId) ?? new Map();
    const key = photoKey(entry);
    photos.set(key, [...(photos.get(key) ?? []), entry]);
    photosByClass.set(entry.classId, photos);
  }

  const parts = { train: [], validation: [], test: [] };
  for (const classId of [...photosByClass.keys()].sort()) {
    const photos = photosByClass.get(classId);
    const keys = shuffleInPlace([...photos.keys()].sort(), createRandom(seed));
    const sizes = splitSizes(keys.length);
    keys.forEach((key, index) => {
      const part = index < sizes.train ? 'train' : index < sizes.train + sizes.validation ? 'validation' : 'test';
      parts[part].push(...photos.get(key));
    });
  }
  return parts;
}
