import type { UsageProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  canonicalizeWindowsPath,
  deriveWindowsSourceIdentity,
  makeUsageSourceIdentityResolver,
} from "./usageSourceIdentity.ts";

const MACHINE_GUID = "12345678-1234-1234-1234-123456789abc";
const VOLUME_ID = "0xe660d46a60d442cb";
const FILE_ID = "0x0000000000000000001a000000000001";

function runtime(input: {
  readonly platform: NodeJS.Platform;
  readonly isWsl: boolean;
  readonly realPath: string;
  readonly windowsPath?: string;
  readonly machineGuid?: string;
  readonly volumeId?: string;
  readonly fileId?: string;
}) {
  return {
    platform: input.platform,
    isWsl: input.isWsl,
    realpath: () => Effect.succeed(input.realPath),
    run: (executable: string, args: readonly string[]) => {
      if (executable === "wslpath") return Effect.succeed(input.windowsPath ?? null);
      if (executable === "reg.exe") {
        return Effect.succeed(`MachineGuid    REG_SZ    ${input.machineGuid ?? MACHINE_GUID}`);
      }
      if (args[0] === "fsinfo") {
        return Effect.succeed(`NTFS Volume Serial Number : ${input.volumeId ?? VOLUME_ID}`);
      }
      if (args[0] === "file") return Effect.succeed(`File ID is ${input.fileId ?? FILE_ID}`);
      return Effect.succeed(null);
    },
  };
}

function resolve(
  provider: UsageProviderKind,
  input: Parameters<typeof runtime>[0],
): Effect.Effect<string | undefined> {
  return makeUsageSourceIdentityResolver(runtime(input)).pipe(
    Effect.flatMap((resolver) => resolver.resolve(provider, "ignored")),
  );
}

describe("usage source identity", () => {
  it("normalizes drive paths without accepting UNC or Linux-native paths", () => {
    expect(canonicalizeWindowsPath("C:/Users/Alex/.claude/projects")).toBe(
      "c:\\users\\alex\\.claude\\projects",
    );
    expect(canonicalizeWindowsPath("\\\\?\\D:\\History\\Codex")).toBe("d:\\history\\codex");
    expect(canonicalizeWindowsPath("\\\\wsl.localhost\\Ubuntu\\home\\alex")).toBeNull();
    expect(canonicalizeWindowsPath("/home/alex/.claude/projects")).toBeNull();
  });

  it.effect("gives Windows and WSL the same identity for one symlinked directory", () =>
    Effect.gen(function* () {
      const windows = yield* resolve("claude", {
        platform: "win32",
        isWsl: false,
        realPath: "C:\\Users\\Alex\\.claude\\projects",
      });
      const wsl = yield* resolve("claude", {
        platform: "linux",
        isWsl: true,
        realPath: "/mnt/c/Users/Alex/.claude/projects",
        windowsPath: "C:\\Users\\Alex\\.claude\\projects\n",
      });

      expect(wsl).toBe(windows);
      expect(windows).toMatch(/^windows-fs-v1:[0-9a-f]{64}$/);
    }),
  );

  it.effect("does not use distro or Linux hostname in the trusted identity", () =>
    Effect.gen(function* () {
      const renamedDistro = yield* resolve("codex", {
        platform: "linux",
        isWsl: true,
        realPath: "/custom-mount/d/History/Codex",
        windowsPath: "D:\\History\\Codex",
      });
      const manuallyStarted = yield* resolve("codex", {
        platform: "linux",
        isWsl: true,
        realPath: "/mnt/d/History/Codex",
        windowsPath: "d:/history/codex",
      });

      expect(renamedDistro).toBe(manuallyStarted);
    }),
  );

  it.effect.each([
    {
      name: "another machine",
      difference: { machineGuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    },
    { name: "another volume", difference: { volumeId: "0x1111111122222222" } },
    {
      name: "a copied directory",
      difference: { fileId: "0x0000000000000000001a000000000002" },
    },
  ])("keeps $name separate", ({ difference }) =>
    Effect.gen(function* () {
      const original = yield* resolve("claude", {
        platform: "win32",
        isWsl: false,
        realPath: "C:\\Users\\Alex\\.claude\\projects",
      });
      const other = yield* resolve("claude", {
        platform: "win32",
        isWsl: false,
        realPath: "C:\\Users\\Alex\\.claude\\projects",
        ...difference,
      });

      expect(other).not.toBe(original);
    }),
  );

  it("keeps provider homes separate even if they resolve to one directory", () => {
    const common = {
      canonicalPath: "c:\\history",
      machineGuid: MACHINE_GUID,
      volumeId: VOLUME_ID,
      fileId: FILE_ID,
    };

    expect(deriveWindowsSourceIdentity({ provider: "claude", ...common })).not.toBe(
      deriveWindowsSourceIdentity({ provider: "codex", ...common }),
    );
  });

  it.effect("omits identity for Linux-native and unprovable Windows paths", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve("claude", {
          platform: "linux",
          isWsl: false,
          realPath: "/home/alex/.claude/projects",
        }),
      ).toBeUndefined();
      expect(
        yield* resolve("claude", {
          platform: "linux",
          isWsl: true,
          realPath: "/home/alex/.claude/projects",
          windowsPath: "\\\\wsl.localhost\\Ubuntu\\home\\alex\\.claude\\projects",
        }),
      ).toBeUndefined();
    }),
  );
});
