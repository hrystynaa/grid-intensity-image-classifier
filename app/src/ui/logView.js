import { formatClock } from '../core/format.js';
import { LOG_LEVELS } from '../core/operationLog.js';
import { byId, element, saveBlob } from './dom.js';

const MAX_RENDERED = 300;

export function initLogView(log, toast) {
  const list = byId('logList');
  const empty = byId('logEmpty');
  const filter = byId('logFilter');

  function render() {
    const selected = filter.value;
    const visible = log.entries().filter((entry) => selected === 'all' || entry.level === selected);
    const shown = visible.slice(-MAX_RENDERED);
    list.replaceChildren(
      ...shown.map((entry) =>
        element('li', { className: 'log-entry', attrs: { 'data-level': entry.level } }, [
          element('time', { className: 'log-time', text: formatClock(entry.time) }),
          element('span', { className: 'log-message' }, [
            element('span', { className: 'visually-hidden', text: `${LOG_LEVELS[entry.level]}: ` }),
            entry.message,
          ]),
        ]),
      ),
    );
    empty.hidden = shown.length > 0;
    list.scrollTop = list.scrollHeight;
  }

  log.subscribe(render);
  filter.addEventListener('change', render);
  byId('clearLog').addEventListener('click', () => log.clear());
  byId('saveLog').addEventListener('click', () => {
    if (!log.entries().length) {
      toast('warn', 'Журнал порожній, зберігати нічого.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `lumagrid-log-${stamp}.log`;
    saveBlob(new Blob(['﻿', log.toText(), '\r\n'], { type: 'text/plain;charset=utf-8' }), fileName);
    log.add('success', `Журнал збережено у файл ${fileName}`);
  });
  render();
}
