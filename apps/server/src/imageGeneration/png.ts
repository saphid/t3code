/**
 * Minimal PNG decode/encode so generated icons can be shrunk before they are
 * saved. Image models return ~1 MP canvases; a project icon renders at 16 px.
 *
 * Image models hand back standard 8-bit, non-interlaced PNGs; the decoder
 * covers the color types that implies (0, 2, 3, 4, 6) and refuses anything
 * else so a surprising format surfaces as an "invalid-output" failure instead
 * of silent corruption. Encoding always emits 8-bit RGBA.
 *
 * @module imageGeneration/png
 */
import * as NodeZlib from "node:zlib";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const COLOR_TYPE_CHANNELS: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // RGB
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new PngError("Not a PNG file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) {
      throw new PngError("Truncated PNG chunk.");
    }
    chunks.push({ type, data: bytes.subarray(dataStart, dataStart + length) });
    offset = dataStart + length + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** 8-bit RGBA, row-major. */
  readonly rgba: Uint8Array;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) {
    throw new PngError("PNG is missing its IHDR chunk.");
  }
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = ihdr.data[8]!;
  const colorType = ihdr.data[9]!;
  const interlace = ihdr.data[12]!;
  if (width === 0 || height === 0) {
    throw new PngError("PNG has an empty canvas.");
  }
  if (bitDepth !== 8) {
    throw new PngError(`Unsupported PNG bit depth ${bitDepth}.`);
  }
  if (interlace !== 0) {
    throw new PngError("Interlaced PNGs are not supported.");
  }
  const channels = COLOR_TYPE_CHANNELS[colorType];
  if (!channels) {
    throw new PngError(`Unsupported PNG color type ${colorType}.`);
  }
  const palette = chunks.find((chunk) => chunk.type === "PLTE");
  if (colorType === 3 && !palette) {
    throw new PngError("Palette PNG is missing its PLTE chunk.");
  }
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => Buffer.from(chunk.data)),
  );
  if (idat.length === 0) {
    throw new PngError("PNG has no image data.");
  }

  const stride = width * channels;
  const raw = new Uint8Array(NodeZlib.inflateSync(idat));
  if (raw.length < (stride + 1) * height) {
    throw new PngError("PNG pixel data is truncated.");
  }

  // Undo the per-scanline filters in place over the inflated stream.
  const filtered = new Uint8Array(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const previous = y > 0 ? filtered.subarray((y - 1) * stride, y * stride) : null;
    const target = filtered.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? target[x - bpp]! : 0;
      const up = previous ? previous[x]! : 0;
      const upLeft = previous && x >= bpp ? previous[x - bpp]! : 0;
      let value = line[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += Math.floor((left + up) / 2);
          break;
        case 4:
          value += paeth(left, up, upLeft);
          break;
        default:
          throw new PngError(`Unknown PNG filter type ${filter}.`);
      }
      target[x] = value & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 0) {
      rgba[target] = rgba[target + 1] = rgba[target + 2] = filtered[source]!;
      rgba[target + 3] = 255;
    } else if (colorType === 2) {
      rgba[target] = filtered[source]!;
      rgba[target + 1] = filtered[source + 1]!;
      rgba[target + 2] = filtered[source + 2]!;
      rgba[target + 3] = 255;
    } else if (colorType === 3) {
      const index = filtered[source]! * 3;
      rgba[target] = palette!.data[index]!;
      rgba[target + 1] = palette!.data[index + 1]!;
      rgba[target + 2] = palette!.data[index + 2]!;
      rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba[target] = rgba[target + 1] = rgba[target + 2] = filtered[source]!;
      rgba[target + 3] = filtered[source + 1]!;
    } else {
      rgba[target] = filtered[source]!;
      rgba[target + 1] = filtered[source + 1]!;
      rgba[target + 2] = filtered[source + 2]!;
      rgba[target + 3] = filtered[source + 3]!;
    }
  }
  return { width, height, rgba };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const buffer = Buffer.alloc(data.length + 12);
  buffer.writeUInt32BE(data.length, 0);
  buffer.write(type, 4, "ascii");
  Buffer.from(data).copy(buffer, 8);
  buffer.writeUInt32BE(crc32(buffer.subarray(4, 8 + data.length)), 8 + data.length);
  return buffer;
}

/** Encode 8-bit RGBA pixels as a non-interlaced PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new PngError("RGBA buffer does not match the canvas size.");
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", NodeZlib.deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Center-crop a PNG to a square and area-average it down to at most `size`
 * pixels per side. Smaller images are only cropped.
 */
export function resizeToSquareIcon(bytes: Uint8Array, size: number): Uint8Array {
  const { width, height, rgba } = decodePng(bytes);
  const side = Math.min(width, height);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const target = Math.min(size, side);
  const scale = side / target;
  const out = new Uint8Array(target * target * 4);
  for (let y = 0; y < target; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      // Alpha-weighted so transparent pixels do not darken the edges.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const offset = ((top + sy) * width + left + sx) * 4;
          const alpha = rgba[offset + 3]!;
          r += rgba[offset]! * alpha;
          g += rgba[offset + 1]! * alpha;
          b += rgba[offset + 2]! * alpha;
          a += alpha;
        }
      }
      const index = (y * target + x) * 4;
      const count = (y1 - y0) * (x1 - x0);
      if (a > 0) {
        out[index] = Math.round(r / a);
        out[index + 1] = Math.round(g / a);
        out[index + 2] = Math.round(b / a);
      }
      out[index + 3] = Math.round(a / count);
    }
  }
  return encodePng(target, target, out);
}
