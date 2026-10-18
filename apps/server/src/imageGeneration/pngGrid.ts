/**
 * Minimal PNG decode/encode for slicing generated icon grids.
 *
 * Image models hand back standard 8-bit, non-interlaced PNGs; the decoder
 * covers the color types that implies (0, 2, 3, 4, 6) and refuses anything
 * else so a surprising format surfaces as an "invalid-output" failure instead
 * of silent corruption. Encoding always emits 8-bit RGBA.
 *
 * @module imageGeneration/pngGrid
 */
import { inflateSync, deflateSync } from "node:zlib";

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
  const raw = new Uint8Array(inflateSync(idat));
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
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Detect a canvas that is one full-bleed icon: an opaque background with
 * either no other content at all or content that stays clear of the edges.
 * Cutting such a canvas would slice background into fake variants.
 */
function isSingleFullBleedCanvas(rgba: Uint8Array, width: number, height: number): boolean {
  const background = sampleBackgroundColor(rgba, width, height);
  if (background[3]! <= ALPHA_BACKGROUND) {
    return false;
  }
  const isBackground = (offset: number) => {
    const drift =
      Math.abs(rgba[offset]! - background[0]!) +
      Math.abs(rgba[offset + 1]! - background[1]!) +
      Math.abs(rgba[offset + 2]! - background[2]!);
    return drift <= TOLERANCE * 3 && rgba[offset + 3]! > ALPHA_BACKGROUND;
  };
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackground((y * width + x) * 4)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return true;
  }
  const inset = 2;
  if (!(minX >= inset && minY >= inset && maxX < width - inset && maxY < height - inset)) {
    return false;
  }
  // A single icon is roughly square; a tall or wide bbox means several
  // variants stacked on a shared background, which still needs cutting.
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const ratio = Math.max(contentWidth, contentHeight) / Math.min(contentWidth, contentHeight);
  return ratio <= 1.6;
}

/**
 * Cut an image holding `columns` variants into per-variant tiles. Image
 * models don't always honor the requested layout, so the cut follows the
 * picture: when the canvas shows uniform background bands between the
 * variants, the cut runs through them; otherwise both axes are tried and the
 * cut whose tiles differ most from each other wins. Tiles without visible
 * content are dropped, and when fewer than two tiles survive — the model
 * often draws a single icon instead of a grid — the whole canvas is treated
 * as one icon: cropped to its content and padded to a square.
 */
export function sliceHorizontalGrid(
  png: Uint8Array,
  columns: number,
  options: { allowReframe?: boolean; allowBoundaryTiles?: boolean } = {},
): Uint8Array[] {
  const { allowReframe = true, allowBoundaryTiles = false } = options;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new PngError("Grid column count must be a positive integer.");
  }
  const { width, height, rgba } = decodePng(png);
  if (width < columns && height < columns) {
    throw new PngError("Generated image is too small for the expected icon grid.");
  }
  if (allowReframe) {
    const recut = reframeAndRecut(rgba, width, height, columns);
    if (recut) {
      return recut;
    }
  }
  // One full-bleed icon on an opaque background — either a uniform canvas or
  // a centered symbol with margins — must not be cut into background strips.
  if (isSingleFullBleedCanvas(rgba, width, height)) {
    return [encodePng(width, height, rgba)];
  }
  const gaps = findSeparatorGaps(rgba, width, height, columns);
  if (gaps.axis !== null) {
    return finishCut(
      gaps.axis === "x"
        ? cutVertically(rgba, width, height, [0, ...gaps.positions, width])
        : cutHorizontally(rgba, width, height, [0, ...gaps.positions, height]),
      rgba,
      width,
      height,
      allowBoundaryTiles,
    );
  }
  // No usable background bands: the layout is unknown, so try both axes.
  // A correct cut yields complete icons that stay inside their cell; a wrong
  // one slices icons into fragments that straddle the cut boundary.
  const vertical = cutVertically(rgba, width, height, [0, ...evenPositions(width, columns), width]);
  const horizontal = cutHorizontally(rgba, width, height, [
    0,
    ...evenPositions(height, columns),
    height,
  ]);
  const scoreCut = (tiles: TileBuffer[]) => {
    const analyzed = tiles.map(analyzeTile).filter((tile) => tile.contentShare >= TILE_MIN_CONTENT);
    const usable = analyzed.map(cropToContentSquare);
    const suspects = analyzed.filter(
      (tile) => tile.touchesCutBoundary && tile.contentShare < FULL_BLEED_SHARE,
    ).length;
    if (usable.length < 2) return { count: usable.length, suspects, distinctness: -1 };
    let total = 0;
    let pairs = 0;
    for (let a = 0; a < usable.length; a++) {
      for (let b = a + 1; b < usable.length; b++) {
        total += thumbnailDistance(usable[a]!, usable[b]!);
        pairs++;
      }
    }
    return { count: usable.length, suspects, distinctness: total / pairs };
  };
  const verticalScore = scoreCut(vertical);
  const horizontalScore = scoreCut(horizontal);
  const eligible = (score: { count: number; suspects: number }) =>
    score.count >= 2 && score.suspects === 0;
  let chosen: TileBuffer[];
  if (eligible(verticalScore) && !eligible(horizontalScore)) {
    chosen = vertical;
  } else if (eligible(horizontalScore) && !eligible(verticalScore)) {
    chosen = horizontal;
  } else if (verticalScore.distinctness >= horizontalScore.distinctness) {
    chosen = vertical;
  } else {
    chosen = horizontal;
  }
  return finishCut(chosen, rgba, width, height, allowBoundaryTiles);
}

