import { describe, expect, it } from "vite-plus/test";

import { decodePng, encodePng, PngError, resizeToSquareIcon } from "./png.ts";

function canvas(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return rgba;
}

describe("png", () => {
  it("round-trips RGBA pixels", () => {
    const rgba = canvas(5, 3, (x, y) => [x * 40, y * 80, 7, 255 - x]);
    const decoded = decodePng(encodePng(5, 3, rgba));
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(3);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("center-crops to a square and averages down to the target size", () => {
    // 12x8: a 2-px red margin on each side of an 8x8 left-blue/right-green square.
    const rgba = canvas(12, 8, (x) =>
      x < 2 || x >= 10 ? [255, 0, 0, 255] : x < 6 ? [0, 0, 255, 255] : [0, 255, 0, 255],
    );
    const icon = decodePng(resizeToSquareIcon(encodePng(12, 8, rgba), 2));
    expect(icon.width).toBe(2);
    expect(icon.height).toBe(2);
    expect(Array.from(icon.rgba)).toEqual([
      0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255,
    ]);
  });

  it("does not darken colors next to transparent pixels", () => {
    const rgba = canvas(2, 2, (x) => (x === 0 ? [200, 100, 50, 255] : [0, 0, 0, 0]));
    const icon = decodePng(resizeToSquareIcon(encodePng(2, 2, rgba), 1));
    expect(Array.from(icon.rgba)).toEqual([200, 100, 50, 128]);
  });

  it("never upscales", () => {
    const rgba = canvas(4, 4, () => [1, 2, 3, 255]);
    expect(decodePng(resizeToSquareIcon(encodePng(4, 4, rgba), 256)).width).toBe(4);
  });

  it("rejects non-PNG payloads", () => {
    expect(() => resizeToSquareIcon(new TextEncoder().encode("nope"), 16)).toThrow(PngError);
  });
});
