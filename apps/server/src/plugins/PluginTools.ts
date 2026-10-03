/**
 * Tools that enabled plugins offer to agents, behind the two fixed MCP tools
 * `plugin_tools_list` and `plugin_tool_call`.
 *
 * A provider session holds a snapshot of grants, taken when its MCP credential
 * was prepared: the tool plugins enabled at that moment, each with its
 * registration generation. Every list and call intersects that snapshot with
 * the catalogue as it is now, so a plugin disabled, removed, or re-registered
 * since then is refused at once, and a plugin enabled later waits for a new
 * session. Calls are pinned to the granted generation all the way into the
 * supervisor, and disabling a plugin fails its calls in flight.
 */
import {
  PLUGIN_TOOL_LIMITS,
  PLUGIN_TOOLS_CAPABILITY,
  PLUGIN_TOOLS_DESCRIBE_HANDLER,
  type PluginInstallation,
  type PluginInstallationId,
  type PluginToolDescriptor,
  PluginToolError,
  type PluginToolListing,
  type PluginToolsListResult,
  PluginToolsDescription,
  parseQualifiedPluginToolName,
  pluginInstallationStatus,
  pluginToolHandlerName,
  qualifyPluginToolName,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaRepresentation from "effect/SchemaRepresentation";

import { PluginCatalog } from "./PluginCatalog.ts";

/** One tool plugin a session may use: the registration that was enabled when it was prepared. */
export interface PluginToolGrant {
  readonly installationId: PluginInstallationId;
  readonly generation: number;
}

interface PreparedTool {
  readonly listing: PluginToolListing;
  readonly validate: (input: unknown) => Exit.Exit<unknown, Schema.SchemaError>;
  readonly timeoutSeconds: number;
}

interface Description {
  readonly generation: number;
  readonly tools: ReadonlyMap<string, PreparedTool>;
  /** Serialized size of the listings, for the list budget. */
  readonly bytes: number;
}

type Plugin = PluginToolListing["plugin"];

const DESCRIBE_TIMEOUT = "15 seconds";
const MAX_REASON_LENGTH = 500;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const jsonBytes = (value: unknown) => Buffer.byteLength(encodeJson(value), "utf8");
const decodeDescription = Schema.decodeUnknownExit(PluginToolsDescription);
const decodeJsonObject = Schema.decodeUnknownExit(Schema.Record(Schema.String, Schema.Json));
const cut = (text: string) =>
  text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH)}…` : text;

const toolError = (reason: string, message: string) =>
  new PluginToolError({ reason, message: cut(message) });

const pluginOf = (installation: PluginInstallation): Plugin | undefined =>
  installation.manifest === null
    ? undefined
    : { id: installation.manifest.id, name: installation.manifest.name };

/** Enabled now, with consent that covers the tools capability. */
const offersTools = (installation: PluginInstallation) =>
  pluginInstallationStatus(installation) === "enabled" &&
  installation.manifest !== null &&
  installation.consent?.capabilities.includes(PLUGIN_TOOLS_CAPABILITY) === true;

/**
 * Turns a declared input schema into the validator the host enforces and the
 * JSON Schema derived from it, which is what the agent is shown. Patterns are
 * refused rather than run on the server's event loop.
 */
const prepareTool = (
  plugin: Plugin,
  descriptor: PluginToolDescriptor,
): PreparedTool | { readonly problem: string } => {
  if (jsonBytes(descriptor.inputSchema) > PLUGIN_TOOL_LIMITS.maxInputSchemaBytes)
    return {
      problem: `${descriptor.name}: inputSchema exceeds ${PLUGIN_TOOL_LIMITS.maxInputSchemaBytes} bytes.`,
    };
  const { $defs, ...root } = descriptor.inputSchema;
  let validator: Schema.Top;
  try {
    validator = SchemaRepresentation.fromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: root as never,
      definitions: ($defs ?? {}) as never,
    });
  } catch (error) {
    return {
      problem: `${descriptor.name}: inputSchema is not supported: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const derived = Schema.toJsonSchemaDocument(validator);
  if (derived.schema.type !== "object")
    return { problem: `${descriptor.name}: inputSchema must describe an object.` };
  const definitions = Object.keys(derived.definitions).length > 0;
  const inputSchema = decodeJsonObject(
    definitions ? { ...derived.schema, $defs: derived.definitions } : derived.schema,
  );
  if (Exit.isFailure(inputSchema))
    return { problem: `${descriptor.name}: inputSchema is not JSON.` };
  return {
    listing: {
      tool: qualifyPluginToolName(plugin.id, descriptor.name),
      plugin,
      ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
      description: descriptor.description,
      inputSchema: inputSchema.value,
      sideEffect: descriptor.sideEffect,
      openWorld: descriptor.openWorld,
    },
    validate: Schema.decodeUnknownExit(validator as Schema.Codec<unknown>),
    timeoutSeconds: descriptor.timeoutSeconds ?? PLUGIN_TOOL_LIMITS.defaultTimeoutSeconds,
  };
};

