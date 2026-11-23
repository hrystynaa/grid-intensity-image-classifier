/* global __MODEL_WORKER_SOURCE__ */

let workerUrl = null;

function createModelWorker() {
  workerUrl ??= URL.createObjectURL(new Blob([__MODEL_WORKER_SOURCE__], { type: 'text/javascript' }));
  return new Worker(workerUrl, { name: 'Нейронна мережа' });
}

export function createModelClient() {
  const pending = new Map();
  let worker = null;
  let nextId = 1;

  function failAll(message) {
    worker?.terminate();
    worker = null;
    const requests = [...pending.values()];
    pending.clear();
    requests.forEach((request) => request.reject(new Error(message)));
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createModelWorker();
    worker.addEventListener('message', ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      if (data.type === 'epoch') {
        request.onEpoch?.(data);
        return;
      }
      pending.delete(data.id);
      if (data.type === 'error') request.reject(new Error(data.message));
      else request.resolve(data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      failAll(event.message || 'Worker stopped unexpectedly');
    });
    worker.addEventListener('messageerror', () => failAll('Worker message could not be read'));
    return worker;
  }

  function request(message, { onEpoch } = {}) {
    const target = ensureWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onEpoch });
      target.postMessage({ ...message, id });
    });
  }

  return {
    train: ({ train, validation, config, onEpoch }) => request({ type: 'train', train, validation, config }, { onEpoch }),
    stop: () => worker?.postMessage({ type: 'stop' }),
    load: (network) => request({ type: 'load', network }),
    predict: async (means) => (await request({ type: 'predict', means })).outputs,
  };
}
