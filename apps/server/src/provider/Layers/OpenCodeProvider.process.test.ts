import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { OpenCodeSettings } from "@t3tools/contracts";
import {
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import { checkOpenCodeProviderStatus } from "./OpenCodeProvider.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);
const decodeProbePids = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      wrapper: Schema.Number,
      descendant: Schema.Number,
    }),
  ),
);
const testLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.layer(testLayer)("OpenCode provider probe process lifecycle", (it) => {
  it.effect("times out a hanging wrapper and reaps its descendant process", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const hostEnvironment = yield* HostProcessEnvironment;
      const executablePath = yield* HostProcessExecutablePath;
      const hostPlatform = yield* HostProcessPlatform;
      const tempDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-opencode-probe-ü space-",
      });
      const pidPath = path.join(tempDir, "probe-pids.json");
      const scriptPath = path.join(tempDir, "hanging wrapper.mjs");
      const binaryPath = path.join(
        tempDir,
        hostPlatform === "win32" ? "opencode wrapper.cmd" : "opencode wrapper",
      );

      yield* fs.writeFileString(
        scriptPath,
        [
          'import { spawn } from "node:child_process";',
          'import { writeFileSync } from "node:fs";',
          "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "writeFileSync(process.env.T3_TEST_PROBE_PIDS, JSON.stringify({ wrapper: process.pid, descendant: descendant.pid }));",
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
      );
      yield* fs.writeFileString(
        binaryPath,
        [
          ...(hostPlatform === "win32" ? ["@echo off"] : ["#!/bin/sh"]),
          hostPlatform === "win32"
            ? '"%T3_TEST_NODE_BINARY%" "%T3_TEST_PROBE_SCRIPT%" %*'
            : 'exec "$T3_TEST_NODE_BINARY" "$T3_TEST_PROBE_SCRIPT" "$@"',
          "",
        ].join("\n"),
      );
      if (hostPlatform !== "win32") {
        yield* fs.chmod(binaryPath, 0o755);
      }

      const snapshot = yield* checkOpenCodeProviderStatus(
        decodeOpenCodeSettings({ enabled: true, binaryPath }),
        tempDir,
        {
          ...hostEnvironment,
          T3_TEST_NODE_BINARY: executablePath,
          T3_TEST_PROBE_PIDS: pidPath,
          T3_TEST_PROBE_SCRIPT: scriptPath,
        },
        { probeTimeoutMs: 500 },
      ).pipe(TestClock.withLive);

      const pids = decodeProbePids(yield* fs.readFileString(pidPath));
      NodeAssert.equal(snapshot.probeFailure, "timeout");
      NodeAssert.equal(processExists(pids.wrapper), false);
      NodeAssert.equal(processExists(pids.descendant), false);
    }),
  );
});
