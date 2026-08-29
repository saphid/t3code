import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach } from "vite-plus/test";

import { OpenCodeSettings } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import { checkOpenCodeProviderStatus } from "./OpenCodeProvider.ts";
import type { OpenCodeInventory } from "../opencodeRuntime.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DEFAULT_VERSION_STDOUT = "opencode 1.14.19\n";

/**
 * The legacy `OpenCodeProviderLive` Layer + `OpenCodeProvider` service tag
 * are deleted. The snapshot-producing logic they wrapped now lives in the
 * standalone `checkOpenCodeProviderStatus(settings, cwd)` Effect, which
 * drivers call directly when building their per-instance snapshot
 * `ServerProviderShape`. Tests mirror that shape: build a settings payload,
 * invoke the check, assert on the returned snapshot.
 */

const runtimeMock = {
  state: {
    runVersionError: null as Error | null,
    versionNever: false,
    versionStarts: 0,
    versionFinalizers: 0,
    versionStdout: DEFAULT_VERSION_STDOUT,
    versionStderr: "",
    versionCode: 0,
    inventoryError: null as Error | null,
    inventoryNever: false,
    inventoryFinalizers: 0,
    inventoryCwd: null as string | null,
    closeCalls: 0,
    inventory: {
      providerList: { connected: [] as string[], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    } as unknown,
  },
  reset() {
    this.state.runVersionError = null;
    this.state.versionNever = false;
    this.state.versionStarts = 0;
    this.state.versionFinalizers = 0;
    this.state.versionStdout = DEFAULT_VERSION_STDOUT;
    this.state.versionStderr = "";
    this.state.versionCode = 0;
    this.state.inventoryError = null;
    this.state.inventoryNever = false;
    this.state.inventoryFinalizers = 0;
    this.state.inventoryCwd = null;
    this.state.closeCalls = 0;
    this.state.inventory = {
      providerList: { connected: [], all: [] as unknown[], default: {} },
      agents: [] as unknown[],
      skills: [] as unknown[],
    };
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: () =>
    Effect.succeed({
      url: "http://127.0.0.1:4301",
      exitCode: Effect.never,
    }),
  connectToOpenCodeServer: ({ serverUrl }) =>
    Effect.gen(function* () {
      if (!serverUrl) {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            runtimeMock.state.closeCalls += 1;
          }),
        );
      }
      return {
        url: serverUrl ?? "http://127.0.0.1:4301",
        exitCode: null,
        external: Boolean(serverUrl),
      };
    }),
  runOpenCodeCommand: () =>
    runtimeMock.state.versionNever
      ? Effect.acquireRelease(
          Effect.sync(() => {
            runtimeMock.state.versionStarts += 1;
          }),
          () =>
            Effect.sync(() => {
              runtimeMock.state.versionFinalizers += 1;
            }),
        ).pipe(Effect.andThen(Effect.never), Effect.scoped)
      : runtimeMock.state.runVersionError
        ? Effect.fail(
            new OpenCodeRuntimeError({
              operation: "runOpenCodeCommand",
              detail: runtimeMock.state.runVersionError.message,
              cause: runtimeMock.state.runVersionError,
            }),
          )
        : Effect.succeed({
            stdout: runtimeMock.state.versionStdout,
            stderr: runtimeMock.state.versionStderr,
            code: runtimeMock.state.versionCode,
          }),
  createOpenCodeSdkClient: () =>
    ({}) as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>,
  loadOpenCodeInventory: () =>
    runtimeMock.state.inventoryError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "loadOpenCodeInventory",
            detail: runtimeMock.state.inventoryError.message,
            cause: runtimeMock.state.inventoryError,
          }),
        )
      : Effect.succeed(runtimeMock.state.inventory as OpenCodeInventory),
  loadInventoryFromCli: ({ cwd }) => {
    runtimeMock.state.inventoryCwd = cwd;
    return runtimeMock.state.inventoryNever
      ? Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            runtimeMock.state.inventoryFinalizers += 1;
          }),
        ).pipe(Effect.andThen(Effect.never), Effect.scoped)
      : runtimeMock.state.inventoryError
        ? Effect.fail(
            new OpenCodeRuntimeError({
              operation: "loadInventoryFromCli",
              detail: runtimeMock.state.inventoryError.message,
              cause: runtimeMock.state.inventoryError,
            }),
          )
        : Effect.succeed(runtimeMock.state.inventory as OpenCodeInventory);
  },
};

