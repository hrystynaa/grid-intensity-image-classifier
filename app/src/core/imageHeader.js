// Reads image format and dimensions from file headers without decoding pixels.

const HEADER_CHUNKS = [128 * 1024, 2 * 1024 * 1024];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 3, 4: 2, 6: 4 };

const isJpegFrameMarker = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function parsePng(bytes) {
  if (bytes.length < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null;
  const channels = PNG_CHANNELS[bytes[25]];
  if (!channels) return null;
  return { format: 'png', width: view.getUint32(16), height: view.getUint32(20), channels };
}

function parseJpeg(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (isJpegFrameMarker(marker)) {
      return {
        format: 'jpg',
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        channels: bytes[i + 9],
      };
    }
    i += 2 + length;
  }
  return null;
}

function parseBmp(bytes) {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dibSize = view.getUint32(14, true);
  if (dibSize === 12) {
    const bits = view.getUint16(24, true);
    return { format: 'bmp', width: view.getUint16(18, true), height: view.getUint16(20, true), channels: 3, bits };
  }
  if (dibSize < 40) return null;
  const bits = view.getUint16(28, true);
  return {
    format: 'bmp',
    width: view.getInt32(18, true),
    height: Math.abs(view.getInt32(22, true)),
    channels: bits === 32 ? 4 : 3,
    bits,
  };
}

export function parseImageHeader(bytes) {
  if (!bytes || bytes.length < 4) return null;
  let header = null;
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) header = parsePng(bytes);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) header = parseJpeg(bytes);
  else if (bytes[0] === 0x42 && bytes[1] === 0x4d) header = parseBmp(bytes);
  return header && header.width > 0 && header.height > 0 ? header : null;
}

export async function readFileHeader(file) {
  for (const size of [...HEADER_CHUNKS, file.size]) {
    const length = Math.min(size, file.size);
    const header = parseImageHeader(new Uint8Array(await file.slice(0, length).arrayBuffer()));
    if (header || length >= file.size) return header;
  }
  return null;
}
