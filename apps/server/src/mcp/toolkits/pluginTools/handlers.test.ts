import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PluginInstallationId,
  PluginToolError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as PluginTools from "../../../plugins/PluginTools.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const grants = [{ installationId: PluginInstallationId.make("installation-1"), generation: 3 }];
const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-plugin-tools"),
  threadId: ThreadId.make("thread-plugin-tools"),
  providerSessionId: "provider-session-plugin-tools",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(),
  issuedAt: 1,
  pluginToolGrants: grants,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "mcp-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

it.effect(
  "takes grants and thread from the credential and marks the call tool conservatively",
  () => {
    const seen: Array<unknown> = [];
    const tools = Layer.mock(PluginTools.PluginTools)({
      list: (granted, options) =>
        Effect.sync(() => {
          seen.push({ granted, options });
          return { tools: [], notInThisSession: [] };
        }),
      call: (granted, request) =>
        Effect.suspend(() => {
          seen.push({ granted, request });
          return request.tool === "acme.search/lookup"
            ? Effect.succeed({ hits: 1 })
            : Effect.fail(
                new PluginToolError({ reason: "unknown-tool", message: "No such tool." }),
              );
        }),
    });
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const registered = Object.fromEntries(server.tools.map(({ tool }) => [tool.name, tool]));
      expect(registered.plugin_tools_list?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(registered.plugin_tool_call?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
      const callTool = (name: string, args: Record<string, unknown>) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );

      const listed = yield* callTool("plugin_tools_list", { plugin: "acme.search", cursor: "a" });
      expect(listed.isError).toBe(false);
      // A context the agent passes is only input; the plugin gets the credential's.
      const called = yield* callTool("plugin_tool_call", {
        tool: "acme.search/lookup",
        input: { q: "x", context: { threadId: "spoofed" } },
      });
      expect(called).toMatchObject({ isError: false, structuredContent: { result: { hits: 1 } } });
      const failed = yield* callTool("plugin_tool_call", { tool: "acme.search/nope" });
      expect(failed.isError).toBe(true);
      expect(failed.content).toEqual([{ type: "text", text: "No such tool." }]);

      expect(seen).toEqual([
        { granted: grants, options: { plugin: "acme.search", cursor: "a" } },
        {
          granted: grants,
          request: {
            tool: "acme.search/lookup",
            input: { q: "x", context: { threadId: "spoofed" } },
            context: { environmentId: invocation.environmentId, threadId: invocation.threadId },
          },
        },
        {
          granted: grants,
          request: {
            tool: "acme.search/nope",
            input: {},
            context: { environmentId: invocation.environmentId, threadId: invocation.threadId },
          },
        },
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        McpHttpServer.PluginToolsRegistrationLive.pipe(
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provide(tools),
        ),
      ),
    );
  },
);
