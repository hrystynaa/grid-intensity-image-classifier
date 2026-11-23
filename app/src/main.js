import { formatBytes, formatImages } from './core/format.js';
import { createOperationLog } from './core/operationLog.js';
import { DEFAULT_GRID_SIZE } from './core/validation.js';
import { initDataPanel } from './ui/dataPanel.js';
import { byId, createValue } from './ui/dom.js';
import { initLogView } from './ui/logView.js';
import { createProgressView } from './ui/progressView.js';
import { initRecognizePanel } from './ui/recognizePanel.js';
import { initTabs } from './ui/tabs.js';
import { createToaster } from './ui/toast.js';
import { initTrainPanel } from './ui/trainPanel.js';
import { createFeatureExtractor } from './workers/featurePool.js';
import { createModelClient } from './workers/modelClient.js';

const log = createOperationLog();
const toast = createToaster();
const progress = createProgressView();
const tabs = initTabs();
const gridModel = createValue(DEFAULT_GRID_SIZE);
const headerStatus = byId('headerStatus');
const modelClient = createModelClient();
const modelState = createValue(null);

initLogView(log, toast);
const trainPanel = initTrainPanel({
  log,
  progress,
  toast,
  gridModel,
  modelClient,
  modelState,
  extractor: createFeatureExtractor(),
});
initRecognizePanel({
  log,
  progress,
  toast,
  gridModel,
  modelClient,
  modelState,
  extractor: createFeatureExtractor({ size: 1 }),
});
modelState.subscribe((model) => tabs.setDone('train', Boolean(model)));
initDataPanel({
  log,
  progress,
  toast,
  onContinue: () => tabs.select('train', { focus: true }),
  onSelectionChange(selection) {
    trainPanel.setSelection(selection);
    tabs.setDone('data', selection.canTrain);
    headerStatus.textContent = selection.total
      ? `Обрано ${formatImages(selection.total)} · ${formatBytes(selection.bytes)}`
      : 'Дані ще не обрано';
  },
});

log.add('info', 'Застосунок запущено');
