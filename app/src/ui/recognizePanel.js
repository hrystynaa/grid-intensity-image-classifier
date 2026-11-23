import { CLASSES, formatLabel } from '../core/classes.js';
import { formatFromName } from '../core/dataset.js';
import {
  formatAspectRatio,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatFiles,
  formatNumber,
} from '../core/format.js';
import { cellBoundaries } from '../core/gridLayout.js';
import { readFileHeader } from '../core/imageHeader.js';
import { GRID_SIZES } from '../core/validation.js';
import { byId, element, saveBlob } from './dom.js';
import { exportCanvas } from './imageExport.js';

const SMALL_IMAGE_SIDE = 256;
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

export function initRecognizePanel({ log, progress, toast, gridModel }) {
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

  let image = null;
  let loadToken = 0;
  let saving = false;

  viewGrid.append(...GRID_SIZES.map((size) => element('option', { text: `${size}×${size}`, attrs: { value: size } })));
  viewGrid.value = String(gridModel.get());

  byId('classResults').append(
    ...CLASSES.map((item) =>
      element('li', {}, [
        element('div', { className: 'class-result-head' }, [
          element('span', { text: item.label }),
          element('span', { className: 'class-result-value', text: '—' }),
        ]),
        element('div', { className: 'meter' }),
      ]),
    ),
  );

  function setControls() {
    const loaded = Boolean(image);
    showGrid.disabled = !loaded;
    viewGrid.disabled = !loaded;
    infoButton.disabled = !loaded;
    clearButton.disabled = !loaded;
    saveButtons.forEach((button) => {
      button.disabled = !loaded || saving;
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
  }

  function clear({ silent = false } = {}) {
    loadToken++;
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
    setControls();
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
    const task = progress.start({ title: `Завантаження «${file.name}»`, total: 3, unit: 'кроків', rateUnit: null });
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
    const task = progress.start({ title: `Збереження ${fileName}`, total: 2, unit: 'кроків', rateUnit: null });
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

  clear({ silent: true });
}
