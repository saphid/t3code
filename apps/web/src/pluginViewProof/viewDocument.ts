/**
 * Builds the document for an isolated plugin view.
 *
 * Every script the view executes is inline and listed by SHA-256 in a frame
 * CSP that sits first in the document. The frame inherits the app's own
 * policy (srcdoc shares the parent's policy container), so this policy can only
 * narrow what runs: no app-wide CSP change, no blob: or remote script source.
 */

export class ViewDocumentError extends Error {
  readonly _tag = "ViewDocumentError";
  constructor(
    readonly reason: "digest_mismatch" | "unsafe_source",
    message: string,
  ) {
    super(message);
  }
}

/** Base64 SHA-256 of the UTF-8 bytes, matching the CSP `'sha256-…'` source format. */
export async function sha256Base64(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The HTML parser rewrites CR and NUL and ends a script at `</script`, so the
// executed text would no longer be the hashed bytes. `<!--` and `<script` can
// switch the tokenizer into escaped states. Refuse instead of escaping.
const UNSAFE_INLINE_SCRIPT = /<\/script|<!--|<script|[\r\0]/i;

export function assertInlineSafe(source: string, label: string): void {
  if (UNSAFE_INLINE_SCRIPT.test(source)) {
    throw new ViewDocumentError(
      "unsafe_source",
      `${label} contains a sequence that cannot be inlined byte-for-byte.`,
    );
  }
}

/** Host-owned handshake: accepts exactly one port, only from the embedding window. */
export const VIEW_BOOTSTRAP_SOURCE = `(() => {
  const host = window.parent;
  let resolvePort;
  const port = new Promise((resolve) => { resolvePort = resolve; });
  let connected = false;
  let rejected = 0;
  Object.defineProperty(window, "t3View", {
    value: Object.freeze({ port, rejectedConnects: () => rejected }),
  });
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "t3-view:connect") return;
    event.stopImmediatePropagation();
    if (connected || event.source !== host || event.ports.length !== 1) {
      rejected += 1;
      return;
    }
    connected = true;
    resolvePort({ port: event.ports[0], generation: data.generation, init: data.init });
  });
  host.postMessage({ type: "t3-view:ready" }, "*");
})();`;

export interface ViewDocumentInput {
  readonly viewSource: string;
  /** Digest declared by the plugin's manifest, base64 SHA-256. */
  readonly declaredDigest: string;
  readonly title: string;
}

export async function buildViewDocument(input: ViewDocumentInput): Promise<string> {
  assertInlineSafe(input.viewSource, "View script");
  const viewDigest = await sha256Base64(input.viewSource);
  if (viewDigest !== input.declaredDigest) {
    throw new ViewDocumentError(
      "digest_mismatch",
      `View script digest ${viewDigest} does not match the declared ${input.declaredDigest}.`,
    );
  }
  const bootstrapDigest = await sha256Base64(VIEW_BOOTSTRAP_SOURCE);
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${bootstrapDigest}' 'sha256-${viewDigest}'`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const title = input.title.replace(/[<>&"]/g, "");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title><script>${VIEW_BOOTSTRAP_SOURCE}</script></head><body><script>${input.viewSource}</script></body></html>`;
}