/** Shared post-cut pipeline: drop blanks, drop fragments, crop, dedupe. */
function finishCut(
  tiles: TileBuffer[],
  rgba: Uint8Array,
  width: number,
  height: number,
  allowBoundaryTiles = false,
): Uint8Array[] {
  const good = tiles.map(analyzeTile).filter((tile) => tile.contentShare >= TILE_MIN_CONTENT);
  // Content straddling a cut boundary means the model drew fewer, larger
  // icons than asked; the tiles would be fragments of one icon. Inside a
  // reframed strip, though, boundary tiles are the stacked variants.
  const fragmented =
    !allowBoundaryTiles &&
    good.some((tile) => tile.touchesCutBoundary && tile.contentShare < FULL_BLEED_SHARE);
  if (good.length >= 2 && !fragmented) {
    const cropped = good.map((tile) => cropToContentSquare(tile));
    // The model sometimes draws the same variant twice; identical choices
    // are noise in the picker, so later near-duplicates are dropped.
    const distinct = cropped.filter(
      (tile, index) =>
        !cropped
          .slice(0, index)
          .some((earlier) => thumbnailDistance(tile, earlier) < DUPLICATE_THRESHOLD),
    );
    return (distinct.length ? distinct : cropped.slice(0, 1)).map((tile) =>
      encodePng(tile.width, tile.height, tile.rgba),
    );
  }
  const single = singleIconTile(rgba, width, height);
  return [encodePng(single.width, single.height, single.rgba)];
}

/**
 * The model sometimes stacks the variants in one narrow column or row of an
 * otherwise transparent canvas: gap detection fails on the full canvas and
 * the content bbox is a tall strip. Crop to the strip and cut again inside
 * it, where the real separators become visible.
 */
function reframeAndRecut(
  rgba: Uint8Array,
  width: number,
  height: number,
  columns: number,
): Uint8Array[] | null {
  const background = sampleBackgroundColor(rgba, width, height);
  if (background[3]! > ALPHA_BACKGROUND) {
    return null;
  }
  const bbox = contentBBoxOf(rgba, width, height);
  if (bbox.maxX < 0) {
    return null;
  }
  const contentWidth = bbox.maxX - bbox.minX + 1;
  const contentHeight = bbox.maxY - bbox.minY + 1;
  const ratio = Math.max(contentWidth, contentHeight) / Math.min(contentWidth, contentHeight);
  if (ratio <= 1.6) {
    return null;
  }
  // Only a strip that runs edge to edge across the canvas is a misplaced
  // stack; an inset row of icons is just the normal layout.
  const touchesLongAxis =
    contentWidth >= contentHeight
      ? bbox.minX === 0 && bbox.maxX === width - 1
      : bbox.minY === 0 && bbox.maxY === height - 1;
  if (!touchesLongAxis) {
    return null;
  }
  const side = Math.max(contentWidth, contentHeight);
  const framed = new Uint8Array(side * side * 4);
  const offsetX = Math.floor((side - contentWidth) / 2);
  const offsetY = Math.floor((side - contentHeight) / 2);
  for (let y = 0; y < contentHeight; y++) {
    const sourceRow = ((bbox.minY + y) * width + bbox.minX) * 4;
    framed.set(
      rgba.subarray(sourceRow, sourceRow + contentWidth * 4),
      ((offsetY + y) * side + offsetX) * 4,
    );
  }
  return sliceHorizontalGrid(encodePng(side, side, framed), columns, {
    allowReframe: false,
    allowBoundaryTiles: true,
  });
}