export interface PluginToolCallRequest {
  readonly tool: string;
  readonly input: unknown;
  readonly context: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
}

export class PluginTools extends Context.Service<
  PluginTools,
  {
    /** The tool plugins enabled right now, for a session's credential to hold. */
    readonly grants: Effect.Effect<ReadonlyArray<PluginToolGrant>>;
    /** Tools of the granted plugins that are still enabled under the same registration. */
    readonly list: (
      grants: ReadonlyArray<PluginToolGrant>,
      options?: { readonly plugin?: string },
    ) => Effect.Effect<PluginToolsListResult>;
    /** Validates `input` against the tool's schema and calls it under the granted registration. */
    readonly call: (
      grants: ReadonlyArray<PluginToolGrant>,
      request: PluginToolCallRequest,
    ) => Effect.Effect<Schema.Json, PluginToolError>;
  }
>()("t3/plugins/PluginTools") {}

export const make = Effect.gen(function* () {
  const catalog = yield* PluginCatalog;
  // A registration's tools cannot change: its bytes are checked before every fresh process.
  const descriptions = new Map<PluginInstallationId, Description>();

  const toolPlugins = catalog.list.pipe(
    Effect.map((snapshot) => snapshot.installations.filter(offersTools)),
  );

  /** Splits the live tool plugins into those this snapshot grants and those it does not. */
  const intersect = (grants: ReadonlyArray<PluginToolGrant>) =>
    toolPlugins.pipe(
      Effect.map((installations) => {
        const granted: Array<PluginInstallation> = [];
        const notGranted: Array<PluginInstallation> = [];
        for (const installation of installations)
          (grants.some(
            (grant) =>
              grant.installationId === installation.installationId &&
              grant.generation === installation.generation,
          )
            ? granted
            : notGranted
          ).push(installation);
        for (const installationId of descriptions.keys())
          if (!installations.some((installation) => installation.installationId === installationId))
            descriptions.delete(installationId);
        return { granted, notGranted };
      }),
    );

  const describe = Effect.fnUntraced(function* (installation: PluginInstallation, plugin: Plugin) {
    const cached = descriptions.get(installation.installationId);
    if (cached?.generation === installation.generation) return cached;
    const answer = yield* catalog
      .invoke(installation.installationId, PLUGIN_TOOLS_DESCRIBE_HANDLER, null, {
        timeout: DESCRIBE_TIMEOUT,
        generation: installation.generation,
      })
      .pipe(Effect.mapError((error) => toolError("unavailable", error.message)));
    if (jsonBytes(answer) > PLUGIN_TOOL_LIMITS.maxDescriptionBytes)
      return yield* toolError(
        "unavailable",
        `Its tool descriptions exceed ${PLUGIN_TOOL_LIMITS.maxDescriptionBytes} bytes.`,
      );
    const decoded = decodeDescription(answer);
    if (Exit.isFailure(decoded))
      return yield* toolError(
        "unavailable",
        `Its tool descriptions are invalid: ${Option.match(Exit.findErrorOption(decoded), {
          onNone: () => "unknown error",
          onSome: (error) => error.message,
        })}`,
      );
    const tools = new Map<string, PreparedTool>();
    for (const descriptor of decoded.value.tools) {
      if (tools.has(descriptor.name))
        return yield* toolError("unavailable", `It declares ${descriptor.name} twice.`);
      const prepared = prepareTool(plugin, descriptor);
      if ("problem" in prepared) return yield* toolError("unavailable", prepared.problem);
      tools.set(descriptor.name, prepared);
    }
    const description: Description = {
      generation: installation.generation,
      tools,
      bytes: jsonBytes([...tools.values()].map((tool) => tool.listing)),
    };
    descriptions.set(installation.installationId, description);
    return description;
  });

  const grants = toolPlugins.pipe(
    Effect.map((installations) =>
      installations.map(({ installationId, generation }) => ({ installationId, generation })),
    ),
  );

  const list = Effect.fn("PluginTools.list")(function* (
    grants: ReadonlyArray<PluginToolGrant>,
    options?: { readonly plugin?: string },
  ) {
    const { granted, notGranted } = yield* intersect(grants);
    const selected = (installation: PluginInstallation) =>
      options?.plugin === undefined || installation.manifest?.id === options.plugin;
    const described = yield* Effect.forEach(
      granted.filter(selected),
      (installation) => {
        const plugin = pluginOf(installation);
        return plugin === undefined
          ? Effect.succeed(undefined)
          : describe(installation, plugin).pipe(
              Effect.result,
              Effect.map((result) => ({ plugin, result })),
            );
      },
      { concurrency: 4 },
    );
    const result: {
      tools: Array<PluginToolListing>;
      unavailable: Array<{ plugin: Plugin; reason: string }>;
      omitted: Array<{ plugin: Plugin; tools: number }>;
    } = { tools: [], unavailable: [], omitted: [] };
    let budget = PLUGIN_TOOL_LIMITS.maxListBytes;
    for (const entry of described) {
      if (entry === undefined) continue;
      if (entry.result._tag === "Failure") {
        result.unavailable.push({ plugin: entry.plugin, reason: entry.result.failure.message });
        continue;
      }
      const description = entry.result.success;
      // Whole plugins only, so a listed plugin's tools are never partial. One plugin asked
      // for by id is bounded by its description limit instead.
      if (options?.plugin === undefined && description.bytes > budget) {
        result.omitted.push({ plugin: entry.plugin, tools: description.tools.size });
        continue;
      }
      budget -= description.bytes;
      for (const tool of description.tools.values()) result.tools.push(tool.listing);
    }
    return {
      ...result,
      notInThisSession: notGranted
        .filter(selected)
        .flatMap((installation) => pluginOf(installation) ?? []),
    } satisfies PluginToolsListResult;
  });

  const call = Effect.fn("PluginTools.call")(function* (
    grants: ReadonlyArray<PluginToolGrant>,
    request: PluginToolCallRequest,
  ) {
    const parsed = parseQualifiedPluginToolName(request.tool);
    if (Option.isNone(parsed))
      return yield* toolError(
        "unknown-tool",
        `${request.tool} is not a plugin tool name. Use a tool value from plugin_tools_list.`,
      );
    const { pluginId, name } = parsed.value;
    const { granted, notGranted } = yield* intersect(grants);
    const installation = granted.find((candidate) => candidate.manifest?.id === pluginId);
    const plugin = installation === undefined ? undefined : pluginOf(installation);
    if (installation === undefined || plugin === undefined)
      return yield* notGranted.some((candidate) => candidate.manifest?.id === pluginId)
        ? toolError(
            "not-granted",
            `Plugin ${pluginId} was enabled after this session started. Start a new session to use its tools.`,
          )
        : toolError("unavailable", `Plugin ${pluginId} is not enabled.`);
    const description = yield* describe(installation, plugin);
    const tool = description.tools.get(name);
    if (tool === undefined)
      return yield* toolError("unknown-tool", `Plugin ${pluginId} has no tool named ${name}.`);
    const validated = tool.validate(request.input ?? {});
    if (Exit.isFailure(validated))
      return yield* toolError(
        "invalid-input",
        `The input does not match ${request.tool}'s inputSchema: ${Option.match(
          Exit.findErrorOption(validated),
          { onNone: () => "unknown error", onSome: (error) => error.message },
        )}`,
      );
    const input = decodeJsonObject(validated.value);
    if (Exit.isFailure(input))
      return yield* toolError("invalid-input", "The input must be a JSON object.");
    const value = yield* catalog
      .invoke(
        installation.installationId,
        pluginToolHandlerName(name),
        { input: input.value, context: request.context },
        { timeout: `${tool.timeoutSeconds} seconds`, generation: installation.generation },
      )
      .pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "PluginCatalogError":
            case "PluginStoppedError":
            case "PluginNotEnabledError":
            case "PluginUnavailableError":
            case "PluginIncompatibleError":
              return toolError("unavailable", error.message);
            case "PluginTimeoutError":
              return toolError("timeout", error.message);
            default:
              return toolError("failed", error.message);
          }
        }),
      );
    if (jsonBytes(value) > PLUGIN_TOOL_LIMITS.maxResultBytes)
      return yield* toolError(
        "result-too-large",
        `${request.tool} returned more than ${PLUGIN_TOOL_LIMITS.maxResultBytes} bytes.`,
      );
    return value;
  });

  return PluginTools.of({ grants, list, call });
});

export const layer = Layer.effect(PluginTools, make);
