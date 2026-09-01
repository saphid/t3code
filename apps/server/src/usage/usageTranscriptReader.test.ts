// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  listTranscriptFiles,
  readTranscriptFingerprint,
  readTranscriptRecords,
} from "./usageTranscriptReader.ts";

const tempDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-usage-reader-"));
  tempDirectories.push(directory);
  return directory;
}

function claudeLine(messageId: string, outputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-07T04:05:13.944Z",
    sessionId: "session-a",
    cwd: "/work/app",
    message: {
      id: messageId,
      model: "claude-fable-5",
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
        output_tokens: outputTokens,
      },
    },
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("listTranscriptFiles", () => {
  it("returns stable path ordering and exact file identity", async () => {
    const directory = makeTempDirectory();
    NodeFS.writeFileSync(NodePath.join(directory, "z.jsonl"), "z\n");
    NodeFS.writeFileSync(NodePath.join(directory, "a.jsonl"), "a\n");

    const files = await listTranscriptFiles(directory, 0);

    expect(files.map((file) => NodePath.basename(file.path))).toEqual(["a.jsonl", "z.jsonl"]);
    expect(files.every((file) => file.mtimeNs.length > 0)).toBe(true);
    expect(files.every((file) => file.device.length > 0 && file.inode.length > 0)).toBe(true);
  });
});

describe("transcript snapshots", () => {
  it("changes the fingerprint when sampled content changes at the same size", async () => {
    const directory = makeTempDirectory();
    const filePath = NodePath.join(directory, "session.jsonl");
    NodeFS.writeFileSync(filePath, "a".repeat(10_000));
    const first = await readTranscriptFingerprint(filePath, 10_000);

    NodeFS.writeFileSync(filePath, `${"a".repeat(9_999)}b`);
    const second = await readTranscriptFingerprint(filePath, 10_000);

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("does not read bytes appended after the observed size", async () => {
    const directory = makeTempDirectory();
    const filePath = NodePath.join(directory, "session.jsonl");
    const firstLine = `${claudeLine("msg_1", 10)}\n`;
    NodeFS.writeFileSync(filePath, firstLine);
    const observedSize = NodeFS.statSync(filePath).size;
    NodeFS.appendFileSync(filePath, `${claudeLine("msg_2", 20)}\n`);

    const records = await readTranscriptRecords(filePath, "claude", observedSize);

    expect(records?.map((record) => record.dedupeKey)).toEqual(["msg_1:"]);
  });
});
