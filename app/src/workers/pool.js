// Runs independent tasks on a fixed number of workers.
// Each idle worker takes the next task, so slow images do not hold back the others.
export function createWorkerPool({ createWorker, size }) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Pool size must be a positive integer');

  let workers = [];
  let running = false;

  function discardWorkers() {
    workers.forEach((worker) => worker.terminate());
    workers = [];
  }

  function run(items, { toMessage = (item) => ({ message: item }), onResult, signal } = {}) {
    if (running) return Promise.reject(new Error('Worker pool is busy'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!items.length) return Promise.resolve([]);
    running = true;

    return new Promise((resolve, reject) => {
      const results = new Array(items.length);
      const assigned = new Map();
      const detachers = new Map();
      let next = 0;
      let done = 0;
      let settled = false;

      function settle(callback, value) {
        if (settled) return;
        settled = true;
        running = false;
        signal?.removeEventListener('abort', onAbort);
        detachers.forEach((detach) => detach());
        detachers.clear();
        callback(value);
      }

      function onAbort() {
        discardWorkers();
        settle(reject, signal.reason);
      }

      function complete(index, result) {
        results[index] = result;
        done++;
        try {
          onResult?.(result, index, done, items.length);
        } catch (error) {
          discardWorkers();
          settle(reject, error);
          return;
        }
        if (done === items.length) settle(resolve, results);
      }

      function dispatch(worker) {
        while (!settled && next < items.length) {
          const index = next++;
          try {
            const { message, transfer = [] } = toMessage(items[index], index);
            assigned.set(worker, index);
            worker.postMessage(message, transfer);
            return;
          } catch (error) {
            assigned.delete(worker);
            complete(index, { ok: false, reason: 'dispatch', error: error.message });
          }
        }
      }

      function replaceWorker(worker, reason, text) {
        const index = assigned.get(worker);
        assigned.delete(worker);
        detachers.get(worker)?.();
        detachers.delete(worker);
        worker.terminate();
        workers = workers.filter((item) => item !== worker);
        if (index !== undefined) complete(index, { ok: false, reason, error: text });
        if (settled) return;
        if (next < items.length) {
          try {
            const fresh = createWorker();
            workers.push(fresh);
            attach(fresh);
            dispatch(fresh);
          } catch (error) {
            discardWorkers();
            settle(reject, error);
          }
        } else if (!workers.length && done < items.length) {
          settle(reject, new Error('All workers stopped before finishing'));
        }
      }

      function attach(worker) {
        const onMessage = ({ data }) => {
          const index = assigned.get(worker);
          if (index === undefined) return;
          assigned.delete(worker);
          complete(index, data);
          dispatch(worker);
        };
        const onError = (event) => {
          event.preventDefault?.();
          replaceWorker(worker, 'crash', event.message || 'Worker stopped unexpectedly');
        };
        const onMessageError = () => replaceWorker(worker, 'crash', 'Worker message could not be read');
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        detachers.set(worker, () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          worker.removeEventListener('messageerror', onMessageError);
        });
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const needed = Math.min(size, items.length);
        while (workers.length < needed) workers.push(createWorker());
        const active = workers.slice(0, needed);
        active.forEach(attach);
        active.forEach(dispatch);
      } catch (error) {
        discardWorkers();
        settle(reject, error);
      }
    });
  }

  return {
    size,
    run,
    dispose() {
      discardWorkers();
    },
  };
}
