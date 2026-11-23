import { encodeBmp } from '../core/bmp.js';

const JPEG_QUALITY = 0.92;

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed'))), type, quality);
  });

export async function exportCanvas(canvas, format) {
  if (format === 'png') return toBlob(canvas, 'image/png');
  if (format === 'jpg') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    return toBlob(flat, 'image/jpeg', JPEG_QUALITY);
  }
  if (format === 'bmp') {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([encodeBmp(data, canvas.width, canvas.height)], { type: 'image/bmp' });
  }
  throw new RangeError(`Unsupported format: ${format}`);
}
