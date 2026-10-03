import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import {
  VIEW_BOOTSTRAP_SOURCE,
  ViewDocumentError,
  WRAPPED_VIEW_BOOTSTRAP_SOURCE,
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

  it("wraps the view in a script-free policy frame whose srcdoc decodes to the view exactly", async () => {
    const viewSource = `document.title = "a & b"; const quote = '"';`;
    const html = await buildViewDocument({
      viewSource,
      declaredDigest: nodeDigest(viewSource),
      title: "view",
      navigationPolicy: "wrapper",
    });
    const [wrapperHtml, attribute] = html.split(' srcdoc="');
    expect(wrapperHtml).not.toContain("<script");
    expect(wrapperHtml).toContain(`sandbox="allow-scripts"`);
    const inner = attribute!
      .slice(0, attribute!.lastIndexOf('"'))
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    expect(inner).toContain(`<script>${WRAPPED_VIEW_BOOTSTRAP_SOURCE}</script>`);
    expect(inner).toContain(`<script>${viewSource}</script>`);
    const policyOf = (document: string) =>
      /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(document)?.[1];
    // default-src 'none' in the wrapper is what refuses the view's own navigations.
    expect(policyOf(wrapperHtml!)).toBe(policyOf(inner));
    expect(policyOf(inner)).toContain(`'sha256-${nodeDigest(WRAPPED_VIEW_BOOTSTRAP_SOURCE)}'`);
    expect(policyOf(inner)?.startsWith("default-src 'none'")).toBe(true);
  });
});
