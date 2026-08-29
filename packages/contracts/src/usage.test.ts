import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { UsageSourceFingerprint } from "./usage.ts";

const decode = Schema.decodeUnknownSync(UsageSourceFingerprint);

describe("UsageSourceFingerprint", () => {
  it("decodes a trusted cross-boundary source identity", () => {
    const fingerprint = decode({
      hostId: "windows-host",
      provider: "claude",
      resolvedHomePath: "C:\\Users\\Alex\\.claude\\projects",
      volumeId: "123:456",
      sourceIdentity: `windows-fs-v1:${"a".repeat(64)}`,
    });

    expect(fingerprint.sourceIdentity).toBe(`windows-fs-v1:${"a".repeat(64)}`);
  });

  it("still decodes a legacy fingerprint with no source identity", () => {
    const fingerprint = decode({
      hostId: "linux-host",
      provider: "codex",
      resolvedHomePath: "/home/alex/.codex/sessions",
      volumeId: "67:890",
    });

    expect(fingerprint.sourceIdentity).toBeUndefined();
  });
});
