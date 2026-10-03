import * as Effect from "effect/Effect";

import * as PluginTools from "../../../plugins/PluginTools.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { PluginToolsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const tools = yield* PluginTools.PluginTools;
  return PluginToolsToolkit.of({
    // Scope and grants come from the session's credential, never from the agent.
    plugin_tools_list: (input) =>
      McpInvocationContext.McpInvocationContext.pipe(
        Effect.flatMap((scope) =>
          tools.list(
            scope.pluginToolGrants ?? [],
            input.plugin === undefined ? undefined : { plugin: input.plugin },
          ),
        ),
      ),
    plugin_tool_call: (input) =>
      McpInvocationContext.McpInvocationContext.pipe(
        Effect.flatMap((scope) =>
          tools.call(scope.pluginToolGrants ?? [], {
            tool: input.tool,
            input: input.input ?? {},
            context: { environmentId: scope.environmentId, threadId: scope.threadId },
          }),
        ),
        Effect.map((result) => ({ result })),
      ),
  });
});

export const PluginToolsToolkitHandlersLive = PluginToolsToolkit.toLayer(make);
