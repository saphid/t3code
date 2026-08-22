/**
 * Pure audio plumbing for voice dictation: PCM float chunks to a 16-bit WAV
 * container, and bytes to base64 without blowing the call stack.
 *
 * Kept free of Web Audio types so the header layout is unit-testable.
 *
 * @module lib/voiceAudio
 */

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/**
 * Encodes captured mono Float32 chunks as a 16 kHz-style PCM16 WAV file.
 * Samples are clamped to [-1, 1] before quantization, matching what every
 * WAV writer does with out-of-range float input.
 */
export function encodeWavPcm16(
  chunks: ReadonlyArray<Float32Array>,
  sampleRate: number,
): Uint8Array {
  let sampleCount = 0;
  for (const chunk of chunks) sampleCount += chunk.length;

  const dataBytes = sampleCount * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: linear PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, chunk[index]!));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Resamples mono PCM float samples by linear interpolation. Browsers may
 * ignore a requested AudioContext sample rate and capture at their native
 * rate (typically 48 kHz), so recordings are brought down to the rate the
 * transcriber expects before WAV encoding. Output length is
 * `round(samples.length * toRate / fromRate)`.
 */
export function resamplePcmMono(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;

  const outputLength = Math.round((samples.length * toRate) / fromRate);
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  const lastIndex = samples.length - 1;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lower = Math.min(lastIndex, Math.floor(position));
    const upper = Math.min(lastIndex, lower + 1);
    const fraction = position - lower;
    output[index] = samples[lower]! + (samples[upper]! - samples[lower]!) * fraction;
  }
  return output;
}

/**
 * Chunk size for base64 encoding. `String.fromCharCode(...chunk)` puts every
 * byte on the call stack, so the chunk must stay far below engine argument
 * limits; 32 KiB is the customary safe figure.
 */
const BASE64_CHUNK_BYTES = 0x8000;

/** Base64-encodes arbitrary-length bytes without spreading them onto the call stack. */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}
