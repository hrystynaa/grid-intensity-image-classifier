import { CLASSES, GROUPS, classLabel } from './classes.js';
import { formatImages } from './format.js';
import { readFileHeader } from './imageHeader.js';

export const MIN_RECOMMENDED_IMAGES = 250;
const MAX_CLASS_IMBALANCE = 1.5;
const EXTENSION_FORMATS = { jpg: 'jpg', jpeg: 'jpg', png: 'png', bmp: 'bmp' };
const CLASS_IDS = new Set(CLASSES.map((c) => c.id));

export function formatFromName(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : (EXTENSION_FORMATS[name.slice(dot + 1).toLowerCase()] ?? null);
}

// Accepted layouts: root/group/class/file and group/class/file.
export function parseDatasetPath(relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const folders = parts.slice(0, -1);
  if (folders.some((name) => name.startsWith('_') || name.startsWith('.'))) return { reason: 'service' };
  const format = formatFromName(parts.at(-1) ?? '');
  if (!format) return { reason: 'unsupported' };
  if (folders.length !== 2 && folders.length !== 3) return { reason: 'structure' };
  const [group, classId] = folders.slice(-2);
  if (!CLASS_IDS.has(classId)) return { reason: 'unknownClass' };
  return { group, classId, format };
}

export function buildDataset(files) {
  const entries = [];
  const ignored = { service: 0, unsupported: 0, structure: 0, unknownClass: 0 };
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parsed = parseDatasetPath(path);
    if (parsed.reason) ignored[parsed.reason]++;
    else entries.push({ file, path, size: file.size, ...parsed });
  }
  const first = files[0]?.webkitRelativePath?.split('/')[0] ?? '';
  return { rootName: first, entries, ignored };
}

export async function scanEntries(entries, { concurrency = 8, onProgress, signal } = {}) {
  const results = new Array(entries.length);
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      signal?.throwIfAborted();
      const index = cursor++;
      const entry = entries[index];
      let header = null;
      try {
        header = await readFileHeader(entry.file);
      } catch {
        header = null;
      }
      results[index] =
        header?.format === entry.format
          ? { ...entry, width: header.width, height: header.height, channels: header.channels }
          : { ...entry, broken: true };
      onProgress?.(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  signal?.throwIfAborted();
  return {
    valid: results.filter((entry) => !entry.broken),
    broken: results.filter((entry) => entry.broken),
  };
}

export function filterEntries(entries, { groups, formats }) {
  return entries.filter((entry) => groups.has(entry.group) && formats.has(entry.format));
}

function resolutionLabel(entries) {
  const sized = entries.filter((entry) => entry.width);
  if (!sized.length) return '—';
  const sizes = new Set(sized.map((entry) => `${entry.width}×${entry.height}`));
  if (sizes.size === 1) return [...sizes][0];
  const sides = sized.map((entry) => Math.max(entry.width, entry.height));
  const min = Math.min(...sides);
  const max = Math.max(...sides);
  return min === max ? `${max} px` : `${min}–${max} px`;
}

export function summarizeGroups(entries) {
  const known = GROUPS.map((group) => group.id);
  const ids = [...new Set(entries.map((entry) => entry.group))].sort((a, b) => {
    const [ia, ib] = [known.indexOf(a), known.indexOf(b)];
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  return ids.map((id) => {
    const items = entries.filter((entry) => entry.group === id);
    return {
      id,
      total: items.length,
      bytes: items.reduce((sum, entry) => sum + entry.size, 0),
      resolution: resolutionLabel(items),
      counts: Object.fromEntries(CLASSES.map((c) => [c.id, items.filter((e) => e.classId === c.id).length])),
    };
  });
}

export function countFormats(entries) {
  const counts = { jpg: 0, png: 0, bmp: 0 };
  for (const entry of entries) counts[entry.format]++;
  return counts;
}

export function summarizeSelection(entries) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c.id, 0]));
  let bytes = 0;
  for (const entry of entries) {
    counts[entry.classId]++;
    bytes += entry.size;
  }
  return { total: entries.length, bytes, counts };
}

export function selectionStatus({ total, counts }) {
  if (total === 0) return { level: 'error', canTrain: false, message: 'Оберіть принаймні одну групу та один формат.' };
  const present = CLASSES.filter((c) => counts[c.id] > 0);
  if (present.length < 2) {
    return { level: 'error', canTrain: false, message: 'Для навчання потрібно щонайменше два класи зображень.' };
  }
  const missing = CLASSES.filter((c) => counts[c.id] === 0).map((c) => classLabel(c.id));
  if (missing.length) {
    return { level: 'warn', canTrain: true, message: `Немає зображень класу: ${missing.join(', ')}.` };
  }
  if (total <= MIN_RECOMMENDED_IMAGES) {
    return {
      level: 'warn',
      canTrain: true,
      message: `Обрано ${formatImages(total)}. Для репрезентативного навчання потрібно понад ${MIN_RECOMMENDED_IMAGES}.`,
    };
  }
  const values = present.map((c) => counts[c.id]);
  if (Math.max(...values) > Math.min(...values) * MAX_CLASS_IMBALANCE) {
    return { level: 'warn', canTrain: true, message: 'Класи суттєво відрізняються за кількістю зображень.' };
  }
  return { level: 'ok', canTrain: true, message: 'Набір готовий до навчання.' };
}
