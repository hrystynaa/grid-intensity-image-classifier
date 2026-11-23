// Cell boundaries are shared by the overlay and the feature extractor,
// so every pixel belongs to exactly one cell even when the size is not divisible by the grid.
export function cellBoundaries(length, cells) {
  return Array.from({ length: cells + 1 }, (_, index) => Math.floor((index * length) / cells));
}