beforeEach(() => {
  runtimeMock.reset();
});

const testLayer = Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(NodeServices.layer),
);

const makeOpenCodeSettings = (overrides?: Partial<OpenCodeSettings>): OpenCodeSettings =>
  decodeOpenCodeSettings({
    enabled: true,
    binaryPath: "opencode",
    serverUrl: "",
    serverPassword: "",
    customModels: [],
    ...overrides,
  });

it.layer(testLayer)("checkOpenCodeProviderStatus", (it) => {
  it.effect("shows a codex-style missing binary message", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("spawn opencode ENOENT");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, false);
      NodeAssert.equal(snapshot.probeFailure, "missing_binary");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode CLI (`opencode`) is not installed or not on PATH.",
      );
    }),
  );

  it.effect("distinguishes an incompatible OpenCode version", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionStdout = "opencode 1.14.18\n";

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.probeFailure, "incompatible_version");
      NodeAssert.match(snapshot.message ?? "", /too old/);
    }),
  );

  it.effect("distinguishes an ordinary nonzero version-probe exit", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionStdout = "";
      runtimeMock.state.versionStderr = "wrapper configuration failed\n";
      runtimeMock.state.versionCode = 7;

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.probeFailure, "nonzero_exit");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode CLI health check exited with code 7: wrapper configuration failed",
      );
    }),
  );

  it.effect("projects a timed-out version probe as a typed terminal failure", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error(
        "Timed out while running 'opencode --version' after 10000ms.",
      );
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.probeFailure, "timeout");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode provider check timed out. Retry after checking the configured binary or wrapper.",
      );
    }),
  );

  it.effect("bounds a version probe that never exits", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionNever = true;
      const fiber = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd()).pipe(
        Effect.forkChild,
      );

      yield* TestClock.adjust("10 seconds");

      const exit = fiber.pollUnsafe();
      NodeAssert.ok(exit, "the provider check should reach a terminal result");
      NodeAssert.equal(exit._tag, "Success");
      if (exit._tag === "Success") {
        NodeAssert.equal(exit.value.status, "error");
        NodeAssert.equal(exit.value.probeFailure, "timeout");
      }
      NodeAssert.equal(runtimeMock.state.versionStarts, 1);
      NodeAssert.equal(runtimeMock.state.versionFinalizers, 1);
    }),
  );

  it.effect("closes the active probe scope when its owner is cancelled", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionNever = true;
      const fiber = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd()).pipe(
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      NodeAssert.equal(runtimeMock.state.versionStarts, 1);
      yield* Fiber.interrupt(fiber);
      NodeAssert.equal(runtimeMock.state.versionFinalizers, 1);
    }),
  );

  it.effect("bounds and closes a health inventory probe that never exits", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryNever = true;
      const fiber = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd()).pipe(
        Effect.forkChild,
      );

      yield* TestClock.adjust("10 seconds");

      const exit = fiber.pollUnsafe();
      NodeAssert.ok(exit, "the inventory check should reach a terminal result");
      NodeAssert.equal(exit._tag, "Success");
      if (exit._tag === "Success") {
        NodeAssert.equal(exit.value.probeFailure, "timeout");
      }
      NodeAssert.equal(runtimeMock.state.inventoryFinalizers, 1);
    }),
  );

  it.effect("hides generic Effect.tryPromise text for local CLI probe failures", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("An error occurred in Effect.tryPromise");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.message, "Failed to execute OpenCode CLI health check.");
    }),
  );

  it.effect("emits OpenCode variant defaults so trait picker can resolve a visible selection", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventory = {
        providerList: {
          connected: ["openai"],
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  variants: {
                    none: {},
                    low: {},
                    medium: {},
                    high: {},
                    xhigh: {},
                  },
                },
              },
            },
          ],
          default: {},
        },
        agents: [
          { name: "build", hidden: false, mode: "primary" },
          { name: "plan", hidden: false, mode: "primary" },
        ],
      };

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());
      const model = snapshot.models.find((entry) => entry.slug === "openai/gpt-5.4");

      NodeAssert.ok(model);
      const variantDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "variant" && descriptor.type === "select",
      );
      NodeAssert.ok(variantDescriptor && variantDescriptor.type === "select");
      NodeAssert.equal(
        variantDescriptor.options.find((option) => option.isDefault === true)?.id,
        "medium",
      );
      const agentDescriptor = model.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "agent" && descriptor.type === "select",
      );
      NodeAssert.ok(agentDescriptor && agentDescriptor.type === "select");
      NodeAssert.equal(
        agentDescriptor.options.find((option) => option.isDefault === true)?.id,
        "build",
      );
    }),
  );

  it.effect("includes OpenCode skills in the provider snapshot", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventory = {
        providerList: {
          connected: ["openai"],
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.4": {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  variants: {},
                },
              },
            },
          ],
          default: {},
        },
        agents: [],
        skills: [
          {
            name: "openclaw-review",
            description: "Review OpenClaw workflow changes.",
            location: "/Users/test/.agents/skills/openclaw-review/SKILL.md",
          },
          {
            name: "openclaw-triage",
            description: "Triage OpenClaw routing issues.",
            location: "/Users/test/.agents/skills/openclaw-triage/SKILL.md",
          },
          {
            name: "missing-location",
            description: "This incomplete SDK row should be skipped.",
            location: "",
          },
        ],
      };

      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.deepEqual(
        snapshot.skills.map((skill) => ({
          name: skill.name,
          path: skill.path,
          enabled: skill.enabled,
          shortDescription: skill.shortDescription,
        })),
        [
          {
            name: "openclaw-review",
            path: "/Users/test/.agents/skills/openclaw-review/SKILL.md",
            enabled: true,
            shortDescription: "Review OpenClaw workflow changes.",
          },
          {
            name: "openclaw-triage",
            path: "/Users/test/.agents/skills/openclaw-triage/SKILL.md",
            enabled: true,
            shortDescription: "Triage OpenClaw routing issues.",
          },
        ],
      );
    }),
  );

  it.effect("does not spawn a local server for health check (uses CLI instead)", () =>
    Effect.gen(function* () {
      yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(runtimeMock.state.closeCalls, 0);
      NodeAssert.equal(runtimeMock.state.inventoryCwd, process.cwd());
    }),
  );

  it.effect("reports local model inventory failures without treating them as empty", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("opencode models failed");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.models.length, 0);
      NodeAssert.equal(
        snapshot.message,
        "Failed to execute OpenCode CLI health check: opencode models failed",
      );
    }),
  );

  it.effect("classifies a nonzero inventory command as a typed failure", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("OpenCode models command exited with code 9.");
      const snapshot = yield* checkOpenCodeProviderStatus(makeOpenCodeSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.probeFailure, "nonzero_exit");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode provider check failed: OpenCode models command exited with code 9.",
      );
    }),
  );
});