const TILE_MIN_CONTENT = 0.01;
const FULL_BLEED_SHARE = 0.98;
const DUPLICATE_THRESHOLD = 3;

/** Mean absolute difference of coarse grayscale thumbnails (0-255 scale). */
function thumbnailDistance(a: TileBuffer, b: TileBuffer): number {
  const S = 24;
  const sample = (tile: TileBuffer) => {
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const sx = Math.floor((x * tile.width) / S);
        const sy = Math.floor((y * tile.height) / S);
        const o = (sy * tile.width + sx) * 4;
        const alpha = tile.rgba[o + 3]! / 255;
        out[y * S + x] =
          (tile.rgba[o]! * 0.3 + tile.rgba[o + 1]! * 0.5 + tile.rgba[o + 2]! * 0.2) * alpha;
      }
    }
    return out;
  };
  const sa = sample(a);
  const sb = sample(b);
  let total = 0;
  for (let i = 0; i < sa.length; i++) total += Math.abs(sa[i]! - sb[i]!);
  return total / sa.length;
}
interface TileAnalysis extends TileBuffer {
  readonly contentShare: number;
  readonly touchesCutBoundary: boolean;
  readonly contentBBox: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * Classify pixels against the sampled corner background: a pixel is content
 * when it is opaque and either the background itself is transparent or its
 * color differs from the background. This keeps icons on opaque canvas
 * backgrounds separable from their margins, not just transparent ones.
 */
function contentScanner(rgba: Uint8Array, width: number, height: number) {
  const background = sampleBackgroundColor(rgba, width, height);
  const backgroundOpaque = background[3]! > ALPHA_BACKGROUND;
  const isContent = (offset: number) => {
    if (rgba[offset + 3]! <= ALPHA_BACKGROUND) return false;
    if (!backgroundOpaque) return true;
    return (
      Math.abs(rgba[offset]! - background[0]!) > TOLERANCE ||
      Math.abs(rgba[offset + 1]! - background[1]!) > TOLERANCE ||
      Math.abs(rgba[offset + 2]! - background[2]!) > TOLERANCE
    );
  };
  return isContent;
}

function contentBBoxOf(
  rgba: Uint8Array,
  width: number,
  height: number,
): { minX: number; maxX: number; minY: number; maxY: number; share: number } {
  const background = sampleBackgroundColor(rgba, width, height);
  const backgroundOpaque = background[3]! > ALPHA_BACKGROUND;
  const isContent = contentScanner(rgba, width, height);
  let content = 0;
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isContent((y * width + x) * 4)) {
        content++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // A uniform opaque canvas is a full-bleed icon, not an empty one; only a
  // canvas with nothing opaque counts as blank.
  if (content === 0 && backgroundOpaque) {
    return { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1, share: 1 };
  }
  return { minX, maxX, minY, maxY, share: content / (width * height) };
}

/**
 * Smallest per-axis window holding the bulk (90%) of the tile's visible
 * content. Sparse artwork — thin strokes or soft glow spread across the
 * canvas — yields a bounding box far larger than the mark itself; this
 * window finds the dense region worth keeping.
 */
function contentMassWindowOf(
  rgba: Uint8Array,
  width: number,
  height: number,
): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
  const isContent = contentScanner(rgba, width, height);
  const columns = new Array<number>(width).fill(0);
  const rows = new Array<number>(height).fill(0);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isContent((y * width + x) * 4)) {
        columns[x]!++;
        rows[y]!++;
        total++;
      }
    }
  }
  if (total === 0) {
    return { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1, width, height };
  }
  const target = Math.ceil(total * 0.9);
  const window = (counts: number[], size: number): { min: number; max: number } => {
    let sum = 0;
    let min = 0;
    let best = { min: 0, max: size - 1, width: size };
    for (let max = 0; max < size; max++) {
      sum += counts[max]!;
      while (sum - counts[min]! >= target) {
        sum -= counts[min]!;
        min++;
      }
      if (sum >= target && max - min + 1 < best.width) {
        best = { min, max, width: max - min + 1 };
      }
    }
    return { min: best.min, max: best.max };
  };
  const x = window(columns, width);
  const y = window(rows, height);
  return {
    minX: x.min,
    maxX: x.max,
    minY: y.min,
    maxY: y.max,
    width: x.max - x.min + 1,
    height: y.max - y.min + 1,
  };
}

