import { describe, expect, it } from "vite-plus/test";

import { decodePng, encodePng, PngError, sliceHorizontalGrid } from "./pngGrid.ts";

function solidTile(width: number, height: number, rgb: readonly [number, number, number]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, png: encodePng(width, height, rgba) };
}

function pixelAt(png: Uint8Array, x: number, y: number): readonly [number, number, number, number] {
  const { width, rgba } = decodePng(png);
  const offset = (y * width + x) * 4;
  return [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!];
}

function concatGrid(tiles: ReadonlyArray<{ png: Uint8Array; rgba: Uint8Array }>) {
  const { width: tileWidth, height } = decodePng(tiles[0]!.png);
  const width = tiles.reduce((sum) => sum + tileWidth, 0);
  const rgba = new Uint8Array(width * height * 4);
  let xOffset = 0;
  for (const tile of tiles) {
    for (let y = 0; y < height; y++) {
      const sourceRow = y * tileWidth * 4;
      rgba.set(tile.rgba.subarray(sourceRow, sourceRow + tileWidth * 4), (y * width + xOffset) * 4);
    }
    xOffset += tileWidth;
  }
  return encodePng(width, height, rgba);
}

function concatGridRows(tiles: ReadonlyArray<{ png: Uint8Array; rgba: Uint8Array }>) {
  const { width, height: tileHeight } = decodePng(tiles[0]!.png);
  const height = tiles.length * tileHeight;
  const rgba = new Uint8Array(width * height * 4);
  tiles.forEach((tile, row) => {
    rgba.set(tile.rgba, row * tileHeight * width * 4);
  });
  return encodePng(width, height, rgba);
}

const red = () => solidTile(32, 32, [200, 10, 10]);
const green = () => solidTile(32, 32, [10, 200, 10]);
const blue = () => solidTile(32, 32, [10, 10, 200]);

/** A solid icon centered on a uniform near-white background canvas. */
function paddedTile(
  iconWidth: number,
  iconHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  rgb: readonly [number, number, number],
) {
  const rgba = new Uint8Array(canvasWidth * canvasHeight * 4);
  const offsetX = Math.floor((canvasWidth - iconWidth) / 2);
  const offsetY = Math.floor((canvasHeight - iconHeight) / 2);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const target = (y * canvasWidth + x) * 4;
      const inside =
        x >= offsetX && x < offsetX + iconWidth && y >= offsetY && y < offsetY + iconHeight;
      rgba[target] = inside ? rgb[0] : 250;
      rgba[target + 1] = inside ? rgb[1] : 250;
      rgba[target + 2] = inside ? rgb[2] : 250;
      rgba[target + 3] = 255;
    }
  }
  return { rgba, png: encodePng(canvasWidth, canvasHeight, rgba) };
}

/** A solid icon centered on a fully transparent canvas. */
function transparentPaddedTile(
  iconSize: number,
  canvas: number,
  rgb: readonly [number, number, number],
) {
  const rgba = new Uint8Array(canvas * canvas * 4);
  const offset = Math.floor((canvas - iconSize) / 2);
  for (let y = offset; y < offset + iconSize; y++) {
    for (let x = offset; x < offset + iconSize; x++) {
      const target = (y * canvas + x) * 4;
      rgba[target] = rgb[0];
      rgba[target + 1] = rgb[1];
      rgba[target + 2] = rgb[2];
      rgba[target + 3] = 255;
    }
  }
  return { rgba, png: encodePng(canvas, canvas, rgba) };
}

