import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";

// A base64 chunk plus its bridge envelope remains well below the 1 MiB bound.
export const MOBILE_ASSET_CHUNK_BYTES = 256 * 1024;
export async function readMobileAsset(read: (offset: number) => Promise<unknown>) {
  let offset = 0;
  let bytes: Uint8Array | undefined;
  let mediaType = "";
  let sha256 = "";
  do {
    const chunk = (await read(offset)) as {
      base64: string;
      byteLength: number;
      mediaType: string;
      sha256: string;
    };
    if (!bytes) {
      if (
        !Number.isSafeInteger(chunk.byteLength) ||
        chunk.byteLength < 0 ||
        chunk.byteLength > 8 * 1024 * 1024
      )
        throw new Error("Asset too large");
      bytes = new Uint8Array(chunk.byteLength);
      mediaType = chunk.mediaType;
      sha256 = chunk.sha256;
    }
    const decoded = Result.getOrThrow(Encoding.decodeBase64(chunk.base64));
    if (
      chunk.byteLength !== bytes.length ||
      chunk.mediaType !== mediaType ||
      chunk.sha256 !== sha256 ||
      decoded.length > MOBILE_ASSET_CHUNK_BYTES ||
      (decoded.length === 0 && offset < bytes.length) ||
      offset + decoded.length > bytes.length
    )
      throw new Error("Asset transfer failed");
    bytes.set(decoded, offset);
    offset += decoded.length;
  } while (offset < bytes.length);
  return { bytes, mediaType, sha256 };
}