it.layer(testLayer)("checkOpenCodeProviderStatus with configured server URL", (it) => {
  it.effect("surfaces a friendly auth error for configured servers", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("401 Unauthorized");
      const snapshot = yield* checkOpenCodeProviderStatus(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
        process.cwd(),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(
        snapshot.message,
        "OpenCode server rejected authentication. Check the server URL and password.",
      );
    }),
  );

  it.effect("surfaces a friendly connection error for configured servers", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error(
        "fetch failed: connect ECONNREFUSED 127.0.0.1:9999",
      );
      const snapshot = yield* checkOpenCodeProviderStatus(
        makeOpenCodeSettings({
          serverUrl: "http://127.0.0.1:9999",
          serverPassword: "secret-password",
        }),
        process.cwd(),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(
        snapshot.message,
        "Couldn't reach the configured OpenCode server at http://127.0.0.1:9999. Check that the server is running and the URL is correct.",
      );
    }),
  );

  it.effect("types a configured server timeout", () =>
    Effect.gen(function* () {
      runtimeMock.state.inventoryError = new Error("request timed out");
      const snapshot = yield* checkOpenCodeProviderStatus(
        makeOpenCodeSettings({ serverUrl: "http://127.0.0.1:9999" }),
        process.cwd(),
      );

      NodeAssert.equal(snapshot.probeFailure, "timeout");
      NodeAssert.match(snapshot.message ?? "", /Couldn't reach/);
    }),
  );
});
