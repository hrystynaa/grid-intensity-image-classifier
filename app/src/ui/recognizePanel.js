import { CLASSES, formatLabel } from '../core/classes.js';
import { formatFromName } from '../core/dataset.js';
import { encodeFeatures } from '../core/encoding.js';
import {
  formatAspectRatio,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatFiles,
  formatNumber,
  formatPercent,
} from '../core/format.js';
import { cellBoundaries } from '../core/gridLayout.js';
import { readFileHeader } from '../core/imageHeader.js';
import { indexOfMax, toShares } from '../core/metrics.js';
import { recognitionToCsv } from '../core/resultsExport.js';
import { GRID_SIZES } from '../core/validation.js';
import { byId, element, saveBlob } from './dom.js';
import { exportCanvas } from './imageExport.js';

const SMALL_IMAGE_SIDE = 256;
const MIN_SIDE_FOR_LABEL = 160;
const CHANNEL_LABELS = { 1: '1 (відтінки сірого)', 2: '2 (сірий і прозорість)', 3: '3 (RGB)', 4: '4 (RGBA або CMYK)' };

function drawGrid(context, width, height, cells) {
  const line = Math.max(1, Math.round(Math.max(width, height) / 900));
  const xs = cellBoundaries(width, cells).slice(1, -1);
  const ys = cellBoundaries(height, cells).slice(1, -1);
  context.fillStyle = 'rgb(0 0 0 / 55%)';
  for (const x of xs) context.fillRect(x - line, 0, line * 3, height);
  for (const y of ys) context.fillRect(0, y - line, width, line * 3);
  context.fillStyle = 'rgb(255 255 255 / 90%)';
  for (const x of xs) context.fillRect(x, 0, line, height);
  for (const y of ys) context.fillRect(0, y, width, line);
}

function drawPredictionLabel(context, width, height, text) {
  if (Math.min(width, height) < MIN_SIDE_FOR_LABEL) return;
  const size = Math.max(14, Math.round(Math.max(width, height) / 40));
  const padding = Math.round(size * 0.5);
  const boxHeight = size + padding * 2;
  context.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  context.textBaseline = 'middle';
  const boxWidth = Math.min(width, context.measureText(text).width + padding * 2);
  context.fillStyle = 'rgb(0 0 0 / 72%)';
  context.fillRect(0, height - boxHeight, boxWidth, boxHeight);
  context.fillStyle = '#ffffff';
  context.fillText(text, padding, height - boxHeight / 2, boxWidth - padding * 2);
}

