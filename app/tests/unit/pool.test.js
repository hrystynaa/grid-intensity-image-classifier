import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkerPool } from '../../src/workers/pool.js';

// Fake worker: answers each task after task.delay ms, or crashes when task.crash is set.
function createFakeFactory() {
  const stats = { created: 0, terminated: 0, active: 0, peak: 0, handledBy: new Map() };
  const createWorker = () => {
    const id = ++stats.created;
    const target = new EventTarget();
    let timer = null;
    return {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      postMessage(task) {
        stats.active++;
        stats.peak = Math.max(stats.peak, stats.active);
        stats.handledBy.set(task.value, id);
        timer = setTimeout(() => {
          stats.active--;
          if (task.crash) {
            const event = new Event('error', { cancelable: true });
            event.message = 'boom';
            target.dispatchEvent(event);
            return;
          }
          const message = new Event('message');
          message.data = task.fail ? { ok: false, reason: 'decode' } : { ok: true, value: task.value * 2 };
          target.dispatchEvent(message);
        }, task.delay ?? 0);
      },
      terminate() {
        if (timer) clearTimeout(timer);
        stats.terminated++;
      },
    };
  };
  return { createWorker, stats };
}

const tasks = (count, extra = () => ({})) => Array.from({ length: count }, (_, value) => ({ value, ...extra(value) }));

describe('worker pool', () => {
  it('rejects an invalid size', () => {
    assert.throws(() => createWorkerPool({ createWorker: () => null, size: 0 }), RangeError);
    assert.throws(() => createWorkerPool({ createWorker: () => null, size: 1.5 }), RangeError);
  });

  it('keeps results in input order when tasks finish out of order', async () => {
    const { createWorker } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 3 });
    const results = await pool.run(tasks(6, (value) => ({ delay: (6 - value) * 4 })));
    assert.deepEqual(results.map((result) => result.value), [0, 2, 4, 6, 8, 10]);
  });

  it('never runs more tasks at once than its size and reports every step', async () => {
    const { createWorker, stats } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 3 });
    const steps = [];
    await pool.run(tasks(12, () => ({ delay: 2 })), { onResult: (_result, _index, done, total) => steps.push([done, total]) });
    assert.equal(stats.peak, 3);
    assert.equal(stats.created, 3);
    assert.deepEqual(steps.map(([done]) => done), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(steps.every(([, total]) => total === 12));
  });

  it('gives queued tasks to whichever worker is free', async () => {
    const { createWorker, stats } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 2 });
    await pool.run(tasks(6, (value) => ({ delay: value === 0 ? 60 : 1 })));
    const slowWorker = stats.handledBy.get(0);
    const others = [1, 2, 3, 4, 5].filter((value) => stats.handledBy.get(value) !== slowWorker);
    assert.equal(others.length, 5);
  });

  it('continues after a failed image', async () => {
    const { createWorker } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 2 });
    const results = await pool.run(tasks(5, (value) => ({ fail: value === 2 })));
    assert.equal(results[2].ok, false);
    assert.equal(results.filter((result) => result.ok).length, 4);
  });

  it('replaces a crashed worker and finishes the queue', async () => {
    const { createWorker, stats } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 2 });
    const results = await pool.run(tasks(8, (value) => ({ crash: value === 1, delay: 1 })));
    assert.equal(results[1].ok, false);
    assert.equal(results[1].reason, 'crash');
    assert.equal(results.filter((result) => result.ok).length, 7);
    assert.equal(stats.created, 3);
  });

  it('finishes when the last task crashes its worker', async () => {
    const { createWorker } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 1 });
    const results = await pool.run(tasks(2, (value) => ({ crash: value === 1 })));
    assert.equal(results[0].ok, true);
    assert.equal(results[1].reason, 'crash');
  });

  it('stops on cancel and can run again', async () => {
    const { createWorker, stats } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 2 });
    const controller = new AbortController();
    const running = pool.run(tasks(6, () => ({ delay: 50 })), { signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await assert.rejects(running, /cancelled/);
    assert.equal(stats.terminated, 2);
    const results = await pool.run(tasks(2));
    assert.equal(results.length, 2);
  });

  it('refuses a second run while busy and handles an empty list', async () => {
    const { createWorker } = createFakeFactory();
    const pool = createWorkerPool({ createWorker, size: 1 });
    assert.deepEqual(await pool.run([]), []);
    const running = pool.run(tasks(1, () => ({ delay: 5 })));
    await assert.rejects(pool.run(tasks(1)), /busy/);
    await running;
  });
});
