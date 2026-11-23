import { CLASSES, classLabel, groupLabel } from '../core/classes.js';
import { ENCODINGS, encodeFeatures, encodingLabel, encodingShortLabel, inputCount } from '../core/encoding.js';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatImages,
  formatMetric,
  formatNumber,
  formatPercent,
  pluralUk,
} from '../core/format.js';
import { createModelFile, parseModelFile } from '../core/modelFile.js';
import { runsToCsv } from '../core/resultsExport.js';
import { splitByPhoto } from '../core/split.js';
import { GRID_SIZES, isRateTooHigh, recommendedLearningRate, validateTrainingParams } from '../core/validation.js';
import { byId, element, saveBlob } from './dom.js';
import { createErrorChart } from './errorChart.js';

const TRAINING_SEED = 2026;
const MAX_LOGGED_FAILURES = 10;
const FIELDS = ['epochs', 'learningRate', 'gridSize', 'encoding', 'hiddenNeurons'];
const FIELD_LABELS = {
  epochs: 'Кількість епох',
  learningRate: 'Швидкість навчання',
  gridSize: 'Розмір сітки',
  encoding: 'Кодування яскравості',
  hiddenNeurons: 'Нейронів у прихованому шарі',
};
const FAILURE_LABELS = {
  decode: 'не вдалося декодувати',
  tooSmall: 'зображення менше за сітку',
  crash: 'збій обробника',
};
const CLASS_INDEX = Object.fromEntries(CLASSES.map((item, index) => [item.id, index]));

const cacheKey = (entry, cells) => `${entry.path}|${entry.size}|${entry.file.lastModified}|${cells}`;

const isConfusion = (matrix) =>
  Array.isArray(matrix) &&
  matrix.length === CLASSES.length &&
  matrix.every((row) => Array.isArray(row) && row.length === CLASSES.length && row.every(Number.isInteger));

