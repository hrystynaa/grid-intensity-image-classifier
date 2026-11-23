import { cellBoundaries } from './gridLayout.js';

const RED_WEIGHT = 0.299;
const GREEN_WEIGHT = 0.587;
const BLUE_WEIGHT = 0.114;
const MAX_CHANNEL = 255;

export const luminance = (red, green, blue) => RED_WEIGHT * red + GREEN_WEIGHT * green + BLUE_WEIGHT * blue;

// Returns the mean luminance of every grid cell in [0, 1], row by row.
// Alpha is ignored: callers flatten transparent images onto white before reading pixels.
export function extractCellMeans(rgba, width, height, cells) {
  if (!Number.isInteger(cells) || cells < 1) throw new RangeError('Grid size must be a positive integer');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image size must be positive');
  }
  if (rgba.length !== width * height * 4) throw new RangeError('Pixel buffer does not match the image size');
  if (width < cells || height < cells) throw new RangeError('Image is smaller than the grid');

  const xs = cellBoundaries(width, cells);
  const ys = cellBoundaries(height, cells);
  const columnCell = new Uint16Array(width);
  for (let column = 0; column < cells; column++) columnCell.fill(column, xs[column], xs[column + 1]);

  const means = new Float32Array(cells * cells);
  const sums = new Float64Array(cells);
  for (let row = 0; row < cells; row++) {
    sums.fill(0);
    for (let y = ys[row]; y < ys[row + 1]; y++) {
      let offset = y * width * 4;
      for (let x = 0; x < width; x++, offset += 4) {
        sums[columnCell[x]] +=
          RED_WEIGHT * rgba[offset] + GREEN_WEIGHT * rgba[offset + 1] + BLUE_WEIGHT * rgba[offset + 2];
      }
    }
    const cellHeight = ys[row + 1] - ys[row];
    for (let column = 0; column < cells; column++) {
      const pixels = (xs[column + 1] - xs[column]) * cellHeight;
      means[row * cells + column] = sums[column] / (pixels * MAX_CHANNEL);
    }
  }
  return means;
}
