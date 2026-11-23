import { extractCellMeans } from '../core/features.js';

const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d', { willReadFrequently: true });

function readPixels(bitmap) {
  const { width, height } = bitmap;
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

self.onmessage = async ({ data: { file, cells } }) => {
  let bitmap = null;
  try {
    const started = performance.now();
    try {
      bitmap = await createImageBitmap(file);
    } catch (error) {
      self.postMessage({ ok: false, reason: 'decode', error: error.message });
      return;
    }
    const decoded = performance.now();
    const { width, height } = bitmap;
    if (width < cells || height < cells) {
      self.postMessage({ ok: false, reason: 'tooSmall', width, height });
      return;
    }
    const pixels = readPixels(bitmap);
    const means = extractCellMeans(pixels, width, height, cells);
    const finished = performance.now();
    self.postMessage(
      { ok: true, means, width, height, decodeMs: decoded - started, featureMs: finished - decoded },
      [means.buffer],
    );
  } catch (error) {
    self.postMessage({ ok: false, reason: 'processing', error: error.message });
  } finally {
    bitmap?.close();
    canvas.width = 1;
    canvas.height = 1;
  }
};