export function initRecognizePanel({ log, progress, toast, gridModel, modelClient, modelState, extractor }) {
  const input = byId('imageInput');
  const dropzone = byId('dropzone');
  const placeholder = byId('dropPlaceholder');
  const canvas = byId('imageCanvas');
  const caption = byId('imageCaption');
  const showGrid = byId('showGrid');
  const viewGrid = byId('viewGridSize');
  const infoButton = byId('infoButton');
  const clearButton = byId('clearImage');
  const saveHint = byId('saveHint');
  const saveButtons = [...document.querySelectorAll('[data-save]')];
  const dialog = byId('infoDialog');
  const infoList = byId('infoList');
  const resultSummary = byId('recognitionSummary');
  const resultButtons = [byId('saveResultCsv'), byId('saveResultJson')];

  let image = null;
  let loadToken = 0;
  let saving = false;
  let prediction = null;
  let recognizeToken = 0;
  let recognizeQueue = Promise.resolve();

  viewGrid.append(...GRID_SIZES.map((size) => element('option', { text: `${size}×${size}`, attrs: { value: size } })));
  viewGrid.value = String(gridModel.get());

  byId('classResults').append(
    ...CLASSES.map((item) =>
      element('li', {}, [
        element('div', { className: 'class-result-head' }, [
          element('span', { text: item.label }),
          element('span', { className: 'class-result-value', text: '—' }),
        ]),
        element('div', { className: 'meter' }, [element('div', { className: 'meter-fill' })]),
      ]),
    ),
  );

  function setControls() {
    const loaded = Boolean(image);
    showGrid.disabled = !loaded;
    viewGrid.disabled = !loaded;
    infoButton.disabled = !loaded;
    infoButton.title = loaded
      ? 'Показати розмір, роздільність, розширення та інші дані файлу'
      : 'Спершу завантажте зображення';
    clearButton.disabled = !loaded;
    saveButtons.forEach((button) => {
      button.disabled = !loaded || saving;
    });
    resultButtons.forEach((button) => {
      button.disabled = !prediction;
    });
    saveHint.textContent = loaded
      ? 'Збережеться те, що показано, разом із сіткою.'
      : 'Спершу завантажте зображення. Збережеться те, що показано, разом із сіткою.';
  }

  function draw() {
    if (!image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.dataset.small = String(Math.max(image.width, image.height) < SMALL_IMAGE_SIDE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image.bitmap, 0, 0);
    if (showGrid.checked) drawGrid(context, image.width, image.height, gridModel.get());
    if (prediction) {
      const best = prediction.bestIndex;
      drawPredictionLabel(context, image.width, image.height, `${CLASSES[best].label} · ${formatPercent(prediction.shares[best])}`);
    }
  }

  function renderPrediction(message) {
    [...byId('classResults').children].forEach((row, index) => {
      const share = prediction?.shares[index];
      row.dataset.best = String(prediction?.bestIndex === index);
      row.querySelector('.class-result-value').textContent = prediction ? formatPercent(share) : '—';
      row.querySelector('.meter-fill').style.transform = `scaleX(${share ?? 0})`;
    });
    if (message) resultSummary.textContent = message;
    else if (prediction) {
      const { bestIndex, gridSize, recognitionMs } = prediction;
      resultSummary.textContent = `Найімовірніше: ${CLASSES[bestIndex].label}. Сітка ${gridSize}×${gridSize}, час ${formatDuration(recognitionMs)}. Відповіді мережі нормовано так, щоб їхня сума дорівнювала 100%.`;
    } else {
      resultSummary.textContent = modelState.get()
        ? 'Модель готова. Завантажте зображення для розпізнавання.'
        : 'Імовірності з’являться після навчання моделі.';
    }
    setControls();
  }

  function recognize() {
    const token = ++recognizeToken;
    const model = modelState.get();
    const current = image;
    prediction = null;
    renderPrediction();
    draw();
    if (!current || !model) return;
    renderPrediction('Розпізнавання…');

    recognizeQueue = recognizeQueue.then(async () => {
      if (token !== recognizeToken) return;
      const task = progress.start({ title: `Розпізнавання «${current.file.name}»`, total: 2, unit: 'кроків', rateUnit: null, secondary: true });
      try {
        const started = performance.now();
        const [features] = await extractor.extract([{ file: current.file }], model.gridSize);
        if (token !== recognizeToken) {
          task.cancelled('Розпізнавання скасовано');
          return;
        }
        if (!features.ok) {
          throw new Error(features.reason === 'tooSmall' ? `зображення менше за сітку ${model.gridSize}×${model.gridSize}` : 'не вдалося обробити файл');
        }
        task.update(1);
        const outputs = await modelClient.predict(encodeFeatures(features.means, model.encoding));
        if (token !== recognizeToken) {
          task.cancelled('Розпізнавання скасовано');
          return;
        }
        const shares = toShares(outputs);
        const bestIndex = indexOfMax(shares);
        prediction = { shares, bestIndex, gridSize: model.gridSize, encoding: model.encoding, recognitionMs: performance.now() - started };
        renderPrediction();
        draw();
        const text = `Розпізнано ${current.file.name}: ${CLASSES[bestIndex].label}, ${formatPercent(shares[bestIndex])}, ${formatDuration(prediction.recognitionMs)}`;
        task.finish(text);
        log.add('success', text);
      } catch (error) {
        if (token !== recognizeToken) return;
        const text = `Не вдалося розпізнати «${current.file.name}»: ${error.message}.`;
        task.fail('Не вдалося розпізнати зображення');
        renderPrediction(text);
        log.add('error', text);
        toast('error', text);
      }
    });
  }

  function saveResult(kind) {
    if (!prediction || !image) return;
    const { shares, bestIndex, gridSize, encoding, recognitionMs } = prediction;
    const result = {
      file: image.file.name,
      width: image.width,
      height: image.height,
      gridSize,
      encoding,
      predicted: CLASSES[bestIndex].id,
      predictedLabel: CLASSES[bestIndex].label,
      shares: Object.fromEntries(CLASSES.map((item, index) => [item.id, shares[index]])),
      recognitionMs,
    };
    const baseName = image.file.name.replace(/\.[^.]+$/, '');
    const fileName = `${baseName}_результат.${kind}`;
    const blob =
      kind === 'csv'
        ? new Blob([recognitionToCsv(result)], { type: 'text/csv;charset=utf-8' })
        : new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    saveBlob(blob, fileName);
    log.add('success', `Результат збережено у ${fileName} (${formatBytes(blob.size)})`);
    toast('success', `Збережено ${fileName}`);
  }

  function clear({ silent = false } = {}) {
    loadToken++;
    recognizeToken++;
    prediction = null;
    image?.bitmap.close();
    image = null;
    canvas.hidden = true;
    canvas.width = 0;
    canvas.height = 0;
    placeholder.hidden = false;
    dropzone.dataset.loaded = 'false';
    dropzone.setAttribute('role', 'button');
    dropzone.tabIndex = 0;
    showGrid.checked = false;
    caption.textContent = 'Зображення ще не завантажено.';
    if (dialog.open) dialog.close();
    renderPrediction();
    if (!silent) log.add('info', 'Зображення очищено');
  }

  function rejectFile(text) {
    log.add('error', text);
    toast('error', text);
  }

  async function loadFile(file) {
    const format = formatFromName(file.name);
    if (!format) {
      rejectFile(`Файл «${file.name}» не підтримується. Оберіть JPG, PNG або BMP.`);
      return;
    }
    if (file.size === 0) {
      rejectFile(`Файл «${file.name}» порожній.`);
      return;
    }

    const token = ++loadToken;
    const task = progress.start({ title: `Завантаження «${file.name}»`, total: 3, unit: 'кроків', rateUnit: null, secondary: true });
    try {
      const header = await readFileHeader(file);
      if (token !== loadToken) return;
      if (!header || header.format !== format) throw new Error('content');
      task.update(1);

      const started = performance.now();
      const bitmap = await createImageBitmap(file);
      const decodeMs = performance.now() - started;
      if (token !== loadToken) {
        bitmap.close();
        return;
      }
      task.update(2);

      image?.bitmap.close();
      image = { file, bitmap, format, header, decodeMs, width: bitmap.width, height: bitmap.height };
      recognizeToken++;
      prediction = null;
      draw();
      canvas.hidden = false;
      placeholder.hidden = true;
      dropzone.dataset.loaded = 'true';
      dropzone.removeAttribute('role');
      dropzone.removeAttribute('tabindex');
      caption.textContent = `${file.name} · ${image.width}×${image.height} · ${formatBytes(file.size)}`;
      setControls();
      task.finish(`Завантажено «${file.name}»`);
      log.add('success', `Завантажено ${file.name}: ${image.width}×${image.height}, ${formatBytes(file.size)}, декодування ${formatDuration(decodeMs)}`);
      recognize();
    } catch (error) {
      if (token !== loadToken) return;
      const text =
        error.message === 'content'
          ? `Вміст файлу «${file.name}» не відповідає його розширенню або файл пошкоджено.`
          : `Не вдалося відкрити «${file.name}». Файл може бути пошкоджено.`;
      task.fail('Не вдалося завантажити зображення');
      rejectFile(text);
    }
  }

  function takeFiles(files) {
    if (!files.length) return;
    if (files.length > 1) {
      const text = `Вибрано ${formatFiles(files.length)}, буде відкрито лише перший.`;
      log.add('warn', text);
      toast('warn', text);
    }
    loadFile(files[0]);
  }

  function showInfo() {
    if (!image) return;
    const { file, header, width, height, format, decodeMs } = image;
    const rows = [
      ['Файл', file.name],
      ['Розширення файлу', file.name.slice(file.name.lastIndexOf('.')).toLowerCase()],
      ['Формат', formatLabel(format)],
      ['MIME-тип', file.type || 'не визначено'],
      ['Розмір файлу', `${formatBytes(file.size)} (${formatNumber(file.size)} байт)`],
      ['Роздільність', `${width} × ${height} px`],
      ['Кількість пікселів', `${formatNumber(width * height)} (${(width * height / 1e6).toFixed(2).replace('.', ',')} Мп)`],
      ['Співвідношення сторін', formatAspectRatio(width, height)],
      ['Кольорові канали', CHANNEL_LABELS[header.channels] ?? String(header.channels)],
      ['Дата зміни', file.lastModified ? formatDateTime(new Date(file.lastModified)) : 'невідома'],
      ['Час декодування', formatDuration(decodeMs)],
    ];
    infoList.replaceChildren(
      ...rows.flatMap(([term, value]) => [element('dt', { text: term }), element('dd', { text: value })]),
    );
    dialog.showModal();
    log.add('info', `Переглянуто інформацію про ${file.name}`);
  }

  async function save(format) {
    if (!image || saving) return;
    saving = true;
    setControls();
    const baseName = image.file.name.replace(/\.[^.]+$/, '');
    const suffix = showGrid.checked ? `_grid${gridModel.get()}` : '_result';
    const fileName = `${baseName}${suffix}.${format}`;
    const task = progress.start({ title: `Збереження ${fileName}`, total: 2, unit: 'кроків', rateUnit: null, secondary: true });
    try {
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      const blob = await exportCanvas(canvas, format);
      task.update(1);
      saveBlob(blob, fileName);
      task.finish(`Збережено ${fileName}`);
      log.add('success', `Збережено ${fileName} (${formatBytes(blob.size)})`);
      toast('success', `Збережено ${fileName}`);
    } catch (error) {
      task.fail('Не вдалося зберегти зображення');
      rejectFile(`Не вдалося зберегти ${fileName}: ${error.message}`);
    } finally {
      saving = false;
      setControls();
    }
  }

  byId('chooseImage').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    takeFiles(files);
  });
  dropzone.addEventListener('click', () => {
    if (!image) input.click();
  });
  dropzone.addEventListener('keydown', (event) => {
    if (!image && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      input.click();
    }
  });
  for (const name of ['dragenter', 'dragover']) {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.dataset.drag = 'true';
    });
  }
  dropzone.addEventListener('dragleave', () => {
    dropzone.dataset.drag = 'false';
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.dataset.drag = 'false';
    takeFiles(Array.from(event.dataTransfer?.files ?? []));
  });

  showGrid.addEventListener('change', () => {
    draw();
    log.add('info', showGrid.checked ? `Показано сітку ${gridModel.get()}×${gridModel.get()}` : 'Сітку приховано');
  });
  viewGrid.addEventListener('change', () => gridModel.set(Number(viewGrid.value)));
  gridModel.subscribe((size) => {
    viewGrid.value = String(size);
    if (showGrid.checked) draw();
  });
  infoButton.addEventListener('click', showInfo);
  clearButton.addEventListener('click', () => clear());
  byId('closeInfo').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  saveButtons.forEach((button) => button.addEventListener('click', () => save(button.dataset.save)));
  byId('saveResultCsv').addEventListener('click', () => saveResult('csv'));
  byId('saveResultJson').addEventListener('click', () => saveResult('json'));
  modelState.subscribe(recognize);

  clear({ silent: true });
}