function analyzeTile(tile: TileBuffer): TileAnalysis {
  const { minX, maxX, minY, maxY, share } = contentBBoxOf(tile.rgba, tile.width, tile.height);
  return {
    width: tile.width,
    height: tile.height,
    rgba: tile.rgba,
    contentShare: share,
    touchesCutBoundary:
      minX === 0 || minY === 0 || maxX === tile.width - 1 || maxY === tile.height - 1,
    contentBBox: { minX, maxX, minY, maxY },
  };
}

/**
 * Crop the canvas to its visible content and center it on a transparent
 * square, so a lone icon ships as a usable avatar instead of blank strips.
 */
function singleIconTile(rgba: Uint8Array, width: number, height: number): TileBuffer {
  const bbox = contentBBoxOf(rgba, width, height);
  if (bbox.maxX < 0) {
    throw new PngError("Generated image has no visible icon content.");
  }
  return cropToContentSquare({
    width,
    height,
    rgba,
    contentBBox: { minX: bbox.minX, maxX: bbox.maxX, minY: bbox.minY, maxY: bbox.maxY },
  });
}

/**
 * Crop a tile to its visible content and center the result on a transparent
 * square, so avatar slots render the icon at full size instead of floating
 * in a strip of background. When the content bounding box is mostly empty
 * (sparse strokes or glow spanning the canvas), the crop tightens to the
 * window holding the bulk of the visible mass instead.
 */
function cropToContentSquare(
  tile: TileBuffer & {
    contentBBox?: { minX: number; maxX: number; minY: number; maxY: number };
  },
): TileBuffer {
  const bbox =
    tile.contentBBox ??
    (() => {
      const found = contentBBoxOf(tile.rgba, tile.width, tile.height);
      return { minX: found.minX, maxX: found.maxX, minY: found.minY, maxY: found.maxY };
    })();
  if (bbox.maxX < 0) {
    // Nothing distinguishable from the background: keep the tile unchanged.
    return { width: tile.width, height: tile.height, rgba: tile.rgba };
  }
  let { minX, maxX, minY, maxY } = bbox;
  const background = sampleBackgroundColor(tile.rgba, tile.width, tile.height);
  const backgroundOpaque = background[3]! > ALPHA_BACKGROUND;
  const dense = contentMassWindowOf(tile.rgba, tile.width, tile.height);
  const bboxSide = Math.max(maxX - minX + 1, maxY - minY + 1);
  const denseSide = Math.max(dense.width, dense.height);
  // Only floating artwork on a transparent canvas gets the density crop; a
  // full-bleed icon on an opaque background must keep its background.
  if (!backgroundOpaque && bbox.maxX - bbox.minX + 1 > 0 && denseSide * 2 <= bboxSide) {
    minX = dense.minX;
    maxX = dense.maxX;
    minY = dense.minY;
    maxY = dense.maxY;
  }
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const side = Math.max(contentWidth, contentHeight);
  const cropped = new Uint8Array(side * side * 4);
  const offsetX = Math.floor((side - contentWidth) / 2);
  const offsetY = Math.floor((side - contentHeight) / 2);
  for (let y = 0; y < contentHeight; y++) {
    const sourceRow = ((minY + y) * tile.width + minX) * 4;
    cropped.set(
      tile.rgba.subarray(sourceRow, sourceRow + contentWidth * 4),
      ((offsetY + y) * side + offsetX) * 4,
    );
  }
  return { width: side, height: side, rgba: cropped };
}

/**
 * Sample the background color from the four canvas corners and look for
 * uniform-background bands separating the variants on each axis. Two usable
 * bands near the variant boundaries mean a full grid cut; a single band near
 * the middle means the model drew two variants; anything else returns
 * `axis: null` and the caller falls back to even thirds.
 */