export function initTrainPanel({ log, progress, toast, gridModel, modelClient, modelState, extractor }) {
  const form = byId('trainForm');
  const dataset = byId('trainDataset');
  const summary = byId('networkSummary');
  const gridSelect = byId('gridSize');
  const encodingSelect = byId('encoding');
  const startButton = byId('startTraining');
  const stopButton = byId('stopTraining');
  const saveModelButton = byId('saveModel');
  const loadModelButton = byId('loadModel');
  const modelInput = byId('modelInput');
  const saveCsvButton = byId('saveRunsCsv');
  const saveJsonButton = byId('saveRunsJson');
  const rateField = byId('learningRate');
  const rateWarning = byId('learningRate-warning');
  const rateWarningText = byId('learningRate-warning-text');
  const applyRateButton = byId('applyRate');
  const chart = createErrorChart({ container: byId('errorChart'), empty: byId('errorChartEmpty') });

  const featureCache = new Map();
  const runs = [];
  let selection = null;
  let running = null;
  let rateEdited = false;

  gridSelect.append(
    ...GRID_SIZES.map((size) => element('option', { text: `${size}×${size} (${size * size} ознак)`, attrs: { value: size } })),
  );
  gridSelect.value = String(gridModel.get());
  encodingSelect.append(...ENCODINGS.map((item) => element('option', { text: item.label, attrs: { value: item.id } })));

  const readValues = () => Object.fromEntries(FIELDS.map((name) => [name, byId(name).value]));

  function setControls(result = validateTrainingParams(readValues())) {
    const busy = Boolean(running);
    startButton.disabled = busy || !result.valid || !selection?.canTrain;
    stopButton.disabled = !busy || running?.stopping === true;
    loadModelButton.disabled = busy;
    saveModelButton.disabled = busy || !modelState.get();
    saveCsvButton.disabled = !runs.length;
    saveJsonButton.disabled = !runs.length;
    for (const name of FIELDS) byId(name).disabled = busy;
    applyRateButton.disabled = busy;
  }

  function renderRateWarning({ learningRate, gridSize, encoding }) {
    const tooHigh =
      learningRate !== undefined && gridSize !== undefined && encoding !== undefined && isRateTooHigh(learningRate, gridSize, encoding);
    rateWarning.hidden = !tooHigh;
    if (tooHigh) {
      const suggested = String(recommendedLearningRate(gridSize, encoding)).replace('.', ',');
      rateWarningText.textContent = `Для сітки ${gridSize}×${gridSize} і цього кодування швидкість завелика: точність може суттєво знизитися. Рекомендовано ${suggested}.`;
    }
  }

  function applyRecommendedRate() {
    const gridSize = gridModel.get();
    const encoding = encodingSelect.value;
    const rate = recommendedLearningRate(gridSize, encoding);
    rateEdited = false;
    if (Number(rateField.value) === rate) return;
    rateField.value = String(rate);
    log.add('info', `Швидкість навчання для сітки ${gridSize}×${gridSize}, ${encodingLabel(encoding).toLowerCase()}: ${String(rate).replace('.', ',')}`);
  }

  function syncRate() {
    if (!rateEdited && !running) applyRecommendedRate();
  }

  function validate() {
    const result = validateTrainingParams(readValues());
    for (const name of FIELDS) {
      const field = byId(name);
      const error = byId(`${name}-error`);
      const message = result.errors[name];
      error.hidden = !message;
      error.textContent = message ?? '';
      if (message) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    if (result.valid) {
      const { gridSize, encoding, hiddenNeurons } = result.values;
      const inputs = inputCount(gridSize, encoding);
      const inputsText = `${formatNumber(inputs)} ${pluralUk(inputs, 'вхід', 'входи', 'входів')}`;
      summary.textContent = hiddenNeurons
        ? `Мережа: ${inputsText} → ${hiddenNeurons} прихованих → 3 виходи`
        : `Мережа: ${inputsText} → 3 виходи (один шар)`;
    } else {
      summary.textContent = 'Виправте параметри, позначені червоним.';
    }
    renderRateWarning(result.values);
    setControls(result);
    return result;
  }

  function renderConfusion(matrix) {
    const wrap = byId('confusionWrap');
    wrap.hidden = !isConfusion(matrix);
    if (wrap.hidden) return;
    byId('confusionHead').replaceChildren(
      element('th', { text: 'Справжній клас', attrs: { scope: 'col' } }),
      ...CLASSES.map((item) => element('th', { text: item.label, attrs: { scope: 'col' } })),
    );
    byId('confusionBody').replaceChildren(
      ...matrix.map((row, rowIndex) =>
        element('tr', {}, [
          element('th', { text: CLASSES[rowIndex].label, attrs: { scope: 'row' } }),
          ...row.map((value, columnIndex) =>
            element('td', { text: formatNumber(value), attrs: { 'data-correct': String(rowIndex === columnIndex) } }),
          ),
        ]),
      ),
    );
  }

  function renderResult(model) {
    byId('resultEmpty').hidden = Boolean(model);
    byId('resultBody').hidden = !model;
    if (!model) return;
    const training = model.training ?? {};
    byId('resultValidation').textContent = formatPercent(training.validationAccuracy);
    byId('resultTrain').textContent = formatPercent(training.trainAccuracy);
    byId('resultTime').textContent = formatDuration(training.trainMs);
    const hidden = model.hiddenNeurons ? `, прихований шар ${model.hiddenNeurons}` : ', один шар';
    const parts = [
      `Сітка ${model.gridSize}×${model.gridSize}${hidden}, ${encodingLabel(model.encoding).toLowerCase()}.`,
      `Епох: ${formatNumber(training.epochsDone ?? 0)}, швидкість ${String(training.learningRate ?? '—').replace('.', ',')}.`,
      `Навчання: ${formatImages(training.trainImages ?? 0)}, перевірка: ${formatImages(training.validationImages ?? 0)}.`,
      `Тестова частина (${formatImages(training.testImagesHeldOut ?? 0)}) у навчанні не використовувалась.`,
    ];
    if (training.stopped) parts.push('Навчання зупинено вручну.');
    if (model.loadedFrom) parts.push(`Показники взято з файлу «${model.loadedFrom}».`);
    byId('resultNote').textContent = parts.join(' ');
    renderConfusion(training.validationConfusion);
  }

  function renderRuns() {
    byId('runsEmpty').hidden = runs.length > 0;
    byId('runsWrap').hidden = runs.length === 0;
    byId('runsBody').replaceChildren(
      ...[...runs].reverse().map((run) =>
        element('tr', {}, [
          element('td', { text: String(run.number) }),
          element('td', { text: run.groups.map(groupLabel).join(', ') }),
          element('td', { text: `${formatNumber(run.trainImages)} / ${formatNumber(run.validationImages)}` }),
          element('td', { text: `${run.gridSize}×${run.gridSize}` }),
          element('td', { text: encodingShortLabel(run.encoding) }),
          element('td', { text: run.hiddenNeurons ? String(run.hiddenNeurons) : 'немає' }),
          element('td', { text: run.stopped ? `${formatNumber(run.epochsDone)} із ${formatNumber(run.epochs)}` : formatNumber(run.epochs) }),
          element('td', { text: String(run.learningRate).replace('.', ',') }),
          element('td', { text: run.featuresComputed ? formatDuration(run.featureMs) : 'з памʼяті' }),
          element('td', { text: formatDuration(run.trainMs) }),
          element('td', { text: formatMetric(run.finalError) }),
          element('td', { text: formatPercent(run.validationAccuracy) }),
        ]),
      ),
    );
  }

  async function computeFeatures(entries, cells, signal, onCancel) {
    const missing = entries.filter((entry) => !featureCache.has(cacheKey(entry, cells)));
    const reused = entries.length - missing.length;
    const task = progress.start({ title: `Обчислення ознак, сітка ${cells}×${cells}`, total: entries.length, onCancel });
    task.update(reused);
    const started = performance.now();
    try {
      const results = await extractor.extract(missing, cells, {
        signal,
        onProgress: (done) => task.update(reused + done),
      });
      const failures = [];
      results.forEach((result, index) => {
        if (result.ok) featureCache.set(cacheKey(missing[index], cells), result.means);
        else failures.push({ entry: missing[index], result });
      });
      const featureMs = performance.now() - started;
      const computed = missing.length - failures.length;
      const text = `Ознаки готові: обчислено ${formatImages(computed)} за ${formatDuration(featureMs)}, з памʼяті ${formatNumber(reused)}`;
      task.finish(text);
      log.add('success', `${text}, воркерів: ${extractor.size}`);
      if (failures.length) {
        log.add('warn', `Не вдалося обробити зображень: ${formatNumber(failures.length)}. Їх не буде використано.`);
        for (const { entry, result } of failures.slice(0, MAX_LOGGED_FAILURES)) {
          log.add('warn', `Файл пропущено (${FAILURE_LABELS[result.reason] ?? 'помилка обробки'}): ${entry.path}`);
        }
      }
      return { featureMs, computed, reused };
    } catch (error) {
      if (signal.aborted) task.cancelled('Обчислення ознак скасовано');
      else task.fail('Не вдалося обчислити ознаки');
      throw error;
    }
  }

  // The cache keeps raw cell means, so changing the encoding does not recompute them.
  const toSamples = (entries, cells, encoding) =>
    entries.flatMap((entry) => {
      const means = featureCache.get(cacheKey(entry, cells));
      return means ? [{ means: encodeFeatures(means, encoding), classIndex: CLASS_INDEX[entry.classId] }] : [];
    });

  function requestStop() {
    if (!running || running.stopping) return;
    running.stopping = true;
    setControls();
    if (running.stage === 'features') running.controller.abort();
    else {
      log.add('info', 'Зупинка навчання після поточної епохи');
      modelClient.stop();
    }
  }

  async function startTraining() {
    const check = validate();
    if (running || !check.valid || !selection?.canTrain) return;
    const { epochs, learningRate, gridSize, encoding, hiddenNeurons } = check.values;
    const snapshot = selection;
    const controller = new AbortController();
    running = { stage: 'features', controller, stopping: false };
    setControls();
    let task = null;

    try {
      const parts = splitByPhoto(snapshot.entries, { seed: TRAINING_SEED });
      const used = [...parts.train, ...parts.validation];
      log.add(
        'info',
        `Поділ за вихідними фото: навчання ${formatNumber(parts.train.length)}, перевірка ${formatNumber(parts.validation.length)}, відкладено для тесту ${formatNumber(parts.test.length)}`,
      );
      const features = await computeFeatures(used, gridSize, controller.signal, requestStop);
      const train = toSamples(parts.train, gridSize, encoding);
      const validation = toSamples(parts.validation, gridSize, encoding);
      if (new Set(train.map((sample) => sample.classIndex)).size < 2) {
        throw new Error('У навчальній частині менше двох класів із придатними зображеннями.');
      }

      running.stage = 'training';
      chart.start(epochs);
      task = progress.start({ title: 'Навчання мережі', total: epochs, unit: 'епох', rateUnit: 'епох', onCancel: requestStop });
      log.add('info', `Навчання: ${formatNumber(epochs)} епох, швидкість ${String(learningRate).replace('.', ',')}, сітка ${gridSize}×${gridSize}, ${encodingLabel(encoding).toLowerCase()}, прихованих нейронів: ${hiddenNeurons}`);

      const result = await modelClient.train({
        train,
        validation,
        config: { classCount: CLASSES.length, hiddenNeurons, epochs, learningRate, seed: TRAINING_SEED },
        onEpoch: ({ epoch, error }) => {
          task.update(epoch);
          chart.add(epoch, error);
        },
      });

      task.update(result.epochsDone);
      const finishedAt = formatDateTime(new Date());
      const training = {
        groups: snapshot.groups,
        encoding,
        trainImages: train.length,
        validationImages: validation.length,
        testImagesHeldOut: parts.test.length,
        epochs,
        epochsDone: result.epochsDone,
        learningRate,
        seed: TRAINING_SEED,
        trainMs: result.trainMs,
        finalError: result.finalError,
        trainAccuracy: result.trainMetrics.accuracy,
        validationAccuracy: result.validationMetrics.accuracy,
        validationConfusion: result.validationMetrics.confusion,
        stopped: result.stopped,
        finishedAt,
      };
      const run = {
        ...training,
        number: runs.length + 1,
        gridSize,
        hiddenNeurons,
        featureMs: features.featureMs,
        featuresComputed: features.computed,
        featuresReused: features.reused,
        history: result.history,
      };
      runs.push(run);
      renderRuns();
      chart.setHistory(result.history, epochs);

      const model = createModelFile({ network: result.network, gridSize, encoding, hiddenNeurons, training });
      modelState.set(model);

      const outcome = `${formatNumber(result.epochsDone)} епох за ${formatDuration(result.trainMs)}, точність на перевірці ${formatPercent(result.validationMetrics.accuracy)}`;
      if (result.stopped) {
        task.cancelled(`Навчання зупинено: ${outcome}`);
        log.add('warn', `Навчання зупинено: ${outcome}`);
        toast('warn', 'Навчання зупинено. Модель збережено на поточній епосі.');
      } else {
        task.finish(`Навчання завершено: ${outcome}`);
        log.add('success', `Навчання завершено: ${outcome}`);
        toast('success', 'Навчання завершено.');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        log.add('warn', 'Обчислення ознак скасовано');
      } else {
        task?.fail('Не вдалося навчити мережу');
        log.add('error', `Не вдалося навчити мережу: ${error.message}`);
        toast('error', `Не вдалося навчити мережу: ${error.message}`);
      }
    } finally {
      running = null;
      setControls();
    }
  }

  function saveModel() {
    const model = modelState.get();
    if (!model) return;
    const { loadedFrom: _loadedFrom, ...file } = model;
    const fileName = `модель_сітка${model.gridSize}_епох${model.training?.epochsDone ?? 0}.json`;
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    saveBlob(blob, fileName);
    log.add('success', `Модель збережено у ${fileName} (${formatBytes(blob.size)})`);
    toast('success', `Збережено ${fileName}`);
  }

  async function loadModel(file) {
    try {
      const model = parseModelFile(await file.text());
      await modelClient.load(model.network);
      modelState.set({ ...model, loadedFrom: file.name });
      encodingSelect.value = model.encoding;
      gridModel.set(model.gridSize);
      syncRate();
      validate();
      log.add('success', `Модель завантажено з ${file.name}: сітка ${model.gridSize}×${model.gridSize}`);
      toast('success', `Модель завантажено з ${file.name}`);
    } catch (error) {
      log.add('error', `Не вдалося завантажити модель: ${error.message}`);
      toast('error', `Не вдалося завантажити модель: ${error.message}`);
    }
  }

  function saveRuns(kind) {
    if (!runs.length) return;
    const blob =
      kind === 'csv'
        ? new Blob([runsToCsv(runs)], { type: 'text/csv;charset=utf-8' })
        : new Blob([JSON.stringify({ classes: CLASSES.map((item) => ({ id: item.id, label: classLabel(item.id) })), runs }, null, 2)], { type: 'application/json' });
    const fileName = `результати-навчання.${kind}`;
    saveBlob(blob, fileName);
    log.add('success', `Результати збережено у ${fileName} (${formatBytes(blob.size)})`);
    toast('success', `Збережено ${fileName}`);
  }

  for (const name of FIELDS) {
    const field = byId(name);
    field.addEventListener('input', validate);
    field.addEventListener('change', () => {
      const result = validate();
      if (result.errors[name]) log.add('warn', `Некоректне значення: ${result.errors[name]}`);
      else {
        const value = name === 'encoding' ? encodingLabel(result.values.encoding) : String(result.values[name]).replace('.', ',');
        log.add('info', `Параметр «${FIELD_LABELS[name]}» = ${value}`);
      }
      if (name === 'gridSize' && !result.errors.gridSize) gridModel.set(result.values.gridSize);
      if (name === 'encoding' && !result.errors.encoding) {
        syncRate();
        validate();
      }
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    startTraining();
  });
  rateField.addEventListener('input', () => {
    rateEdited = true;
  });
  applyRateButton.addEventListener('click', () => {
    applyRecommendedRate();
    validate();
  });
  stopButton.addEventListener('click', requestStop);
  saveModelButton.addEventListener('click', saveModel);
  loadModelButton.addEventListener('click', () => modelInput.click());
  modelInput.addEventListener('change', () => {
    const file = modelInput.files?.[0];
    modelInput.value = '';
    if (file) loadModel(file);
  });
  saveCsvButton.addEventListener('click', () => saveRuns('csv'));
  saveJsonButton.addEventListener('click', () => saveRuns('json'));
  gridModel.subscribe((size) => {
    gridSelect.value = String(size);
    syncRate();
    validate();
  });
  modelState.subscribe((model) => {
    renderResult(model);
    setControls();
  });
  validate();

  return {
    setSelection(next) {
      selection = next;
      const { total, bytes, groups, canTrain } = next;
      dataset.textContent = canTrain
        ? `Обраний набір: ${formatImages(total)}, ${formatBytes(bytes)}, груп: ${groups.length}.`
        : 'Набір ще не обрано. Спершу виберіть зображення на етапі «Дані».';
      setControls();
    },
  };
}
