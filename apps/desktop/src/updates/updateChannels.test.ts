import { describe, expect, it } from "vite-plus/test";
import { isNightlyDesktopVersion, resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

describe("fork release channels", () => {
  it("keeps v2 distinct while using the Nightly identity", () => {
    expect(resolveDefaultDesktopUpdateChannel("0.0.39-nightly-v2.20260907.1788750000100000")).toBe(
      "nightly-v2",
    );
    expect(isNightlyDesktopVersion("0.0.39-nightly-v2.20260907.1788750000100000")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.39-nightly.20260907.1332")).toBe("nightly");
    expect(resolveDefaultDesktopUpdateChannel("0.0.39")).toBe("latest");
  });
});
