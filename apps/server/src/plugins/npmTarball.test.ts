// @effect-diagnostics nodeBuiltinImport:off
import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { readNpmTarball, type NpmTarballLimits } from "./npmTarball.ts";
import { makeTar, makeTarball, type TarEntry } from "./npmTarball.testkit.ts";

const read = (entries: ReadonlyArray<TarEntry>, limits?: NpmTarballLimits) =>
  readNpmTarball(makeTarball(entries), limits);

const refusal = (entries: ReadonlyArray<TarEntry>, limits?: NpmTarballLimits) =>
  read(entries, limits).pipe(Effect.flip);

const manifest: TarEntry = { path: "package/package.json", data: "{}" };

describe("readNpmTarball", () => {
  it.effect("reads files below the package root, long names and executable bits included", () =>
    Effect.gen(function* () {
      const deep = `package/${"nested/".repeat(20)}deep.js`;
      const files = yield* read([
        { path: "package/", type: "5" },
        manifest,
        { path: "package/dist/main.js", data: "exports.activate = () => {};" },
        { path: "package/bin/tool", data: "#!/bin/sh", mode: 0o755 },
        { path: deep, data: "deep" },
      ]);
      expect(files.map((file) => file.path)).toEqual([
        "package.json",
        "dist/main.js",
        "bin/tool",
        deep.slice("package/".length),
      ]);
      expect(files.find((file) => file.path === "bin/tool")?.executable).toBe(true);
      expect(files.find((file) => file.path === "dist/main.js")?.executable).toBe(false);
      expect(new TextDecoder().decode(files[1]!.data)).toBe("exports.activate = () => {};");
    }),
  );

  it.effect("ignores binary extended attributes, as macOS tar writes them", () =>
    Effect.gen(function* () {
      // `SCHILY.xattr.com.apple.provenance` carries raw bytes that are not UTF-8.
      const xattr = Buffer.concat([
        new TextEncoder().encode("SCHILY.xattr.com.apple.provenance="),
        Uint8Array.from([0x01, 0x00, 0x00, 0x37, 0xff, 0xfe]),
      ]);
      const files = yield* read([
        { ...manifest, pax: [xattr] },
        { path: "package/main.js", data: "x", pax: [xattr] },
      ]);
      expect(files.map((file) => file.path)).toEqual(["package.json", "main.js"]);
      const link = yield* refusal([
        manifest,
        { path: "package/link.js", type: "2", linkname: "/etc/hosts", pax: [xattr] },
      ]);
      expect(link.message).toMatch(/is a link/);
    }),
  );

  it.effect("refuses links, special files, and paths that leave the package", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [ReadonlyArray<TarEntry>, RegExp]> = [
        [[manifest, { path: "package/link.js", type: "2", linkname: "/etc/passwd" }], /is a link/],
        [
          [manifest, { path: "package/hard.js", type: "1", linkname: "package/package.json" }],
          /is a link/,
        ],
        [[manifest, { path: "package/device", type: "3" }], /not a regular file/],
        [[manifest, { path: "/etc/evil.js", data: "x" }], /not a relative path/],
        [[manifest, { path: "package/../../evil.js", data: "x" }], /leaves or names/],
        [[manifest, { path: "package/./main.js", data: "x" }], /leaves or names/],
        [[manifest, { path: "package\\..\\evil.js", data: "x" }], /not a relative path/],
        [[manifest, { path: "C:/evil.js", data: "x" }], /not a relative path/],
        [[manifest, { path: "package", data: "a file as the root" }], /outside the package/],
        // The same file twice on a case-insensitive disk, or a file that is also a directory.
        [
          [
            manifest,
            { path: "package/Main.js", data: "a" },
            { path: "package/main.js", data: "b" },
          ],
          /more than one entry/,
        ],
        [
          [manifest, { path: "package/lib", data: "a" }, { path: "package/lib/x.js", data: "b" }],
          /both a file and a directory/,
        ],
        [
          [manifest, { path: "package/lib/x.js", data: "a" }, { path: "package/lib", data: "b" }],
          /more than one entry/,
        ],
      ];
      for (const [entries, message] of cases) {
        const error = yield* refusal(entries);
        expect(error.reason, entries.at(-1)!.path).toBe("npm-archive-unsafe");
        expect(error.message).toMatch(message);
      }
    }),
  );

  it.effect("refuses a corrupt, truncated, or non-gzip archive", () =>
    Effect.gen(function* () {
      const tar = makeTar([manifest, { path: "package/main.js", data: "x".repeat(2000) }]);
      const corrupt = Buffer.from(tar);
      corrupt[0] = corrupt[0]! ^ 1;
      const truncated = tar.subarray(0, 512 + 1024);
      for (const bytes of [
        NodeZlib.gzipSync(corrupt),
        NodeZlib.gzipSync(truncated),
        new TextEncoder().encode("not gzip"),
      ]) {
        const error = yield* readNpmTarball(bytes).pipe(Effect.flip);
        expect(error.reason).toBe("npm-archive-unsafe");
      }
    }),
  );

  it.effect("stops at the file, size, and unpacked-size limits", () =>
    Effect.gen(function* () {
      const limits = { maxTarballBytes: 1024 * 1024, maxFiles: 2, maxBytes: 1000 };
      const tooMany = yield* refusal(
        [manifest, { path: "package/a.js" }, { path: "package/b.js" }],
        limits,
      );
      expect(tooMany.reason).toBe("npm-too-large");
      const tooBig = yield* refusal([manifest, { path: "package/a.js", data: "x".repeat(1001) }], {
        ...limits,
        maxBytes: 1000,
      });
      expect(tooBig.reason).toBe("npm-too-large");
      // A small gzip that expands far past the bound is cut off while it is inflated.
      const bomb = NodeZlib.gzipSync(new Uint8Array(64 * 1024 * 1024));
      expect(bomb.length).toBeLessThan(128 * 1024);
      const inflated = yield* readNpmTarball(bomb, limits).pipe(Effect.flip);
      expect(inflated.reason).toBe("npm-too-large");
    }),
  );
});
