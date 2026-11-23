import { formatBytes, formatImages } from '../core/format.js';
import { GRID_SIZES, validateTrainingParams } from '../core/validation.js';
import { byId, element } from './dom.js';

const FIELDS = ['epochs', 'learningRate', 'gridSize', 'hiddenNeurons'];
const FIELD_LABELS = {
  epochs: 'Кількість епох',
  learningRate: 'Швидкість навчання',
  gridSize: 'Розмір сітки',
  hiddenNeurons: 'Нейронів у прихованому шарі',
};

export function initTrainPanel({ log, gridModel }) {
  const form = byId('trainForm');
  const dataset = byId('trainDataset');
  const summary = byId('networkSummary');
  const gridSelect = byId('gridSize');

  gridSelect.append(
    ...GRID_SIZES.map((size) => element('option', { text: `${size}×${size} (${size * size} ознак)`, attrs: { value: size } })),
  );
  gridSelect.value = String(gridModel.get());

  const readValues = () => Object.fromEntries(FIELDS.map((name) => [name, byId(name).value]));

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
      const { gridSize, hiddenNeurons } = result.values;
      const inputs = gridSize * gridSize;
      summary.textContent = hiddenNeurons
        ? `Мережа: ${inputs} входів → ${hiddenNeurons} прихованих → 3 виходи`
        : `Мережа: ${inputs} входів → 3 виходи (один шар)`;
    } else {
      summary.textContent = 'Виправте параметри, позначені червоним.';
    }
    return result;
  }

  for (const name of FIELDS) {
    const field = byId(name);
    field.addEventListener('input', validate);
    field.addEventListener('change', () => {
      const result = validate();
      if (result.errors[name]) log.add('warn', `Некоректне значення: ${result.errors[name]}`);
      else log.add('info', `Параметр «${FIELD_LABELS[name]}» = ${String(result.values[name]).replace('.', ',')}`);
      if (name === 'gridSize' && !result.errors.gridSize) gridModel.set(result.values.gridSize);
    });
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  gridModel.subscribe((size) => {
    gridSelect.value = String(size);
    validate();
  });
  validate();

  return {
    setSelection({ total, bytes, groups, canTrain }) {
      dataset.textContent = canTrain
        ? `Обраний набір: ${formatImages(total)}, ${formatBytes(bytes)}, груп: ${groups.length}.`
        : 'Набір ще не обрано. Спершу виберіть зображення на етапі «Дані».';
    },
  };
}