describe("pngGrid", () => {
  it("round-trips RGBA pixels", () => {
    const { width, height, rgba } = decodePng(
      encodePng(
        3,
        2,
        new Uint8Array([
          1, 2, 3, 255, 4, 5, 6, 128, 0, 0, 0, 0, 255, 254, 253, 9, 9, 9, 9, 9, 7, 8, 9, 10,
        ]),
      ),
    );
    expect([width, height]).toEqual([3, 2]);
    expect(rgba).toEqual(
      new Uint8Array([
        1, 2, 3, 255, 4, 5, 6, 128, 0, 0, 0, 0, 255, 254, 253, 9, 9, 9, 9, 9, 7, 8, 9, 10,
      ]),
    );
  });

  it("slices a three-icon horizontal grid into the source tiles", () => {
    const red = solidTile(32, 32, [200, 10, 10]);
    const green = solidTile(32, 32, [10, 200, 10]);
    const blue = solidTile(32, 32, [10, 10, 200]);
    const grid = concatGrid([red, green, blue]);
    const tiles = sliceHorizontalGrid(grid, 3);
    expect(tiles).toHaveLength(3);
    expect(pixelAt(tiles[0]!, 0, 0)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 31, 31)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 16, 8)).toEqual([10, 10, 200, 255]);
  });

  it("slices a vertical stack along the height", () => {
    const tiles = sliceHorizontalGrid(concatGridRows([red(), green(), blue()]), 3);
    expect(tiles).toHaveLength(3);
    expect(decodePng(tiles[0]!)).toMatchObject({ width: 32, height: 32 });
    expect(pixelAt(tiles[0]!, 0, 0)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 16, 16)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 31, 31)).toEqual([10, 10, 200, 255]);
  });

  it("follows background gaps in a portrait canvas with a vertical stack", () => {
    const tiles = sliceHorizontalGrid(
      concatGridRows([
        paddedTile(32, 32, 40, 40, [200, 10, 10]),
        paddedTile(32, 32, 40, 40, [10, 200, 10]),
        paddedTile(32, 32, 40, 40, [10, 10, 200]),
      ]),
      3,
    );
    expect(tiles).toHaveLength(3);
    // Tiles are cropped to their content and squared.
    expect(decodePng(tiles[0]!)).toMatchObject({ width: 32, height: 32 });
    expect(pixelAt(tiles[0]!, 16, 16)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 16, 16)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 16, 16)).toEqual([10, 10, 200, 255]);
  });

  it("follows background gaps in a landscape canvas with a horizontal row", () => {
    const tiles = sliceHorizontalGrid(
      concatGrid([
        paddedTile(32, 32, 40, 40, [200, 10, 10]),
        paddedTile(32, 32, 40, 40, [10, 200, 10]),
        paddedTile(32, 32, 40, 40, [10, 10, 200]),
      ]),
      3,
    );
    expect(tiles).toHaveLength(3);
    expect(decodePng(tiles[0]!)).toMatchObject({ width: 32, height: 32 });
    expect(pixelAt(tiles[0]!, 16, 16)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 16, 16)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 16, 16)).toEqual([10, 10, 200, 255]);
  });

  it("follows transparent separator bands in a square canvas with a vertical stack", () => {
    // Image models often return icons on a transparent canvas regardless of
    // the requested aspect ratio.
    const tiles = sliceHorizontalGrid(
      concatGridRows([
        transparentPaddedTile(32, 40, [200, 10, 10]),
        transparentPaddedTile(32, 40, [10, 200, 10]),
        transparentPaddedTile(32, 40, [10, 10, 200]),
      ]),
      3,
    );
    expect(tiles).toHaveLength(3);
    // Tiles are cropped to their content and squared.
    expect(decodePng(tiles[0]!)).toMatchObject({ width: 32, height: 32 });
    expect(pixelAt(tiles[0]!, 16, 16)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 16, 16)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 16, 16)).toEqual([10, 10, 200, 255]);
  });

  it("cuts a seamless square canvas into horizontal bands for a vertical stack", () => {
    const tiles = sliceHorizontalGrid(concatGridRows([red(), green(), blue()]), 3);
    expect(tiles).toHaveLength(3);
    expect(decodePng(tiles[0]!)).toMatchObject({ width: 32, height: 32 });
    expect(pixelAt(tiles[2]!, 31, 31)).toEqual([10, 10, 200, 255]);
  });

  it("falls back to a single square icon when the model ignored the grid", () => {
    // One wide icon centered on a transparent square canvas: cutting at the
    // boundaries yields blank strips, so the canvas is cropped and squared.
    const canvas = 40;
    const rgba = new Uint8Array(canvas * canvas * 4);
    for (let y = 16; y < 24; y++) {
      for (let x = 4; x < 36; x++) {
        const target = (y * canvas + x) * 4;
        rgba[target] = 8;
        rgba[target + 1] = 246;
        rgba[target + 2] = 7;
        rgba[target + 3] = 255;
      }
    }
    const tiles = sliceHorizontalGrid(encodePng(canvas, canvas, rgba), 3);
    expect(tiles).toHaveLength(1);
    const decoded = decodePng(tiles[0]!);
    expect(decoded.width).toBe(decoded.height);
    expect(pixelAt(tiles[0]!, 20, 15)).toEqual([8, 246, 7, 255]);
    expect(pixelAt(tiles[0]!, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("drops blank tiles when the model drew fewer variants than asked", () => {
    const tiles = sliceHorizontalGrid(
      concatGridRows([
        transparentPaddedTile(32, 40, [200, 10, 10]),
        transparentPaddedTile(32, 40, [10, 200, 10]),
      ]),
      3,
    );
    expect(tiles).toHaveLength(2);
    expect(pixelAt(tiles[0]!, 20, 20)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 20, 20)).toEqual([10, 200, 10, 255]);
  });

  it("drops near-duplicate variants the model drew twice", () => {
    const icon = transparentPaddedTile(32, 40, [200, 10, 10]);
    const tiles = sliceHorizontalGrid(
      concatGrid([icon, transparentPaddedTile(32, 40, [10, 200, 10]), icon]),
      3,
    );
    expect(tiles).toHaveLength(2);
    expect(pixelAt(tiles[0]!, 16, 16)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 16, 16)).toEqual([10, 200, 10, 255]);
  });

  it("tightens a sparse floating icon to its dense region", () => {
    // One small solid mark plus a faint glow trail spanning the canvas: the
    // bounding box covers everything, but the mass lives in the mark.
    const canvas = 60;
    const rgba = new Uint8Array(canvas * canvas * 4);
    for (let y = 20; y < 44; y++) {
      for (let x = 20; x < 44; x++) {
        const target = (y * canvas + x) * 4;
        rgba[target] = 200;
        rgba[target + 1] = 10;
        rgba[target + 2] = 10;
        rgba[target + 3] = 255;
      }
    }
    for (let x = 0; x < canvas; x++) {
      const target = (2 * canvas + x) * 4;
      rgba[target] = 200;
      rgba[target + 1] = 10;
      rgba[target + 2] = 10;
      rgba[target + 3] = 120;
    }
    const tiles = sliceHorizontalGrid(encodePng(canvas, canvas, rgba), 3);
    expect(tiles).toHaveLength(1);
    const decoded = decodePng(tiles[0]!);
    expect(decoded.width).toBe(decoded.height);
    // The dense 24x24 mark survives; the glow trail does not.
    expect(decoded.width).toBeLessThanOrEqual(30);
    expect(
      pixelAt(tiles[0]!, Math.floor(decoded.width / 2), Math.floor(decoded.height / 2)),
    ).toEqual([200, 10, 10, 255]);
  });

  it("keeps a full-bleed icon's background instead of cropping to its symbol", () => {
    const tiles = sliceHorizontalGrid(solidTile(48, 48, [10, 120, 200]).png, 3);
    expect(tiles).toHaveLength(1);
    const decoded = decodePng(tiles[0]!);
    expect([decoded.width, decoded.height]).toEqual([48, 48]);
    expect(pixelAt(tiles[0]!, 0, 0)).toEqual([10, 120, 200, 255]);
    expect(pixelAt(tiles[0]!, 47, 47)).toEqual([10, 120, 200, 255]);
  });

  it("cuts a stacked layout without usable gaps along the more distinct axis", () => {
    // Three edge-to-edge full-width icon cards stacked on an opaque canvas:
    // no background bands exist, and cutting vertically would slice every
    // card into near-identical vertical thirds.
    const size = 90;
    const rgba = new Uint8Array(size * size * 4);
    const cards = [
      [200, 10, 10],
      [10, 200, 10],
      [10, 10, 200],
    ] as const;
    cards.forEach((rgb, i) => {
      const top = i * 30;
      for (let y = top; y < top + 30; y++) {
        for (let x = 0; x < size; x++) {
          const target = (y * size + x) * 4;
          rgba[target] = rgb[0];
          rgba[target + 1] = rgb[1];
          rgba[target + 2] = rgb[2];
          rgba[target + 3] = 255;
        }
      }
    });
    const tiles = sliceHorizontalGrid(encodePng(size, size, rgba), 3);
    expect(tiles).toHaveLength(3);
    expect(pixelAt(tiles[0]!, 45, 45)).toEqual([200, 10, 10, 255]);
    expect(pixelAt(tiles[1]!, 45, 45)).toEqual([10, 200, 10, 255]);
    expect(pixelAt(tiles[2]!, 45, 45)).toEqual([10, 10, 200, 255]);
  });

  it("rejects a canvas with no visible content", () => {
    const blank = new Uint8Array(40 * 40 * 4);
    expect(() => sliceHorizontalGrid(encodePng(40, 40, blank), 3)).toThrow(PngError);
  });

  it("trims a remainder column instead of failing", () => {
    // Striped canvas: each third is a distinct full-bleed color.
    const rgba = new Uint8Array(10 * 4 * 4);
    const paint = (from: number, to: number, rgb: readonly [number, number, number]) => {
      for (let y = 0; y < 4; y++)
        for (let x = from; x < to; x++) {
          const o = (y * 10 + x) * 4;
          rgba[o] = rgb[0];
          rgba[o + 1] = rgb[1];
          rgba[o + 2] = rgb[2];
          rgba[o + 3] = 255;
        }
    };
    paint(0, 3, [200, 10, 10]);
    paint(3, 7, [10, 200, 10]);
    paint(7, 10, [10, 10, 200]);
    const tiles = sliceHorizontalGrid(encodePng(10, 4, rgba), 3);
    expect(tiles).toHaveLength(3);
    const decoded = decodePng(tiles[0]!);
    expect(decoded.width).toBe(decoded.height);
  });

  it("rejects non-PNG payloads", () => {
    expect(() => sliceHorizontalGrid(new TextEncoder().encode("not a png"), 3)).toThrow(PngError);
  });

  it("rejects grids too narrow for the column count", () => {
    expect(() => sliceHorizontalGrid(solidTile(2, 2, [0, 0, 0]).png, 3)).toThrow(PngError);
  });
});