function findSeparatorGaps(
  rgba: Uint8Array,
  width: number,
  height: number,
  columns: number,
): { axis: "x" | "y" | null; positions: number[] } {
  const background = sampleBackgroundColor(rgba, width, height);
  const isBackground = (offset: number) =>
    // Transparent pixels count as background: image models often return
    // icons on a transparent canvas, where the RGB channels carry no signal.
    rgba[offset + 3]! <= ALPHA_BACKGROUND ||
    (background[3]! > ALPHA_BACKGROUND &&
      Math.abs(rgba[offset]! - background[0]!) <= TOLERANCE &&
      Math.abs(rgba[offset + 1]! - background[1]!) <= TOLERANCE &&
      Math.abs(rgba[offset + 2]! - background[2]!) <= TOLERANCE);

  // Fraction of background pixels per column (x axis) and per row (y axis).
  const columnBackground = new Float32Array(width);
  const rowBackground = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBackground((y * width + x) * 4)) {
        columnBackground[x]! += 1 / height;
        rowBackground[y]! += 1 / width;
      }
    }
  }

  const gapRuns = (fractions: Float32Array, span: number) => {
    const interiorStart = Math.floor(span * 0.08);
    const interiorEnd = Math.ceil(span * 0.92);
    const runs: Array<{ mid: number; strength: number }> = [];
    let runStart = -1;
    for (let i = interiorStart; i <= interiorEnd; i++) {
      const isGap = i < span && fractions[i]! >= GAP_FRACTION;
      if (isGap && runStart === -1) runStart = i;
      if ((!isGap || i === interiorEnd) && runStart !== -1) {
        const runEnd = isGap ? i : i - 1;
        runs.push({ mid: Math.round((runStart + runEnd) / 2), strength: runEnd - runStart + 1 });
        runStart = -1;
      }
    }
    return runs;
  };

  const plan = (fractions: Float32Array, span: number) => {
    const runs = gapRuns(fractions, span);
    // Full grid: the two bands closest to the variant boundaries.
    if (runs.length >= 2) {
      const positions: number[] = [];
      let totalStrength = 0;
      for (const boundary of [1, 2]) {
        const expected = Math.round((span * boundary) / columns);
        const best = runs
          .map((run) => ({ ...run, distance: Math.abs(run.mid - expected) }))
          .sort((a, b) => a.distance - b.distance)[0]!;
        if (best.distance > span * 0.12) return null;
        positions.push(best.mid);
        totalStrength += best.strength - best.distance;
      }
      return { positions: positions.sort((a, b) => a - b), score: totalStrength };
    }
    // Two variants: one band near the middle.
    if (runs.length === 1 && Math.abs(runs[0]!.mid - span / 2) <= span * 0.15) {
      return { positions: [runs[0]!.mid], score: runs[0]!.strength };
    }
    return null;
  };

  const xPlan = plan(columnBackground, width);
  const yPlan = plan(rowBackground, height);
  if (xPlan === null && yPlan === null) return { axis: null, positions: [] };
  if (yPlan === null || (xPlan !== null && xPlan.score >= yPlan.score)) {
    return { axis: "x", positions: xPlan!.positions };
  }
  return { axis: "y", positions: yPlan!.positions };
}

const TOLERANCE = 24;
const GAP_FRACTION = 0.92;
const ALPHA_BACKGROUND = 16;

function sampleBackgroundColor(rgba: Uint8Array, width: number, height: number) {
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const sum = [0, 0, 0, 0];
  for (const corner of corners) {
    const offset = (corner[1]! * width + corner[0]!) * 4;
    sum[0] = sum[0]! + rgba[offset]!;
    sum[1] = sum[1]! + rgba[offset + 1]!;
    sum[2] = sum[2]! + rgba[offset + 2]!;
    sum[3] = sum[3]! + rgba[offset + 3]!;
  }
  return [sum[0]! / 4, sum[1]! / 4, sum[2]! / 4, sum[3]! / 4];
}

interface TileBuffer {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

function cutVertically(
  rgba: Uint8Array,
  width: number,
  height: number,
  bounds: number[],
): TileBuffer[] {
  const tiles: TileBuffer[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const start = bounds[index]!;
    const tileWidth = bounds[index + 1]! - start;
    if (tileWidth <= 0) continue;
    const tile = new Uint8Array(tileWidth * height * 4);
    for (let y = 0; y < height; y++) {
      const sourceRow = (y * width + start) * 4;
      tile.set(rgba.subarray(sourceRow, sourceRow + tileWidth * 4), y * tileWidth * 4);
    }
    tiles.push({ width: tileWidth, height, rgba: tile });
  }
  return tiles;
}

function cutHorizontally(
  rgba: Uint8Array,
  width: number,
  height: number,
  bounds: number[],
): TileBuffer[] {
  const tiles: TileBuffer[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const start = bounds[index]!;
    const tileHeight = bounds[index + 1]! - start;
    if (tileHeight <= 0) continue;
    const tile = new Uint8Array(width * tileHeight * 4);
    for (let y = 0; y < tileHeight; y++) {
      const sourceRow = (start + y) * width * 4;
      tile.set(rgba.subarray(sourceRow, sourceRow + width * 4), y * width * 4);
    }
    tiles.push({ width, height: tileHeight, rgba: tile });
  }
  return tiles;
}

function evenPositions(span: number, columns: number): number[] {
  const positions: number[] = [];
  for (const boundary of [1, 2]) {
    positions.push(Math.round((span * boundary) / columns));
  }
  return positions;
}
