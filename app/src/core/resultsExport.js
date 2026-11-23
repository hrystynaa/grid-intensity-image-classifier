import { CLASSES } from './classes.js';
import { encodingLabel } from './encoding.js';

const BOM = '﻿';
const SEPARATOR = ';';
const LINE_END = '\r\n';

// Text starting with these characters would run as a formula when opened in a spreadsheet.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value).replace('.', ',');
  const text = FORMULA_START.test(String(value)) ? `'${value}` : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((column) => csvCell(column.title)).join(SEPARATOR)];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column.key])).join(SEPARATOR));
  return BOM + lines.join(LINE_END) + LINE_END;
}

export const RUN_COLUMNS = [
  { key: 'number', title: 'Запуск' },
  { key: 'finishedAt', title: 'Завершено' },
  { key: 'groups', title: 'Групи якості' },
  { key: 'trainImages', title: 'Зображень у навчанні' },
  { key: 'validationImages', title: 'Зображень у перевірці' },
  { key: 'testImagesHeldOut', title: 'Відкладено для тесту' },
  { key: 'gridSize', title: 'Сітка' },
  { key: 'encoding', title: 'Кодування яскравості' },
  { key: 'hiddenNeurons', title: 'Прихований шар' },
  { key: 'epochsDone', title: 'Виконано епох' },
  { key: 'epochs', title: 'Задано епох' },
  { key: 'learningRate', title: 'Швидкість навчання' },
  { key: 'seed', title: 'Зерно' },
  { key: 'featuresComputed', title: 'Обчислено ознак для зображень' },
  { key: 'featuresReused', title: 'Узято ознак із памʼяті' },
  { key: 'featureMs', title: 'Час ознак, мс' },
  { key: 'trainMs', title: 'Час навчання, мс' },
  { key: 'finalError', title: 'Помилка' },
  { key: 'trainAccuracy', title: 'Точність на навчанні' },
  { key: 'validationAccuracy', title: 'Точність на перевірці' },
  { key: 'stopped', title: 'Зупинено вручну' },
];

export const runsToCsv = (runs) =>
  toCsv(RUN_COLUMNS, runs.map((run) => ({
    ...run,
    groups: run.groups.join(', '),
    encoding: encodingLabel(run.encoding),
    stopped: run.stopped ? 'так' : 'ні',
  })));

export function recognitionToCsv(result) {
  const columns = [
    { key: 'file', title: 'Файл' },
    { key: 'width', title: 'Ширина' },
    { key: 'height', title: 'Висота' },
    { key: 'gridSize', title: 'Сітка' },
    { key: 'encoding', title: 'Кодування яскравості' },
    { key: 'predictedLabel', title: 'Результат' },
    ...CLASSES.map((item) => ({ key: item.id, title: `Частка: ${item.label}` })),
    { key: 'recognitionMs', title: 'Час, мс' },
  ];
  return toCsv(columns, [{ ...result, ...result.shares, encoding: encodingLabel(result.encoding) }]);
}
