/**
 * PluginTools - Tools a trusted local plugin offers to agents.
 *
 * A plugin that declares the `tools` capability (and `proposedApi: true`)
 * registers two kinds of handlers with `context.proposed.handle`:
 *
 * ```js
 * handle("t3.tools.describe", () => ({
 *   tools: [{
 *     name: "word_count",
 *     description: "Count the words in a text.",
 *     inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
 *     sideEffect: "read",
 *   }],
 * }));
 * handle("t3.tool.word_count", ({ input }) => ({ words: input.text.split(/\s+/).length }));
 * ```
 *
 * Agents never see one MCP tool per plugin tool. Every provider session gets
 * the same two fixed tools: `plugin_tools_list` returns the descriptors below,
 * qualified by plugin id, and `plugin_tool_call` calls one by that name. The
 * host validates every call against the declared input schema before the
 * plugin sees it. `sideEffect` and `openWorld` are metadata for the agent, not
 * enforcement: the plugin is trusted local code.
 *
 * @module PluginTools
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PluginId } from "./plugin.ts";

/** The manifest capability a plugin declares to offer tools. */
export const PLUGIN_TOOLS_CAPABILITY = "tools";

/** Handler that answers with a `PluginToolsDescription`. */
export const PLUGIN_TOOLS_DESCRIBE_HANDLER = "t3.tools.describe";

/** Handler that runs one tool; it receives a `PluginToolCallInput`. */
export const pluginToolHandlerName = (name: PluginToolName) => `t3.tool.${name}`;

export const PLUGIN_TOOL_LIMITS = {
  maxToolsPerPlugin: 32,
  /** Serialized `inputSchema` of one tool. */
  maxInputSchemaBytes: 16 * 1024,
  /** Serialized answer of the describe handler. */
  maxDescriptionBytes: 64 * 1024,
  /** Serialized `plugin_tools_list` result; whole plugins past it are listed as omitted. */
  maxListBytes: 64 * 1024,
  /** Serialized result of one tool call. */
  maxResultBytes: 64 * 1024,
  defaultTimeoutSeconds: 60,
  maxTimeoutSeconds: 600,
} as const;

/** Unique within its plugin; agents address it as `<pluginId>/<name>`. */
export const PluginToolName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/));
export type PluginToolName = typeof PluginToolName.Type;

/**
 * What a tool may do: `read` only observes, `write` changes state, and
 * `destructive` may lose data. Shown to the agent; not enforced.
 */
export const PluginToolSideEffect = Schema.Literals(["read", "write", "destructive"]);
export type PluginToolSideEffect = typeof PluginToolSideEffect.Type;

const PluginToolTitle = Schema.String.check(Schema.isMaxLength(100));
const PluginToolDescriptionText = TrimmedNonEmptyString.check(Schema.isMaxLength(2000));

/** A JSON Schema (draft 2020-12) object; the root must describe an object. */
const JsonSchemaObject = Schema.Record(Schema.String, Schema.Json);

/** One tool as its plugin declares it. */
export const PluginToolDescriptor = Schema.Struct({
  name: PluginToolName,
  title: Schema.optionalKey(PluginToolTitle),
  description: PluginToolDescriptionText,
  /**
   * JSON Schema for the tool's input object. `$defs` with local
   * `#/$defs/<name>` references are supported; `pattern` is not. A plugin
   * written with Effect Schema can pass `Schema.toJsonSchemaDocument(schema)`.
   */
  inputSchema: JsonSchemaObject,
  sideEffect: PluginToolSideEffect,
  /** True when the tool reaches outside this machine (network, external services). */
  openWorld: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: PLUGIN_TOOL_LIMITS.maxTimeoutSeconds }),
    ),
  ),
});
export type PluginToolDescriptor = typeof PluginToolDescriptor.Type;

/** The describe handler's answer. */
export const PluginToolsDescription = Schema.Struct({
  tools: Schema.Array(PluginToolDescriptor).check(
    Schema.isMaxLength(PLUGIN_TOOL_LIMITS.maxToolsPerPlugin),
  ),
});
export type PluginToolsDescription = typeof PluginToolsDescription.Type;

/**
 * What a tool handler receives. `input` already matched the tool's schema.
 * `context` comes from the calling session's credential, never from the agent.
 */
export const PluginToolCallInput = Schema.Struct({
  input: Schema.Record(Schema.String, Schema.Json),
  context: Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId }),
});
export type PluginToolCallInput = typeof PluginToolCallInput.Type;

/** `<pluginId>/<name>`, the name agents call a tool by. */
export const qualifyPluginToolName = (pluginId: PluginId, name: PluginToolName) =>
  `${pluginId}/${name}`;

const decodeQualifiedParts = Schema.decodeUnknownOption(
  Schema.Struct({ pluginId: PluginId, name: PluginToolName }),
);

export const parseQualifiedPluginToolName = (tool: string) => {
  const slash = tool.indexOf("/");
  return slash === -1
    ? decodeQualifiedParts(undefined)
    : decodeQualifiedParts({ pluginId: tool.slice(0, slash), name: tool.slice(slash + 1) });
};

const PluginToolPlugin = Schema.Struct({ id: PluginId, name: Schema.String });

/** One tool as `plugin_tools_list` shows it. */
export const PluginToolListing = Schema.Struct({
  tool: Schema.String,
  plugin: PluginToolPlugin,
  title: Schema.optionalKey(PluginToolTitle),
  description: Schema.String,
  /** Derived by the host from the declared schema; calls are validated against exactly this. */
  inputSchema: JsonSchemaObject,
  sideEffect: PluginToolSideEffect,
  openWorld: Schema.Boolean,
});
export type PluginToolListing = typeof PluginToolListing.Type;

export const PluginToolsListResult = Schema.Struct({
  tools: Schema.Array(PluginToolListing),
  /** Granted plugins whose tools could not be read right now. */
  unavailable: Schema.Array(Schema.Struct({ plugin: PluginToolPlugin, reason: Schema.String })),
  /** Granted plugins left out to keep the result small; list them one at a time. */
  omitted: Schema.Array(Schema.Struct({ plugin: PluginToolPlugin, tools: Schema.Int })),
  /** Tool plugins enabled after this session started; a new session can use them. */
  notInThisSession: Schema.Array(PluginToolPlugin),
});
export type PluginToolsListResult = typeof PluginToolsListResult.Type;

/**
 * Why a plugin tool call or listing failed. `reason` is an open string; in
 * use: `not-granted`, `unavailable`, `unknown-tool`, `invalid-input`,
 * `timeout`, `failed`, `result-too-large`.
 */
export class PluginToolError extends Schema.TaggedError<PluginToolError>()("PluginToolError", {
  reason: Schema.String,
  message: Schema.String,
}) {}
