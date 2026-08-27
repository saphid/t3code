// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Downloads and verifies official packaged Electron nightlies.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const NIGHTLY_VERSION = /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;

export interface DesktopArtifactIdentity {
  readonly fileName: string;
  readonly sha512: string;
  readonly size: number;
}

function requireVersion(version: string): void {
  if (!NIGHTLY_VERSION.test(version)) throw new Error("desktop artifact version is not a nightly");
}

export function releaseArtifactUrls(version: string) {
  requireVersion(version);
  const tag = `v${version}`;
  const base = `https://github.com/pingdotgg/t3code/releases/download/${tag}`;
  return {
    manifest: `${base}/nightly-linux.yml`,
    artifact: `${base}/T3-Code-${version}-x86_64.AppImage`,
  };
}

function capture(text: string, expression: RegExp, name: string): string {
  const match = expression.exec(text);
  if (match?.[1] === undefined) throw new Error(`desktop update manifest has no ${name}`);
  return match[1];
}

export function parseLinuxUpdateManifest(text: string, version: string): DesktopArtifactIdentity {
  requireVersion(version);
  const declaredVersion = capture(text, /^version:\s*(\S+)\s*$/m, "version");
  if (declaredVersion !== version) throw new Error("desktop update manifest version mismatch");
  const expectedName = `T3-Code-${version}-x86_64.AppImage`;
  const fileName = capture(text, /^path:\s*(\S+)\s*$/m, "path");
  if (fileName !== expectedName) throw new Error("desktop update manifest path mismatch");
  const fileEntry = new RegExp(
    `^[ \\t]*- url:[ \\t]*${expectedName.replaceAll(".", "\\.")}[ \\t]*\\r?\\n` +
      "[ \\t]+sha512:[ \\t]*(\\S+)[ \\t]*\\r?\\n" +
      "[ \\t]+size:[ \\t]*(\\d+)[ \\t]*$",
    "m",
  ).exec(text);
  if (fileEntry?.[1] === undefined || fileEntry[2] === undefined) {
    throw new Error("desktop update manifest has no complete AppImage file entry");
  }
  const sha512 = fileEntry[1];
  const rootSha512 = capture(text, /^sha512:\s*(\S+)\s*$/m, "root SHA-512");
  if (sha512 !== rootSha512) throw new Error("desktop update manifest SHA-512 fields disagree");
  if (Buffer.from(sha512, "base64").length !== 64) {
    throw new Error("desktop update manifest SHA-512 is malformed");
  }
  const size = Number(fileEntry[2]);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("desktop update manifest size is invalid");
  }
  return { fileName, sha512, size };
}

export async function verifyDesktopArtifact(
  path: string,
  expectedSha512: string,
  expectedSize: number,
): Promise<void> {
  const stat = await NodeFSP.stat(path);
  if (stat.size !== expectedSize) throw new Error("desktop artifact size mismatch");
  const digest = NodeCrypto.createHash("sha512");
  await NodeStreamPromises.pipeline(NodeFS.createReadStream(path), digest);
  if (digest.digest("base64") !== expectedSha512) {
    throw new Error("desktop artifact SHA-512 mismatch");
  }
}

async function response(url: string): Promise<Response> {
  const value = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "t3-perf-electron-worker/1" },
  });
  if (!value.ok) throw new Error(`desktop artifact request failed: HTTP ${value.status}`);
  return value;
}

export async function downloadDesktopArtifact(
  version: string,
  outputPath: string,
): Promise<string> {
  const urls = releaseArtifactUrls(version);
  const identity = parseLinuxUpdateManifest(await (await response(urls.manifest)).text(), version);
  if (NodePath.basename(urls.artifact) !== identity.fileName) {
    throw new Error("desktop artifact URL does not match update manifest");
  }
  const temporary = `${outputPath}.${process.pid}.${NodeCrypto.randomUUID()}.part`;
  await NodeFSP.mkdir(NodePath.dirname(outputPath), { recursive: true });
  try {
    const artifact = await response(urls.artifact);
    if (artifact.body === null) throw new Error("desktop artifact response has no body");
    await NodeStreamPromises.pipeline(
      NodeStream.Readable.fromWeb(artifact.body as never),
      NodeFS.createWriteStream(temporary, { flags: "wx", mode: 0o700 }),
    );
    await verifyDesktopArtifact(temporary, identity.sha512, identity.size);
    await NodeFSP.chmod(temporary, 0o700);
    await NodeFSP.rename(temporary, outputPath);
    return identity.sha512;
  } catch (error) {
    await NodeFSP.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const { values } = NodeUtil.parseArgs({
    options: { version: { type: "string" }, out: { type: "string" } },
    strict: true,
  });
  if (values.version === undefined || values.out === undefined) {
    throw new Error("--version and --out are required");
  }
  process.stdout.write(`${await downloadDesktopArtifact(values.version, values.out)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
