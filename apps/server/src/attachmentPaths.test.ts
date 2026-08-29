import { describe, expect, it } from "vite-plus/test";

import { resolveAttachmentRelativePath } from "./attachmentPaths.ts";

describe("attachmentPaths", () => {
  it("keeps Linux attachment files under environment-owned storage", () => {
    const attachmentsDir = "/var/lib/t3/userdata/attachments";

    expect(
      resolveAttachmentRelativePath({
        attachmentsDir,
        relativePath: "thread-1-00000000-0000-4000-8000-000000000001.png",
      }),
    ).toBe("/var/lib/t3/userdata/attachments/thread-1-00000000-0000-4000-8000-000000000001.png");
    expect(
      resolveAttachmentRelativePath({
        attachmentsDir,
        relativePath: "/private/var/mobile/tmp/スクリーンショット.png",
      }),
    ).toBeNull();
    expect(
      resolveAttachmentRelativePath({
        attachmentsDir,
        relativePath: String.raw`C:\Users\client\AppData\Local\Temp\screenshot.png`,
      }),
    ).toBeNull();
  });

  it("rejects relative traversal outside attachment storage", () => {
    expect(
      resolveAttachmentRelativePath({
        attachmentsDir: "/var/lib/t3/userdata/attachments",
        relativePath: "../../tmp/screenshot.png",
      }),
    ).toBeNull();
  });
});
