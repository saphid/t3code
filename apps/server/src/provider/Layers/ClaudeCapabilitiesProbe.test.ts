import { ClaudeSettings } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Cache from "effect/Cache";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";

import { makeClaudeCapabilitiesProbeCache } from "../Drivers/ClaudeDriver.ts";
import {
  buildClaudeCapabilitiesProbeQueryOptions,
  CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES,
  isLegacyClaudeModel,
  probeClaudeCapabilities,
} from "./ClaudeProvider.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

it("keeps only the Claude 5 family out of legacy models", () => {
  assert.deepStrictEqual(
    ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8"].map((model) => [
      model,
      isLegacyClaudeModel(model),
    ]),
    [
      ["claude-fable-5", false],
      ["claude-opus-5", false],
      ["claude-sonnet-5", false],
      ["claude-opus-4-8", true],
    ],
  );
});

it("isolates Claude capability probes without dropping workspace setting sources", () => {
  const abortController = new AbortController();
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController,
    environment: {
      HOME: "/home/user",
      ENABLE_CLAUDEAI_MCP_SERVERS: "true",
    },
    cwd: "/workspace/project",
    platform: "darwin",
  });

  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.cwd, "/workspace/project");
  assert.deepEqual(options.settingSources, [...CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES]);
  assert.deepEqual(options.settings, { disableAllHooks: true });
  assert.deepEqual(options.allowedTools, []);
  assert.equal(options.persistSession, false);
  assert.equal(options.pathToClaudeCodeExecutable, "/usr/bin/claude");
  assert.equal(options.abortController, abortController);
  assert.equal(options.env?.HOME, "/home/user");
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(options.env?.CLAUDE_CODE_AUTO_CONNECT_IDE, undefined);
  assert.equal(options.spawnClaudeCodeProcess, undefined);
});

it("disables IDE discovery and installs bounded process ownership on Windows", () => {
  const abortController = new AbortController();
  const processController = {
    spawn: () => {
      throw new Error("unused");
    },
    reap: async () => {},
  };
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "C:\\Program Files\\Claude\\claude.exe",
    abortController,
    environment: {
      FORCE_CODE_TERMINAL: "0",
      CLAUDE_CODE_AUTO_CONNECT_IDE: "1",
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "0",
    },
    cwd: "C:\\工作区\\project",
    platform: "win32",
    processController,
  });

  assert.equal(options.env?.FORCE_CODE_TERMINAL, "1");
  assert.equal(options.env?.CLAUDE_CODE_AUTO_CONNECT_IDE, "0");
  assert.equal(options.env?.CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL, "1");
  assert.equal(options.spawnClaudeCodeProcess, processController.spawn);
});

