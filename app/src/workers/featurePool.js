/* global __FEATURE_WORKER_SOURCE__ */
import { createWorkerPool } from './pool.js';

// Upper bound until the best worker count is measured on the full dataset.
const MAX_DEFAULT_WORKERS = 8;

let workerUrl = null;

function createFeatureWorker() {
  workerUrl ??= URL.createObjectURL(new Blob([__FEATURE_WORKER_SOURCE__], { type: 'text/javascript' }));
  return new Worker(workerUrl, { name: 'Обчислення ознак' });
}

export const defaultWorkerCount = (cores = navigator.hardwareConcurrency || 2) =>
  Math.max(1, Math.min(cores - 1, MAX_DEFAULT_WORKERS));

export function createFeatureExtractor({ size = defaultWorkerCount() } = {}) {
  const pool = createWorkerPool({ createWorker: createFeatureWorker, size });
  return {
    size,
    extract(entries, cells, { onProgress, signal } = {}) {
      return pool.run(entries, {
        toMessage: (entry) => ({ message: { file: entry.file, cells } }),
        onResult: (_result, _index, done, total) => onProgress?.(done, total),
        signal,
      });
    },
    dispose: pool.dispose,
  };
}
