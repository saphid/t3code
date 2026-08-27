// @effect-diagnostics nodeBuiltinImport:off - Release artifact contract tests.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  parseLinuxUpdateManifest,
  releaseArtifactUrls,
  verifyDesktopArtifact,
} from "./desktopArtifact.ts";

describe("packaged desktop artifact", () => {
  it("derives the official release manifest and AppImage URLs from the exact nightly", () => {
    expect(releaseArtifactUrls("0.0.36-nightly.20260827.1205")).toEqual({
      manifest:
        "https://github.com/pingdotgg/t3code/releases/download/v0.0.36-nightly.20260827.1205/nightly-linux.yml",
      artifact:
        "https://github.com/pingdotgg/t3code/releases/download/v0.0.36-nightly.20260827.1205/T3-Code-0.0.36-nightly.20260827.1205-x86_64.AppImage",
    });
  });

  it("binds the updater manifest to the exact version, file name, digest, and size", () => {
    const manifest = `version: 0.0.36-nightly.20260827.1205
files:
  - url: T3-Code-0.0.36-nightly.20260827.1205-x86_64.AppImage
    sha512: AGII2tByuGoK/WhkT/t8E/li6sm9gze0wM3hxN7iYVZVP9kVhdGIhJCxbvbT7BZk06DEosW7Wb7siLwfOchG9Q==
    size: 165503259
path: T3-Code-0.0.36-nightly.20260827.1205-x86_64.AppImage
sha512: AGII2tByuGoK/WhkT/t8E/li6sm9gze0wM3hxN7iYVZVP9kVhdGIhJCxbvbT7BZk06DEosW7Wb7siLwfOchG9Q==
`;
    expect(parseLinuxUpdateManifest(manifest, "0.0.36-nightly.20260827.1205")).toEqual({
      fileName: "T3-Code-0.0.36-nightly.20260827.1205-x86_64.AppImage",
      sha512:
        "AGII2tByuGoK/WhkT/t8E/li6sm9gze0wM3hxN7iYVZVP9kVhdGIhJCxbvbT7BZk06DEosW7Wb7siLwfOchG9Q==",
      size: 165503259,
    });
    expect(() => parseLinuxUpdateManifest(manifest, "0.0.36-nightly.20260827.1204")).toThrow(
      "version",
    );
  });

  it("rejects an AppImage whose bytes or size differ from the signed update manifest", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "desktop-artifact-"));
    const path = NodePath.join(root, "T3.AppImage");
    await NodeFSP.writeFile(path, "packaged electron bytes");
    const digest = NodeCrypto.createHash("sha512")
      .update("packaged electron bytes")
      .digest("base64");
    await expect(verifyDesktopArtifact(path, digest, 23)).resolves.toBeUndefined();
    await expect(verifyDesktopArtifact(path, digest, 22)).rejects.toThrow("size");
    await expect(
      verifyDesktopArtifact(path, Buffer.alloc(64).toString("base64"), 23),
    ).rejects.toThrow("SHA-512");
  });
});
