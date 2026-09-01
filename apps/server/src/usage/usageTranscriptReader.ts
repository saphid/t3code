// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for transcript scanning.
 *
 * Isolated here so the rest of the usage code stays on Effect's `FileSystem`.
 * The direct `node:fs` streaming is deliberate: a cold 30-day window is ~1.4 GB
 * across ~1,500 files, and `readline` over a read stream is roughly an order of
 * magnitude cheaper than materialising each file. The equivalent Effect stream
 * pipeline is idiomatic but not fast enough to sit behind a page load.
 *
 * @module usageTranscriptReader
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { createHash } from "node:crypto";

import type { UsageProviderKind } from "@t3tools/contracts";

import {
  initialCodexScanState,
  mightCarryUsage,
  parseClaudeLineRecords,
  parseCodexLine,
  parseGrokLine,
  type UsageRecord,
} from "./usageTranscripts.ts";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mtimeNs: string;
  readonly device: string;
  readonly inode: string;
}

const FINGERPRINT_CHUNK_BYTES = 4 * 1024;

/**
 * Lists `.jsonl` transcripts under `root` last modified at or after `sinceMs`.
 *
 * Errors on individual entries are swallowed: session files rotate and get
 * removed while the walk is in flight, and a partial listing is far better than
 * failing the page.
 *
 * `fileName` restricts the walk to a single basename (Grok's `updates.jsonl`).
 * Grok sessions also ship multi-megabyte `chat_history` and `events` logs that
 * never carry usage, so the basename filter keeps a cold scan off those files.
 */
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
  options?: { readonly fileName?: string },
): Promise<readonly TranscriptFile[]> {
  const found: TranscriptFile[] = [];
  const fileName = options?.fileName;

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (fileName !== undefined) {
        if (entry.name !== fileName) continue;
      } else if (!entry.name.endsWith(".jsonl")) {
        continue;
      }
      try {
        const stats = await NodeFSP.stat(child, { bigint: true });
        const mtimeMs = Number(stats.mtimeNs) / 1_000_000;
        if (mtimeMs >= sinceMs) {
          found.push({
            path: child,
            size: Number(stats.size),
            mtimeMs,
            mtimeNs: String(stats.mtimeNs),
            device: String(stats.dev),
            inode: String(stats.ino),
          });
        }
      } catch {
        // Vanished between readdir and stat.
      }
    }
  };

  await walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Collision-resistant sample of the bytes most likely to change in an
 * append-only transcript. Metadata remains part of cache identity, while the
 * first and last chunks catch timestamp-preserving rewrites and coarse mtime
 * filesystems without reading every warm file in full.
 */
