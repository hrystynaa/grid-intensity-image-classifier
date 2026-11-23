import { CLASSES, FORMATS, groupLabel } from '../core/classes.js';
import {
  buildDataset,
  countFormats,
  filterEntries,
  scanEntries,
  selectionStatus,
  summarizeGroups,
  summarizeSelection,
} from '../core/dataset.js';
import { formatBytes, formatDuration, formatFiles, formatImages, formatNumber } from '../core/format.js';
import { byId, element } from './dom.js';

const IGNORED_LABELS = {
  service: 'службових',
  unsupported: 'непідтримуваних',
  structure: 'поза структурою папок',
  unknownClass: 'з невідомих класів',
};

export function initDataPanel({ log, progress, toast, onSelectionChange, onContinue }) {
  const input = byId('folderInput');
  const status = byId('folderStatus');
  const allGroups = byId('allGroups');
  const groupsEmpty = byId('groupsEmpty');
  const groupsWrap = byId('groupsWrap');
  const groupsHead = byId('groupsHead');
  const groupsBody = byId('groupsBody');
  const formatFilters = byId('formatFilters');
  const message = byId('selectionMessage');
  const continueButton = byId('toTraining');

  let entries = [];
  let selection = { groups: new Set(), formats: new Set() };
  let controller = null;

  groupsHead.append(
    ...['Група', 'Роздільність', ...CLASSES.map((c) => c.label), 'Усього', 'Обсяг'].map((text) =>
      element('th', { text, attrs: { scope: 'col' } }),
    ),
  );

  function publish() {
    const selected = filterEntries(entries, selection);
    const summary = summarizeSelection(selected);
    const state = selectionStatus(summary);
    byId('selTotal').textContent = formatNumber(summary.total);
    byId('selBytes').textContent = formatBytes(summary.bytes);
    byId('selClasses').textContent = String(CLASSES.filter((c) => summary.counts[c.id] > 0).length);
    message.dataset.level = entries.length ? state.level : 'idle';
    message.textContent = entries.length ? state.message : 'Оберіть папку, щоб сформувати набір.';
    continueButton.disabled = !state.canTrain;
    onSelectionChange({ ...summary, ...state, entries: selected, groups: [...selection.groups] });
  }

  function renderGroups() {
    const rows = summarizeGroups(entries);
    groupsBody.replaceChildren(
      ...rows.map((row) => {
        const checkbox = element('input', { attrs: { type: 'checkbox', 'data-group': row.id } });
        checkbox.checked = selection.groups.has(row.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selection.groups.add(row.id);
          else selection.groups.delete(row.id);
          log.add('info', `Групу «${groupLabel(row.id)}» ${checkbox.checked ? 'додано до набору' : 'вилучено з набору'}`);
          syncChecks();
          publish();
        });
        const name = element('label', { className: 'check' }, [checkbox, groupLabel(row.id)]);
        return element('tr', { attrs: { 'data-group-row': row.id } }, [
          element('td', {}, [name]),
          element('td', { text: row.resolution }),
          ...CLASSES.map((c) => element('td', { text: formatNumber(row.counts[c.id]) })),
          element('td', { text: formatNumber(row.total) }),
          element('td', { text: formatBytes(row.bytes) }),
        ]);
      }),
    );
    groupsEmpty.hidden = rows.length > 0;
    groupsWrap.hidden = rows.length === 0;
    allGroups.disabled = rows.length === 0;
    syncChecks();
  }

  function syncChecks() {
    const ids = summarizeGroups(entries).map((row) => row.id);
    const count = ids.filter((id) => selection.groups.has(id)).length;
    allGroups.checked = ids.length > 0 && count === ids.length;
    allGroups.indeterminate = count > 0 && count < ids.length;
    for (const row of groupsBody.querySelectorAll('tr')) {
      row.dataset.off = String(!selection.groups.has(row.dataset.groupRow));
    }
  }

  function renderFormats() {
    const counts = countFormats(entries);
    formatFilters.disabled = entries.length === 0;
    const legend = formatFilters.querySelector('legend');
    formatFilters.replaceChildren(
      legend,
      ...FORMATS.map((format) => {
        const checkbox = element('input', { attrs: { type: 'checkbox', 'data-format': format.id } });
        checkbox.checked = selection.formats.has(format.id);
        checkbox.disabled = counts[format.id] === 0;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selection.formats.add(format.id);
          else selection.formats.delete(format.id);
          log.add('info', `Формат ${format.label} ${checkbox.checked ? 'увімкнено' : 'вимкнено'}`);
          publish();
        });
        return element('label', { className: 'check' }, [
          checkbox,
          format.label,
          element('span', { className: 'count', text: `(${formatNumber(counts[format.id])})` }),
        ]);
      }),
    );
  }

  function applyEntries(next, folderText) {
    entries = next;
    selection = {
      groups: new Set(entries.map((entry) => entry.group)),
      formats: new Set(entries.map((entry) => entry.format)),
    };
    status.textContent = folderText;
    renderGroups();
    renderFormats();
    publish();
  }

  async function loadFolder(files) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const dataset = buildDataset(files);
    const ignoredText = Object.entries(dataset.ignored)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${IGNORED_LABELS[reason]}: ${formatNumber(count)}`)
      .join(', ');

    log.add('info', `Обрано папку «${dataset.rootName}»: ${formatFiles(files.length)}`);
    if (ignoredText) log.add('warn', `Пропущено файлів: ${ignoredText}`);

    if (!dataset.entries.length) {
      const text = 'У папці немає зображень у структурі «група / клас / файл» для класів lake, snowfield, starry_sky.';
      log.add('error', text);
      toast('error', text);
      applyEntries([], text);
      return;
    }

    const task = progress.start({
      title: `Перевірка зображень у папці «${dataset.rootName}»`,
      total: dataset.entries.length,
      onCancel: () => current.abort(),
    });

    try {
      const { valid, broken } = await scanEntries(dataset.entries, {
        signal: current.signal,
        onProgress: (done) => task.update(done),
      });
      const elapsed = formatDuration(performance.now() - task.startedAt);
      const checked = `Перевірено ${formatImages(dataset.entries.length)} за ${elapsed}`;
      task.finish(checked);
      log.add('success', checked);
      if (broken.length) {
        const text = `Пошкоджених або неправильних файлів: ${formatNumber(broken.length)}. Їх не буде використано.`;
        log.add('warn', text);
        toast('warn', text);
        for (const entry of broken.slice(0, 10)) log.add('warn', `Файл пропущено: ${entry.path}`);
      }
      if (!valid.length) {
        const text = 'У папці немає жодного придатного зображення.';
        log.add('error', text);
        toast('error', text);
      }
      const parts = [`Папка «${dataset.rootName}»: придатних зображень ${formatNumber(valid.length)}`];
      if (broken.length) parts.push(`пошкоджених: ${formatNumber(broken.length)}`);
      if (ignoredText) parts.push(`пропущено файлів (${ignoredText})`);
      applyEntries(valid, `${parts.join(' · ')}.`);
    } catch (error) {
      if (current.signal.aborted) {
        if (controller === current) {
          task.cancelled('Перевірку зображень скасовано');
          log.add('warn', 'Перевірку зображень скасовано');
        }
        return;
      }
      task.fail('Не вдалося перевірити папку');
      log.add('error', `Не вдалося перевірити папку: ${error.message}`);
      toast('error', 'Не вдалося перевірити папку.');
    }
  }

  byId('folderButton').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) loadFolder(files);
  });
  allGroups.addEventListener('change', () => {
    const ids = summarizeGroups(entries).map((row) => row.id);
    selection.groups = new Set(allGroups.checked ? ids : []);
    for (const box of groupsBody.querySelectorAll('input[data-group]')) box.checked = allGroups.checked;
    log.add('info', allGroups.checked ? 'Обрано всі групи якості' : 'Зняли вибір з усіх груп якості');
    syncChecks();
    publish();
  });
  continueButton.addEventListener('click', onContinue);
  renderFormats();
  publish();
}
