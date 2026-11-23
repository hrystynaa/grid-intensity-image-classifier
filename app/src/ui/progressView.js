import { formatDuration, formatNumber } from '../core/format.js';
import { computeProgress } from '../core/progress.js';
import { byId } from './dom.js';

const TICK_MS = 100;

export function createProgressView() {
  const card = byId('progressCard');
  const title = byId('progressTitle');
  const bar = byId('progressBar');
  const fill = byId('progressFill');
  const count = byId('progressCount');
  const elapsed = byId('progressElapsed');
  const eta = byId('progressEta');
  const rate = byId('progressRate');
  const cancel = byId('cancelTask');
  let current = null;
  let timer = null;

  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  function render(task) {
    const elapsedMs = (task.endedAt ?? performance.now()) - task.startedAt;
    const state = computeProgress({ done: task.done, total: task.total, elapsedMs });
    fill.style.transform = `scaleX(${state.fraction})`;
    bar.setAttribute('aria-valuenow', String(state.percent));
    bar.setAttribute('aria-valuetext', `${task.done} із ${task.total} ${task.unit}, ${state.percent}%`);
    count.textContent = `${formatNumber(task.done)} із ${formatNumber(task.total)} ${task.unit} · ${state.percent}%`;
    elapsed.textContent = formatDuration(elapsedMs);
    eta.textContent = task.endedAt ? '—' : formatDuration(state.etaMs);
    rate.textContent =
      task.rateUnit && state.ratePerSecond > 0 ? `${formatRate(state.ratePerSecond)} ${task.rateUnit}/с` : '—';
  }

  const formatRate = (value) => (value >= 100 ? formatNumber(Math.round(value)) : value.toFixed(1).replace('.', ','));

  function end(task, state, message) {
    if (!task.active) return;
    task.active = false;
    task.endedAt = performance.now();
    stopTimer();
    cancel.hidden = true;
    card.dataset.state = state;
    title.textContent = message;
    render(task);
  }

  cancel.addEventListener('click', () => current?.onCancel?.());

  return {
    // A secondary task never takes the progress card away from a running operation.
    start({ title: taskTitle, total, unit = 'зображень', rateUnit = 'зобр.', onCancel, secondary = false }) {
      if (secondary && current?.active) {
        const noop = () => {};
        return { startedAt: performance.now(), update: noop, finish: noop, fail: noop, cancelled: noop };
      }
      if (current) current.active = false;
      stopTimer();
      const task = {
        total,
        unit,
        rateUnit,
        onCancel,
        done: 0,
        active: true,
        startedAt: performance.now(),
        endedAt: null,
        update(done) {
          if (task.active) task.done = Math.min(done, total);
        },
        finish(message) {
          if (task.active) task.done = total;
          end(task, 'done', message);
        },
        fail(message) {
          end(task, 'error', message);
        },
        cancelled(message) {
          end(task, 'cancelled', message);
        },
      };
      current = task;
      card.dataset.state = 'running';
      title.textContent = taskTitle;
      cancel.hidden = !onCancel;
      render(task);
      timer = setInterval(() => render(task), TICK_MS);
      return task;
    },
  };
}
