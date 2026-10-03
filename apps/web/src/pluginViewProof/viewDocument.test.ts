import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import {
  VIEW_BOOTSTRAP_SOURCE,
  ViewDocumentError,
  buildViewDocument,
  sha256Base64,
} from "./viewDocument";

const nodeDigest = (source: string) =>
  NodeCrypto.createHash("sha256").update(source, "utf8").digest("base64");

describe("buildViewDocument", () => {
  it("allows exactly the bootstrap and the declared view script", async () => {
    const viewSource = "document.body.textContent = 'héllo';";
    const html = await buildViewDocument({
      viewSource,
      declaredDigest: nodeDigest(viewSource),
      title: "view",
    });
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
    expect(policy).toBe(
      [
        "default-src 'none'",
        `script-src 'sha256-${nodeDigest(VIEW_BOOTSTRAP_SOURCE)}' 'sha256-${nodeDigest(viewSource)}'`,
        "style-src 'unsafe-inline'",
        "img-src data:",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    );
    expect(html).toContain(`<script>${viewSource}</script>`);
  });

  it("refuses bytes that do not match the declared digest", async () => {
    await expect(
      buildViewDocument({ viewSource: "run()", declaredDigest: nodeDigest("other()"), title: "v" }),
    ).rejects.toMatchObject({ reason: "digest_mismatch" });
  });

  it.each(["a = '</script><img>'", "a = '<!--'", "a = 1;\r\nb = 2;", "a = '<SCRIPT>'"])(
    "refuses source the HTML parser would not execute byte-for-byte: %j",
    async (viewSource) => {
      const error = await buildViewDocument({
        viewSource,
        declaredDigest: nodeDigest(viewSource),
        title: "v",
      }).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ViewDocumentError);
      expect((error as ViewDocumentError).reason).toBe("unsafe_source");
    },
  );

  it("hashes UTF-8 bytes like the CSP hash source", async () => {
    expect(await sha256Base64("✓ view")).toBe(nodeDigest("✓ view"));
  });
});
