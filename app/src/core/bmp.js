const HEADER_SIZE = 54;
const PIXELS_PER_METER = 2835;

// Encodes RGBA pixels as an uncompressed 24-bit BMP, blending transparency over white.
export function encodeBmp(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Invalid image size');
  }
  if (rgba.length !== width * height * 4) throw new RangeError('Pixel buffer does not match image size');

  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const output = new Uint8Array(HEADER_SIZE + pixelBytes);
  const view = new DataView(output.buffer);

  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, output.length, true);
  view.setUint32(10, HEADER_SIZE, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, PIXELS_PER_METER, true);
  view.setInt32(42, PIXELS_PER_METER, true);

  for (let y = 0; y < height; y++) {
    let source = (height - 1 - y) * width * 4;
    let target = HEADER_SIZE + y * rowSize;
    for (let x = 0; x < width; x++) {
      const alpha = rgba[source + 3];
      const blend = (value) => (alpha === 255 ? value : Math.round((value * alpha + 255 * (255 - alpha)) / 255));
      output[target++] = blend(rgba[source + 2]);
      output[target++] = blend(rgba[source + 1]);
      output[target++] = blend(rgba[source]);
      source += 4;
    }
  }
  return output;
}
