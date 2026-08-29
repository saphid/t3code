import * as NodeCrypto from "node:crypto";

import type { UsageProviderKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const MACHINE_GUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FILE_ID_PATTERN = /\b0x[0-9a-f]{16,32}\b/i;
const VOLUME_ID_PATTERN = /\b0x[0-9a-f]{8,32}\b/i;

export interface UsageSourceIdentityRuntime {
  readonly platform: NodeJS.Platform;
  readonly isWsl: boolean;
  readonly realpath: (path: string) => Effect.Effect<string | null>;
  readonly run: (executable: string, args: readonly string[]) => Effect.Effect<string | null>;
}

export interface UsageSourceIdentityResolver {
  readonly resolve: (
    provider: UsageProviderKind,
    transcriptDirectory: string,
  ) => Effect.Effect<string | undefined>;
}

/**
 * Returns one stable spelling for a local drive path. UNC paths are rejected:
 * they identify a Linux-native WSL directory or a network share, not a local
 * Windows directory that another server can prove through the same filesystem.
 */
export function canonicalizeWindowsPath(input: string): string | null {
  const withoutDevicePrefix = input.trim().replace(/^\\\\\?\\/, "");
  if (!/^[a-z]:[\\/]/i.test(withoutDevicePrefix)) return null;
  const drive = withoutDevicePrefix.slice(0, 2).toLowerCase();
  const segments: string[] = [];
  for (const segment of withoutDevicePrefix.slice(2).replaceAll("/", "\\").split("\\")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment.toLowerCase());
  }
  return `${drive}\\${segments.join("\\")}`;
}

export function deriveWindowsSourceIdentity(input: {
  readonly provider: UsageProviderKind;
  readonly canonicalPath: string;
  readonly machineGuid: string;
  readonly volumeId: string;
  readonly fileId: string;
}): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(
      [
        "windows-fs-v1",
        input.machineGuid.toLowerCase(),
        input.volumeId.toLowerCase(),
        input.fileId.toLowerCase(),
        input.provider,
        input.canonicalPath,
      ].join("\0"),
    )
    .digest("hex");
  return `windows-fs-v1:${digest}`;
}

function parseMatch(output: string | null, pattern: RegExp): string | null {
  return output?.match(pattern)?.[0]?.toLowerCase() ?? null;
}

/**
 * Builds an identity that Windows and WSL can independently reproduce for one
 * local Windows directory. Failure is deliberately an absence of identity;
 * clients then retain the stricter host/path/device fingerprint.
 */
export function makeUsageSourceIdentityResolver(
  runtime: UsageSourceIdentityRuntime,
): Effect.Effect<UsageSourceIdentityResolver> {
  return Effect.gen(function* () {
    const machineGuid = yield* Effect.cached(
      runtime
        .run("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
        .pipe(Effect.map((output) => parseMatch(output, MACHINE_GUID_PATTERN))),
    );
    const volumeIds = new Map<string, Effect.Effect<string | null>>();

    const volumeId = Effect.fn("UsageSourceIdentity.volumeId")(function* (drive: string) {
      const cached = volumeIds.get(drive);
      if (cached !== undefined) return yield* cached;
      const queried = yield* Effect.cached(
        runtime
          .run("fsutil.exe", ["fsinfo", "volumeinfo", `${drive}\\`])
          .pipe(Effect.map((output) => parseMatch(output, VOLUME_ID_PATTERN))),
      );
      volumeIds.set(drive, queried);
      return yield* queried;
    });

    const resolve = Effect.fn("UsageSourceIdentity.resolve")(function* (
      provider: UsageProviderKind,
      transcriptDirectory: string,
    ) {
      if (runtime.platform !== "win32" && !runtime.isWsl) return undefined;

      const realPath = yield* runtime.realpath(transcriptDirectory);
      if (realPath === null) return undefined;

      const windowsPathOutput = runtime.isWsl
        ? yield* runtime.run("wslpath", ["-w", realPath])
        : realPath;
      if (windowsPathOutput === null) return undefined;

      const canonicalPath = canonicalizeWindowsPath(windowsPathOutput);
      if (canonicalPath === null) return undefined;

      const drive = canonicalPath.slice(0, 2);
      const [resolvedMachineGuid, resolvedVolumeId, fileIdOutput] = yield* Effect.all(
        [
          machineGuid,
          volumeId(drive),
          runtime.run("fsutil.exe", ["file", "queryfileid", canonicalPath]),
        ],
        { concurrency: "unbounded" },
      );
      const fileId = parseMatch(fileIdOutput, FILE_ID_PATTERN);
      if (resolvedMachineGuid === null || resolvedVolumeId === null || fileId === null) {
        return undefined;
      }

      return deriveWindowsSourceIdentity({
        provider,
        canonicalPath,
        machineGuid: resolvedMachineGuid,
        volumeId: resolvedVolumeId,
        fileId,
      });
    });

    return { resolve };
  });
}
