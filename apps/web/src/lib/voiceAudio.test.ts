import { describe, expect, it } from "vite-plus/test";

import { encodeBytesToBase64, encodeWavPcm16 } from "./voiceAudio";

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);

const readInt16 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset, true);

describe("encodeWavPcm16", () => {
  it("lays out a canonical 44-byte mono PCM16 header", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWavPcm16([samples], 16_000);

    expect(wav.byteLength).toBe(44 + samples.length * 2);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(readUint32(wav, 4)).toBe(36 + samples.length * 2);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(readUint32(wav, 16)).toBe(16);
    expect(readUint16(wav, 20)).toBe(1); // linear PCM
    expect(readUint16(wav, 22)).toBe(1); // mono
    expect(readUint32(wav, 24)).toBe(16_000); // sample rate
    expect(readUint32(wav, 28)).toBe(16_000 * 2); // byte rate
    expect(readUint16(wav, 32)).toBe(2); // block align
    expect(readUint16(wav, 34)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(readUint32(wav, 40)).toBe(samples.length * 2);
  });

  it("quantizes and clamps samples across chunk boundaries", () => {
    const wav = encodeWavPcm16([new Float32Array([0, 1]), new Float32Array([-1, 2, -2])], 16_000);

    expect(readUint32(wav, 40)).toBe(5 * 2);
    expect(readInt16(wav, 44)).toBe(0);
    expect(readInt16(wav, 46)).toBe(0x7fff);
    expect(readInt16(wav, 48)).toBe(-0x8000);
    // Out-of-range floats clamp instead of wrapping.
    expect(readInt16(wav, 50)).toBe(0x7fff);
    expect(readInt16(wav, 52)).toBe(-0x8000);
  });

  it("encodes an empty recording as a header-only file", () => {
    const wav = encodeWavPcm16([], 16_000);
    expect(wav.byteLength).toBe(44);
    expect(readUint32(wav, 40)).toBe(0);
  });
});

describe("encodeBytesToBase64", () => {
  it("matches the platform encoder on small payloads", () => {
    const bytes = new TextEncoder().encode("voice dictation");
    expect(encodeBytesToBase64(bytes)).toBe(btoa("voice dictation"));
  });

  it("survives payloads larger than one call-stack chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const decoded = atob(encodeBytesToBase64(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(bytes.length - 1)).toBe((bytes.length - 1) % 251);
  });
});
