import { formatDateTime } from './format.js';

export const LOG_LEVELS = {
  info: 'Інфо',
  success: 'Успіх',
  warn: 'Увага',
  error: 'Помилка',
};

export function createOperationLog({ limit = 5000, now = () => new Date() } = {}) {
  let entries = [];
  let nextId = 1;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(entries));

  return {
    add(level, message) {
      if (!LOG_LEVELS[level]) throw new RangeError(`Unknown log level: ${level}`);
      const entry = { id: nextId++, time: now(), level, message };
      entries = [...entries, entry].slice(-limit);
      notify();
      return entry;
    },
    clear() {
      entries = [];
      notify();
    },
    entries: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toText() {
      return entries
        .map((entry) => `${formatDateTime(entry.time)} [${entry.level.toUpperCase()}] ${entry.message}`)
        .join('\r\n');
    },
  };
}