export async function readTranscriptFingerprint(
  filePath: string,
  observedSize: number,
): Promise<string | null> {
  let handle: NodeFSP.FileHandle | null = null;
  try {
    handle = await NodeFSP.open(filePath, "r");
    const hash = createHash("sha256");
    hash.update(String(observedSize));
    hash.update("\0");

    const headLength = Math.min(observedSize, FINGERPRINT_CHUNK_BYTES);
    const head = Buffer.allocUnsafe(headLength);
    const headRead = await handle.read(head, 0, headLength, 0);
    hash.update(head.subarray(0, headRead.bytesRead));

    if (observedSize > FINGERPRINT_CHUNK_BYTES) {
      const tailLength = Math.min(observedSize - FINGERPRINT_CHUNK_BYTES, FINGERPRINT_CHUNK_BYTES);
      const tail = Buffer.allocUnsafe(tailLength);
      const tailRead = await handle.read(tail, 0, tailLength, observedSize - tailLength);
      hash.update(tail.subarray(0, tailRead.bytesRead));
    }

    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Filesystem identity of a directory, as `device:inode`.
 *
 * Used to tell "two servers reading the same transcript directory" apart from
 * "two machines whose hostname and home path happen to match". Returns an empty
 * string when the directory cannot be stat'd.
 */
export async function readDirectoryVolumeId(path: string): Promise<string> {
  try {
    const stats = await NodeFSP.stat(path);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return "";
  }
}

/**
 * Streams one transcript and returns the usage records it contains, or `null`
 * when the file could not be read.
 *
 * The distinction matters to the caller's cache: a genuinely empty transcript
 * is a stable fact worth memoising, while a transient read failure memoised
 * under the same `(size, mtime)` key would silently drop that file's usage
 * until the file next changes.
 *
 * Codex carries the active model on `turn_context` lines that hold no usage of
 * their own, so those still have to pass through the reducer to keep model
 * attribution correct.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProviderKind,
  observedSize?: number,
): Promise<readonly UsageRecord[] | null> {
  if (observedSize === 0) return [];
  const records: UsageRecord[] = [];
  const codexState = initialCodexScanState();

  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, {
        encoding: "utf8",
        ...(observedSize === undefined ? {} : { end: observedSize - 1 }),
      }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (provider === "codex") {
        if (
          !mightCarryUsage(line, provider) &&
          !line.includes('"turn_context"') &&
          !line.includes('"session_meta"')
        ) {
          continue;
        }
        const record = parseCodexLine(line, codexState);
        if (record !== null) records.push(record);
        continue;
      }

      if (provider === "grok") {
        if (!mightCarryUsage(line, provider)) continue;
        for (const grokRecord of parseGrokLine(line)) records.push(grokRecord);
        continue;
      }

      if (!mightCarryUsage(line, provider)) continue;
      for (const record of parseClaudeLineRecords(line)) records.push(record);
    }
  } catch {
    return null;
  }

  return records;
}

/** Prefixes that mark an injected preamble, not something the user typed. */
const NOT_TITLE_PREFIXES = ["<", "# AGENTS.md instructions", "Caveat: the messages below"];

const TITLE_MAX_LENGTH = 80;
const TITLE_MAX_LINES = 400;

function cleanTitle(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const collapsed = text.split(/\s+/).join(" ").trim();
  if (collapsed.length === 0) return null;
  if (NOT_TITLE_PREFIXES.some((prefix) => collapsed.startsWith(prefix))) return null;
  return collapsed.length > TITLE_MAX_LENGTH
    ? `${collapsed.slice(0, TITLE_MAX_LENGTH - 1)}\u2026`
    : collapsed;
}

function claudeTitleFromLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["type"] !== "user") return null;
  const message = record["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content === "string") return cleanTitle(content);
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const entry = block as Record<string, unknown>;
    if (entry["type"] !== "text") continue;
    const title = cleanTitle(entry["text"]);
    if (title !== null) return title;
  }
  return null;
}

function codexTitleFromLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = (parsed as Record<string, unknown>)["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record["type"] !== "message" || record["role"] !== "user") return null;
  const content = record["content"];
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const title = cleanTitle((block as Record<string, unknown>)["text"]);
    if (title !== null) return title;
  }
  return null;
}

/**
 * First thing the user actually typed in a session, as a display title.
 *
 * Only called for the handful of unattributed rows that survived the response
 * cap, so a second bounded read per row is fine. Returns null when the file
 * cannot be read, holds no user text (Grok logs carry none we trust), or only
 * injected preambles appear early on.
 */
export async function readTranscriptTitle(
  filePath: string,
  provider: UsageProviderKind,
): Promise<string | null> {
  if (provider === "grok") return null;
  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let seen = 0;
    for await (const line of lines) {
      seen += 1;
      if (seen > TITLE_MAX_LINES) break;
      const gate = provider === "claude" ? '"user"' : '"message"';
      if (!line.includes(gate)) continue;
      const title = provider === "claude" ? claudeTitleFromLine(line) : codexTitleFromLine(line);
      if (title !== null) {
        lines.close();
        return title;
      }
    }
  } catch {
    return null;
  }
  return null;
}