it.effect("deduplicates concurrent capability callers and starts a new probe after expiry", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const releaseFirstProbe = yield* Deferred.make<void>();
    const cache = yield* makeClaudeCapabilitiesProbeCache((key: string) =>
      Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.flatMap((call) =>
          call === 1
            ? Deferred.await(releaseFirstProbe).pipe(Effect.as(`${key}-${call}`))
            : Effect.succeed(`${key}-${call}`),
        ),
      ),
    );

    const concurrentResults = yield* Effect.all(
      [Cache.get(cache, "account"), Cache.get(cache, "account"), Cache.get(cache, "account")],
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    assert.equal(yield* Ref.get(calls), 1);
    yield* Deferred.succeed(releaseFirstProbe, undefined);
    assert.deepStrictEqual(yield* Fiber.join(concurrentResults), [
      "account-1",
      "account-1",
      "account-1",
    ]);

    yield* TestClock.adjust("5 minutes");
    yield* TestClock.adjust("1 millis");
    assert.equal(yield* Cache.get(cache, "account"), "account-2");
    assert.equal(yield* Ref.get(calls), 2);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.layer(NodeServices.layer)("Claude capability probe SDK boundary", (it) => {
  it.effect("serializes strict no-MCP options and still resolves account capabilities", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-probe-sdk-" });
      const executablePath = path.join(tempDir, "fake-claude.mjs");
      const invocationPath = path.join(tempDir, "invocation.json");
      const workspaceCwd = path.join(tempDir, "workspace");
      yield* fs.makeDirectory(workspaceCwd, { recursive: true });

      yield* fs.writeFileString(
        executablePath,
        [
          "#!/usr/bin/env node",
          'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
          'import { createInterface } from "node:readline";',
          "const args = process.argv.slice(2);",
          'const mcpConfigIndex = args.indexOf("--mcp-config");',
          "const rawMcpConfig = mcpConfigIndex >= 0 ? args[mcpConfigIndex + 1] : undefined;",
          "let mcpConfig;",
          "if (rawMcpConfig) {",
          '  const contents = existsSync(rawMcpConfig) ? readFileSync(rawMcpConfig, "utf8") : rawMcpConfig;',
          "  try { mcpConfig = JSON.parse(contents); } catch { mcpConfig = contents; }",
          "}",
          "writeFileSync(process.env.T3_PROBE_INVOCATION_PATH, JSON.stringify({",
          "  args,",
          "  cwd: process.cwd(),",
          "  connectorEnv: process.env.ENABLE_CLAUDEAI_MCP_SERVERS,",
          "  mcpConfig,",
          "}));",
          "const lines = createInterface({ input: process.stdin });",
          'lines.on("line", (line) => {',
          "  const message = JSON.parse(line);",
          '  if (message.type !== "control_request" || message.request?.subtype !== "initialize") return;',
          "  process.stdout.write(JSON.stringify({",
          '    type: "control_response",',
          "    response: {",
          '      subtype: "success",',
          "      request_id: message.request_id,",
          "      response: {",
          '        commands: [{ name: "review", description: "Review changes", argumentHint: "[path]" }],',
          "        agents: [],",
          '        output_style: "default",',
          '        available_output_styles: ["default"],',
          "        models: [],",
          '        account: { email: "dev@example.com", subscriptionType: "pro", tokenSource: "oauth" },',
          "      },",
          "    },",
          '  }) + "\\n");',
          "});",
          "setInterval(() => {}, 1_000);",
          "",
        ].join("\n"),
      );
      yield* fs.chmod(executablePath, 0o755);

      const capabilities = yield* probeClaudeCapabilities(
        decodeClaudeSettings({ binaryPath: executablePath }),
        {
          ...process.env,
          T3_PROBE_INVOCATION_PATH: invocationPath,
          ENABLE_CLAUDEAI_MCP_SERVERS: "true",
        },
        workspaceCwd,
      );

      assert.deepEqual(capabilities, {
        email: "dev@example.com",
        subscriptionType: "pro",
        tokenSource: "oauth",
        apiProvider: undefined,
        slashCommands: [
          {
            name: "review",
            description: "Review changes",
            input: { hint: "[path]" },
          },
        ],
      });

      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const invocation = JSON.parse(yield* fs.readFileString(invocationPath)) as {
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly connectorEnv: string;
        readonly mcpConfig: unknown;
      };
      assert.equal(invocation.cwd, yield* fs.realPath(workspaceCwd));
      assert.equal(invocation.connectorEnv, "false");
      assert.equal(invocation.args.includes("--strict-mcp-config"), true);
      assert.equal(invocation.args.includes("--mcp-config"), false);
      assert.equal(invocation.mcpConfig, undefined);

      assert.equal(invocation.args.includes("--setting-sources=user,project,local"), true);

      const settingsFlagIndex = invocation.args.indexOf("--settings");
      assert.notEqual(settingsFlagIndex, -1);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const flagSettings = JSON.parse(invocation.args[settingsFlagIndex + 1] ?? "{}") as {
        readonly disableAllHooks?: boolean;
      };
      assert.equal(flagSettings.disableAllHooks, true);
    }).pipe(Effect.scoped),
  );
});
