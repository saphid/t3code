export default function (__t3Host) {
var __t3Client = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // host-react:react
  var require_react = __commonJS({
    "host-react:react"(exports, module) {
      module.exports = __t3Host.React;
    }
  });

  // host-react:react/jsx-runtime
  var require_jsx_runtime = __commonJS({
    "host-react:react/jsx-runtime"(exports) {
      var R = __t3Host.React;
      exports.Fragment = R.Fragment;
      exports.jsx = exports.jsxs = exports.jsxDEV = (type, props, key) => R.createElement(type, key === void 0 ? props : { ...props, key });
    }
  });

  // generated-client.ts
  var generated_client_exports = {};
  __export(generated_client_exports, {
    default: () => generated_client_default
  });

  // ../../extension-sdk/dist/contracts.js
  var API_VERSION = 1;
  var MAX_PAYLOAD_BYTES = 64 * 1024;
  function assertId(value) {
    if (typeof value !== "string" || !/^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/.test(value) || value.length > 160)
      throw new Error("Expected namespaced identity (publisher.extension[/contribution])");
  }
  function copyJson(value, maxBytes = MAX_PAYLOAD_BYTES) {
    const seen = /* @__PURE__ */ new Set();
    function visit(item, depth) {
      if (depth > 32)
        throw new Error("Payload nesting exceeds limit");
      if (item === null || typeof item === "string" || typeof item === "boolean")
        return;
      if (typeof item === "number" && Number.isFinite(item))
        return;
      if (typeof item !== "object" || seen.has(item))
        throw new Error("Expected finite, acyclic JSON data");
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new Error("Expected plain JSON object");
      seen.add(item);
      for (const child of Object.values(item))
        visit(child, depth + 1);
      seen.delete(item);
    }
    visit(value, 0);
    const encoded = JSON.stringify(value);
    const encodedBytes = new TextEncoder().encode(encoded).length;
    if (encodedBytes > maxBytes) {
      let largest;
      const findLargest = (item, path3) => {
        if (typeof item === "string") {
          const bytes = new TextEncoder().encode(item).length;
          if (!largest || bytes > largest.bytes)
            largest = { path: path3, bytes };
          return;
        }
        if (Array.isArray(item))
          item.forEach((child, i) => findLargest(child, `${path3}[${i}]`));
        else if (item && typeof item === "object")
          for (const [key, child] of Object.entries(item))
            findLargest(child, path3 ? `${path3}.${key}` : key);
      };
      findLargest(value, "");
      throw new Error(`Payload exceeds byte limit (${encodedBytes} bytes > ${maxBytes}-byte envelope)` + (largest ? `; largest field "${largest.path || "(root)"}" is ${largest.bytes} UTF-8 bytes` : ""));
    }
    return JSON.parse(encoded);
  }
  function validateManifest(value) {
    const manifest = copyJson(value);
    assertId(manifest.id);
    if (manifest.id.includes("/") || manifest.apiVersion !== API_VERSION || typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:[+][a-zA-Z0-9.-]+)?$/.test(manifest.version))
      throw new Error("Incompatible extension manifest");
    if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length > 64)
      throw new Error("Invalid surfaces");
    const ids = /* @__PURE__ */ new Set();
    for (const surface of manifest.surfaces) {
      assertId(surface.id);
      if (!surface.id.startsWith(manifest.id + "/") || ids.has(surface.id))
        throw new Error("Duplicate or foreign contribution");
      ids.add(surface.id);
      if (typeof surface.title !== "string" || !surface.title || surface.title.length > 200 || !Number.isSafeInteger(surface.stateVersion) || surface.stateVersion < 1)
        throw new Error("Invalid surface metadata");
      if (!["environment", "project", "thread"].includes(surface.scope))
        throw new Error("Invalid scope");
      if (!Array.isArray(surface.placements) || !surface.placements.length || surface.placements.some((p) => !["side-panel", "bottom-dock", "full-page", "compact-detail"].includes(p)))
        throw new Error("Invalid placement");
      if (!Array.isArray(surface.clients) || !surface.clients.length || surface.clients.some((c) => typeof c !== "string" || !c))
        throw new Error("Invalid clients");
      if (!Array.isArray(surface.capabilities))
        throw new Error("Invalid capabilities");
      surface.capabilities.forEach(assertId);
    }
    for (const descriptors of [manifest.composerContexts ?? [], manifest.messageDecorations ?? []]) {
      if (!Array.isArray(descriptors) || descriptors.length > 16)
        throw new Error("Invalid text contributions");
      for (const descriptor of descriptors) {
        assertId(descriptor.id);
        if (!descriptor.id.startsWith(manifest.id + "/") || ids.has(descriptor.id))
          throw new Error("Duplicate or foreign contribution");
        ids.add(descriptor.id);
        if (typeof descriptor.title !== "string" || !descriptor.title.trim() || descriptor.title.length > 200 || !Array.isArray(descriptor.clients) || !descriptor.clients.length || descriptor.clients.some((client) => typeof client !== "string" || !client || client.length > 100))
          throw new Error("Invalid text contribution metadata");
      }
    }
    return manifest;
  }

  // ../../extension-sdk/dist/capabilities.js
  function defineApi(definition) {
    return { definition: validateApiDefinition(definition) };
  }
  function bindApi(api, client, context, versionRange = "^" + api.definition.version) {
    return {
      invoke(method, input, signal) {
        return client.invokeApi({ id: api.definition.id, versionRange, method, input, context }, signal);
      }
    };
  }
  function defineStreamApi(definition) {
    const validated = validateApiDefinition(definition);
    if (!validated.streams?.length)
      throw new Error("Expected API stream definitions");
    return { definition: validated };
  }
  function bindStreamApi(api, client, context, versionRange = "^" + api.definition.version) {
    return {
      subscribe(name, input, signal, options) {
        return client.subscribeApi({
          id: api.definition.id,
          versionRange,
          name,
          input,
          context,
          ...options?.cursor === void 0 ? {} : { cursor: options.cursor },
          ...options?.expectedGeneration === void 0 ? {} : { expectedGeneration: options.expectedGeneration }
        }, signal);
      }
    };
  }
  function validateRangeText(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 200)
      throw new Error("Invalid API or dependency version range");
  }
  function validateApiRequirement(value) {
    const item = copyJson(value);
    assertId(item.id);
    validateRangeText(item.versionRange);
    return item;
  }
  function validateApiSchema(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected API JSON schema");
    const walk = (node) => {
      if (!node || typeof node !== "object")
        return;
      for (const [key, child] of Object.entries(node)) {
        if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#")))
          throw new Error("API schemas cannot use external references");
        walk(child);
      }
    };
    walk(copyJson(value));
  }
  function validateApiDefinition(value) {
    const api = copyJson(value);
    if (!api || typeof api !== "object" || Array.isArray(api))
      throw new Error("Invalid API definition");
    assertId(api.id);
    if (typeof api.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(api.version))
      throw new Error("Invalid API version");
    if (!Array.isArray(api.methods) && api.methods !== void 0 || !Array.isArray(api.streams) && api.streams !== void 0 || !api.methods?.length && !api.streams?.length || (api.methods?.length ?? 0) > 32 || (api.streams?.length ?? 0) > 32)
      throw new Error("Invalid API methods");
    const names = /* @__PURE__ */ new Set();
    for (const method of api.methods ?? []) {
      if (!method || typeof method !== "object")
        throw new Error("Invalid API method");
      if (typeof method.name !== "string" || !/^(?=.{1,80}$)[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/.test(method.name) || names.has(method.name))
        throw new Error("Duplicate or invalid API method");
      names.add(method.name);
      if (method.effect !== "read" && method.effect !== "write")
        throw new Error("Invalid API effect");
      validateApiSchema(method.inputSchema);
      validateApiSchema(method.outputSchema);
      if (!Array.isArray(method.requiredGrants) || method.requiredGrants.length > 16 || new Set(method.requiredGrants).size !== method.requiredGrants.length)
        throw new Error("Invalid API grants");
      method.requiredGrants.forEach(assertId);
    }
    for (const stream of api.streams ?? []) {
      if (!stream || typeof stream.name !== "string" || !/^[a-z][a-zA-Z0-9]{0,79}$/.test(stream.name) || names.has(stream.name))
        throw new Error("Duplicate or invalid API stream");
      names.add(stream.name);
      validateApiSchema(stream.inputSchema);
      validateApiSchema(stream.eventSchema);
      if (!Array.isArray(stream.requiredGrants) || stream.requiredGrants.length > 16 || new Set(stream.requiredGrants).size !== stream.requiredGrants.length)
        throw new Error("Invalid API stream grants");
      stream.requiredGrants.forEach(assertId);
    }
    return api;
  }

  // ../../extension-sdk/dist/orchestration.js
  var ORCHESTRATION_STATUS = "t3.orchestration/status";
  var ORCHESTRATION_CONTROL = "t3.orchestration/control";
  var ORCHESTRATION_READ = "t3.orchestration/read";
  var ORCHESTRATION_OPERATE = "t3.orchestration/operate";
  var ORCHESTRATION_CONTROL_OPS = [
    "turn.start",
    "turn.interrupt",
    "session.stop",
    "approval.respond",
    "userInput.respond",
    "userInput.dismiss",
    "thread.settle",
    "thread.unsettle",
    "checkpoint.revert"
  ];
  var str = { type: "string", maxLength: 32768 };
  var id = { type: "string", minLength: 1, maxLength: 160 };
  var num = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  var bool = { type: "boolean" };
  var nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
  var obj = (properties, required = Object.keys(properties)) => ({
    type: "object",
    additionalProperties: false,
    properties,
    required
  });
  var arr = (items, maxItems = 100) => ({ type: "array", items, maxItems });
  var empty = obj({});
  var decision = { enum: ["accept", "acceptForSession", "acceptAlways", "decline", "cancel"] };
  var receipt = obj({
    commandId: id,
    status: { enum: ["accepted", "rejected"] },
    sequence: num,
    error: nullable(str)
  });
  var agentProps = {
    id: str,
    kind: { enum: ["subagent", "subagent_batch", "workflow", "workflow_agent"] },
    title: str,
    status: {
      enum: [
        "pending",
        "running",
        "waiting",
        "idle",
        "completed",
        "failed",
        "cancelled",
        "interrupted"
      ]
    },
    activationCount: num,
    usage: nullable(obj({
      totalTokens: num,
      inputTokens: num,
      cachedInputTokens: num,
      outputTokens: num,
      reasoningOutputTokens: num,
      toolUses: num,
      durationMs: { type: "number" }
    }, ["totalTokens"])),
    phases: arr(obj({ index: num, title: str })),
    runHandles: nullable(obj({ runId: str, scriptPath: str, transcriptDir: str, sessionUrl: str }, [])),
    recentActivity: arr(obj({ at: str, summary: str })),
    firstSeenAt: str,
    updatedAt: str
  };
  for (const key of [
    "role",
    "model",
    "effort",
    "progress",
    "lastToolName",
    "result",
    "error",
    "outputFile",
    "parentAgentId",
    "phaseTitle",
    "workflowName",
    "startedAt",
    "completedAt"
  ])
    agentProps[key] = nullable(str);
  for (const key of ["agentIndex", "phaseIndex", "attempt"])
    agentProps[key] = nullable(num);
  var approval = obj({
    requestId: id,
    requestKind: { enum: ["command", "file-read", "file-change", "mcp-elicitation"] },
    createdAt: str,
    detail: str,
    appName: str,
    options: arr(obj({ decision, label: str, warning: str }, ["decision", "label"]))
  }, ["requestId", "requestKind", "createdAt"]);
  var question = obj({
    id: str,
    header: str,
    question: str,
    options: arr(obj({ label: str, description: str, value: str }, ["label", "description"])),
    allowCustomAnswer: bool,
    multiSelect: bool
  }, ["id", "header", "question", "options"]);
  var sessionProps = {
    threadId: id,
    status: { enum: ["idle", "starting", "running", "ready", "interrupted", "stopped", "error"] },
    providerName: nullable(str),
    providerInstanceId: id,
    runtimeMode: { enum: ["full-access", "approval-required", "auto", "auto-accept-edits"] },
    activeTurnId: nullable(id),
    lastError: nullable(str),
    updatedAt: str
  };
  var state = {
    agents: arr(obj(agentProps)),
    pendingApprovals: arr(approval),
    pendingUserInputs: arr(obj({ requestId: id, createdAt: str, questions: arr(question), dismissible: bool })),
    checkpoints: arr(obj({
      turnId: id,
      checkpointTurnCount: num,
      checkpointRef: str,
      status: { enum: ["ready", "missing", "error"] },
      files: arr(obj({ path: str, kind: str, additions: num, deletions: num }), 1e4),
      assistantMessageId: nullable(id),
      completedAt: str
    }), 1e4),
    session: nullable(obj(sessionProps, Object.keys(sessionProps).filter((k) => k !== "providerInstanceId"))),
    turn: nullable(obj({
      turnId: id,
      state: { enum: ["running", "completed", "interrupted", "error"] },
      requestedAt: str,
      startedAt: nullable(str),
      completedAt: nullable(str),
      assistantMessageId: nullable(id),
      sourceProposedPlan: obj({ threadId: id, planId: id })
    }, ["turnId", "state", "requestedAt", "startedAt", "completedAt", "assistantMessageId"])),
    receipts: arr(receipt),
    retention: obj({ agentsCap: { const: 100 }, receiptsCap: { const: 100 } })
  };
  var eventSchema = {
    oneOf: [
      obj({ kind: { enum: ["snapshot", "updated"] }, streamEpoch: id, revision: num, ...state }),
      obj({ kind: { const: "receipt" }, streamEpoch: id, revision: num, receipt }),
      obj({ kind: { const: "closed" }, streamEpoch: id, reason: { const: "overflow" } })
    ]
  };
  var guard = { commandId: id, expectedEpoch: id, expectedRevision: num };
  var operationInputs = {
    "turn.start": obj({
      ...guard,
      attachments: {},
      bootstrap: {},
      sourceProposedPlan: {},
      text: str,
      modelSelection: obj({ instanceId: id, model: str, options: { type: "object", additionalProperties: true } }, ["instanceId", "model"]),
      runtimeMode: { enum: ["full-access", "approval-required", "auto", "auto-accept-edits"] },
      interactionMode: { enum: ["default", "plan"] },
      titleSeed: str
    }, ["text"]),
    "turn.interrupt": obj({ ...guard, turnId: id }, []),
    "session.stop": obj({ ...guard, onlyIfSettled: bool }, []),
    "approval.respond": obj({ ...guard, requestId: id, decision }, ["requestId", "decision"]),
    "userInput.respond": obj({ ...guard, requestId: id, answers: { type: "object", additionalProperties: true } }, ["requestId", "answers"]),
    "userInput.dismiss": obj({ ...guard, requestId: id }, ["requestId"]),
    "thread.settle": obj(guard, []),
    "thread.unsettle": obj(guard, []),
    "checkpoint.revert": obj({ ...guard, turnCount: num }, ["turnCount"])
  };
  var orchestrationControlApi = defineApi({
    id: ORCHESTRATION_CONTROL,
    version: "1.0.0",
    methods: ORCHESTRATION_CONTROL_OPS.map((name) => ({
      name,
      effect: "write",
      requiredGrants: [ORCHESTRATION_OPERATE],
      inputSchema: operationInputs[name],
      outputSchema: receipt
    }))
  });
  function defineOrchestrationStatusApi(diffEventSchema) {
    return defineStreamApi({
      id: ORCHESTRATION_STATUS,
      version: "1.0.0",
      methods: [
        {
          name: "getCapabilities",
          effect: "read",
          requiredGrants: [ORCHESTRATION_READ],
          inputSchema: empty,
          outputSchema: obj({
            operations: { type: "object", additionalProperties: bool },
            streamEpoch: id,
            revision: num
          })
        },
        {
          name: "getWorkflowScript",
          effect: "read",
          requiredGrants: [ORCHESTRATION_READ],
          inputSchema: obj({ workflowId: id }),
          outputSchema: obj({ contents: { type: "string", maxLength: 8192 }, truncated: bool })
        }
      ],
      streams: [
        {
          name: "subscribeAgents",
          requiredGrants: [ORCHESTRATION_READ],
          inputSchema: empty,
          eventSchema
        },
        {
          name: "getTurnDiff",
          requiredGrants: [ORCHESTRATION_READ],
          inputSchema: { oneOf: [obj({ turnId: id }), obj({ turnCount: { ...num, minimum: 1 } })] },
          eventSchema: diffEventSchema
        },
        {
          name: "getThreadDiff",
          requiredGrants: [ORCHESTRATION_READ],
          inputSchema: empty,
          eventSchema: diffEventSchema
        }
      ]
    });
  }
  var ORCHESTRATION_CONTROL_API = orchestrationControlApi.definition;

  // ../../extension-sdk/dist/textEdits.js
  var WORKSPACE_READ_TEXT_EDITS = "t3.workspace/text-edits";
  var WORKSPACE_READ_TEXT_GRANT = "t3.workspace/read-text";
  var WORKSPACE_WRITE_TEXT = "t3.workspace/write-text";
  var EDITABLE_TEXT_MAX_BYTES = 24e3;
  var REVISION_HEX_LENGTH = 64;
  var revision = {
    type: "string",
    minLength: REVISION_HEX_LENGTH,
    maxLength: REVISION_HEX_LENGTH,
    pattern: "^[0-9a-f]{64}$"
  };
  var path = { type: "string", minLength: 1, maxLength: 512 };
  var contents = {
    type: "string",
    maxLength: EDITABLE_TEXT_MAX_BYTES,
    description: `Complete file contents; at most ${EDITABLE_TEXT_MAX_BYTES} UTF-8 bytes. Multibyte text reaches the bound below ${EDITABLE_TEXT_MAX_BYTES} characters.`
  };
  var textEditsApi = defineApi({
    id: WORKSPACE_READ_TEXT_EDITS,
    version: "1.1.0",
    methods: [
      {
        name: "readSnapshot",
        effect: "read",
        requiredGrants: [WORKSPACE_READ_TEXT_GRANT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: { relativePath: path }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "contents", "revision"],
              properties: {
                kind: { const: "editable" },
                relativePath: path,
                contents,
                revision
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "reason"],
              properties: {
                kind: { const: "not-editable" },
                relativePath: path,
                reason: {
                  enum: [
                    "not-found",
                    "not-regular-file",
                    "binary",
                    "invalid-utf8",
                    "oversized",
                    "outside-workspace",
                    "unsafe-path",
                    "changed-during-read",
                    "io-error"
                  ]
                }
              }
            }
          ]
        }
      },
      {
        name: "save",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath", "expectedRevision", "contents"],
          properties: {
            relativePath: path,
            expectedRevision: revision,
            contents
          }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "revision"],
              properties: { kind: { const: "saved" }, relativePath: path, revision }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath"],
              properties: { kind: { const: "conflict" }, relativePath: path }
            }
          ]
        }
      }
    ]
  });
  var textEditsApiV1 = defineApi({
    id: WORKSPACE_READ_TEXT_EDITS,
    version: "1.0.0",
    methods: [
      {
        name: "readSnapshot",
        effect: "read",
        requiredGrants: [WORKSPACE_READ_TEXT_GRANT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: { relativePath: path }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "contents", "revision"],
              properties: {
                kind: { const: "editable" },
                relativePath: path,
                contents: { type: "string", maxLength: 48e3 },
                revision
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "reason"],
              properties: {
                kind: { const: "not-editable" },
                relativePath: path,
                reason: {
                  enum: [
                    "not-found",
                    "not-regular-file",
                    "binary",
                    "invalid-utf8",
                    "oversized",
                    "outside-workspace",
                    "unsafe-path",
                    "changed-during-read",
                    "io-error"
                  ]
                }
              }
            }
          ]
        }
      },
      {
        name: "save",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath", "expectedRevision", "contents"],
          properties: {
            relativePath: path,
            expectedRevision: revision,
            contents: { type: "string", maxLength: 48e3 }
          }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "revision"],
              properties: { kind: { const: "saved" }, relativePath: path, revision }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath"],
              properties: { kind: { const: "conflict" }, relativePath: path }
            }
          ]
        }
      }
    ]
  });

  // ../../extension-sdk/dist/catalogue.js
  var BROWSER_LOCAL_SERVERS = "t3.browser/local-servers";
  var BROWSER_READ_LOCAL_SERVERS = "t3.browser/read-local-servers";
  var browserLocalServersApi = defineStreamApi({
    id: BROWSER_LOCAL_SERVERS,
    version: "1.0.0",
    methods: [],
    streams: [
      {
        name: "subscribe",
        requiredGrants: [BROWSER_READ_LOCAL_SERVERS],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        eventSchema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "scope", "servers", "truncated"],
              properties: {
                kind: { const: "snapshot" },
                scope: { const: "environment" },
                truncated: { type: "boolean" },
                servers: {
                  type: "array",
                  maxItems: 64,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["url", "port"],
                    properties: {
                      url: { type: "string", minLength: 1, maxLength: 256 },
                      port: { type: "integer", minimum: 1, maximum: 65535 }
                    }
                  }
                }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "reason"],
              properties: { kind: { const: "closed" }, reason: { const: "source-unavailable" } }
            }
          ]
        }
      }
    ]
  });
  var WORKSPACE_FILES = "t3.workspace/files";
  var WORKSPACE_LIST_ENTRIES = "t3.workspace/list-entries";
  var FILE_PRESENTATION = "t3.file/presentation";
  var FILE_PRESENTATION_OPEN = "t3.file/open";
  var TERMINAL_SESSIONS = "t3.terminal/sessions";
  var TERMINAL_READ = "t3.terminal/read";
  var TERMINAL_OUTPUT = "t3.terminal/output";
  var TERMINAL_READ_OUTPUT = "t3.terminal/read-output";
  var TERMINAL_OUTPUT_EVENTS = "t3.terminal/output-events";
  var TERMINAL_CONTROL = "t3.terminal/control";
  var TERMINAL_OPERATE = "t3.terminal/operate";
  var WORKSPACE_SEARCH = "t3.workspace/search";
  var WORKSPACE_READ = "t3.workspace/read";
  var WORKSPACE_CHANGES = "t3.workspace/changes";
  var path2 = { type: "string", maxLength: 512 };
  var workspaceFilesApi = defineApi({
    id: WORKSPACE_FILES,
    version: "1.0.0",
    methods: [
      {
        name: "listEntries",
        effect: "read",
        requiredGrants: [WORKSPACE_LIST_ENTRIES],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: {
            relativePath: path2,
            cursor: { type: "string", maxLength: 2048 },
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["entries", "nextCursor"],
          properties: {
            entries: {
              type: "array",
              maxItems: 200,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "relativePath", "kind"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 512 },
                  relativePath: path2,
                  kind: { enum: ["file", "directory"] }
                }
              }
            },
            nextCursor: { type: ["string", "null"], maxLength: 2048 }
          }
        }
      },
      {
        name: "readText",
        effect: "read",
        requiredGrants: ["t3.workspace/read-text"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: { relativePath: path2 }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath", "contents", "byteLength", "truncated"],
          properties: {
            relativePath: path2,
            contents: { type: "string", maxLength: 48e3 },
            byteLength: { type: "integer", minimum: 0 },
            truncated: { type: "boolean" }
          }
        }
      }
    ]
  });
  var filePresentationApi = defineApi({
    id: FILE_PRESENTATION,
    version: "1.0.0",
    methods: [
      {
        name: "open",
        effect: "read",
        requiredGrants: [FILE_PRESENTATION_OPEN],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: { relativePath: path2 }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId", "placement", "restoreState"],
          properties: {
            surfaceId: { type: "string", minLength: 1, maxLength: 160 },
            placement: { enum: ["side-panel", "bottom-dock", "full-page", "compact-detail"] },
            restoreState: { type: "object" }
          }
        }
      }
    ]
  });
  var terminalSessionMetadataSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "terminalId",
      "status",
      "label",
      "hasRunningSubprocess",
      "exitCode",
      "exitSignal",
      "updatedAt"
    ],
    properties: {
      terminalId: { type: "string", minLength: 1, maxLength: 128 },
      status: { enum: ["starting", "running", "exited", "error"] },
      label: { type: "string", maxLength: 128 },
      hasRunningSubprocess: { type: "boolean" },
      exitCode: { type: ["integer", "null"] },
      exitSignal: { type: ["integer", "null"] },
      updatedAt: { type: "string", maxLength: 64 }
    }
  };
  var terminalSessionsInspectMethod = {
    name: "inspect",
    effect: "read",
    requiredGrants: [TERMINAL_READ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["terminalId"],
      properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } }
    },
    outputSchema: {
      ...terminalSessionMetadataSchema,
      type: ["object", "null"]
    }
  };
  var terminalSessionsListEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminals"],
        properties: {
          kind: { const: "snapshot" },
          terminals: { type: "array", maxItems: 128, items: terminalSessionMetadataSchema }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminal"],
        properties: {
          kind: { const: "upsert" },
          terminal: terminalSessionMetadataSchema
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminalId"],
        properties: {
          kind: { const: "remove" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "reason"],
        properties: {
          kind: { const: "closed" },
          reason: { enum: ["overflow", "terminal-error"] }
        }
      }
    ]
  };
  var terminalSessionsApi = defineStreamApi({
    id: TERMINAL_SESSIONS,
    version: "1.1.0",
    methods: [terminalSessionsInspectMethod],
    streams: [
      {
        name: "list",
        requiredGrants: [TERMINAL_READ],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        eventSchema: terminalSessionsListEventSchema
      }
    ]
  });
  var terminalSessionsApiV1 = defineApi({
    id: TERMINAL_SESSIONS,
    version: "1.0.0",
    methods: [terminalSessionsInspectMethod]
  });
  var terminalIdInput = { type: "string", minLength: 1, maxLength: 128 };
  var terminalColsInput = { type: "integer", minimum: 1, maximum: 1e3 };
  var terminalRowsInput = { type: "integer", minimum: 1, maximum: 500 };
  var terminalCwdInput = { type: "string", minLength: 1, maxLength: 32768 };
  var terminalWorktreePathInput = {
    type: ["string", "null"],
    minLength: 1,
    maxLength: 32768
  };
  var terminalEnvInput = {
    type: "object",
    maxProperties: 128,
    propertyNames: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 128 },
    additionalProperties: { type: "string", maxLength: 8192 }
  };
  var terminalProviderInstanceInput = {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$"
  };
  var terminalSessionOutputSchema = terminalSessionMetadataSchema;
  var terminalAckOutputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var terminalLaunchOptionals = {
    worktreePath: terminalWorktreePathInput,
    cols: terminalColsInput,
    rows: terminalRowsInput,
    env: terminalEnvInput,
    providerInstanceId: terminalProviderInstanceInput
  };
  var terminalControlApi = defineApi({
    id: TERMINAL_CONTROL,
    version: "1.0.0",
    methods: [
      {
        name: "open",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId", "cwd"],
          properties: {
            terminalId: terminalIdInput,
            cwd: terminalCwdInput,
            ...terminalLaunchOptionals
          }
        },
        outputSchema: terminalSessionOutputSchema
      },
      {
        name: "attach",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId"],
          properties: {
            terminalId: terminalIdInput,
            cwd: terminalCwdInput,
            restartIfNotRunning: { type: "boolean" },
            ...terminalLaunchOptionals
          }
        },
        outputSchema: terminalSessionOutputSchema
      },
      {
        name: "write",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId", "data"],
          properties: {
            terminalId: terminalIdInput,
            data: { type: "string", minLength: 1, maxLength: 65536 }
          }
        },
        outputSchema: terminalAckOutputSchema
      },
      {
        name: "resize",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId", "cols", "rows"],
          properties: {
            terminalId: terminalIdInput,
            cols: terminalColsInput,
            rows: terminalRowsInput
          }
        },
        outputSchema: terminalAckOutputSchema
      },
      {
        name: "clear",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId"],
          properties: { terminalId: terminalIdInput }
        },
        outputSchema: terminalAckOutputSchema
      },
      {
        name: "restart",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId", "cwd", "cols", "rows"],
          properties: {
            terminalId: terminalIdInput,
            cwd: terminalCwdInput,
            ...terminalLaunchOptionals
          }
        },
        outputSchema: terminalSessionOutputSchema
      },
      {
        name: "close",
        effect: "write",
        requiredGrants: [TERMINAL_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            terminalId: terminalIdInput,
            deleteHistory: { type: "boolean" }
          }
        },
        outputSchema: terminalAckOutputSchema
      }
    ]
  });
  var terminalOutputApi = defineApi({
    id: TERMINAL_OUTPUT,
    version: "1.0.0",
    methods: [
      {
        name: "readSnapshot",
        effect: "read",
        requiredGrants: [TERMINAL_READ_OUTPUT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId"],
          properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        outputSchema: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["terminalId", "contents", "retainedByteLength", "truncated"],
          properties: {
            terminalId: { type: "string", minLength: 1, maxLength: 128 },
            contents: { type: "string", maxLength: 8192 },
            retainedByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            truncated: { type: "boolean" }
          }
        }
      }
    ]
  });
  var terminalOutputEventsValueSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "terminalId",
          "streamEpoch",
          "status",
          "contents",
          "retainedByteLength",
          "truncated",
          "boundarySequence"
        ],
        properties: {
          kind: { const: "snapshot" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          status: { enum: ["starting", "running", "exited", "error"] },
          contents: { type: "string", maxLength: 8192 },
          retainedByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          truncated: { type: "boolean" },
          boundarySequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "terminalId",
          "streamEpoch",
          "sequence",
          "chunkIndex",
          "chunkCount",
          "data"
        ],
        properties: {
          kind: { const: "output" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          chunkIndex: { type: "integer", minimum: 0, maximum: 63 },
          chunkCount: { type: "integer", minimum: 1, maximum: 64 },
          data: { type: "string", maxLength: 8192 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminalId", "streamEpoch", "sequence", "reason"],
        properties: {
          kind: { const: "reset" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          reason: { const: "history-cleared" }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminalId", "streamEpoch", "sequence", "exitCode", "exitSignal"],
        properties: {
          kind: { const: "exit" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          exitCode: {
            type: ["integer", "null"],
            minimum: -Number.MAX_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER
          },
          exitSignal: {
            type: ["integer", "null"],
            minimum: -Number.MAX_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER
          }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "terminalId", "streamEpoch", "reason"],
        properties: {
          kind: { const: "closed" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          reason: { enum: ["terminal-closed", "identity-changed", "overflow", "terminal-error"] }
        }
      }
    ]
  };
  var terminalOutputEventsApi = defineStreamApi({
    id: TERMINAL_OUTPUT_EVENTS,
    version: "1.0.0",
    methods: [],
    streams: [
      {
        name: "subscribe",
        requiredGrants: [TERMINAL_READ_OUTPUT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId"],
          properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        eventSchema: terminalOutputEventsValueSchema
      }
    ]
  });
  var workspaceTreeApi = defineStreamApi({
    id: "t3.workspace/tree",
    version: "1.0.0",
    methods: [],
    streams: [
      {
        name: "snapshot",
        requiredGrants: [WORKSPACE_LIST_ENTRIES],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        eventSchema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "entries", "truncated"],
              properties: {
                kind: { const: "chunk" },
                truncated: { type: "boolean" },
                entries: {
                  type: "array",
                  maxItems: 200,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["path", "kind"],
                    properties: {
                      path: { type: "string", minLength: 1, maxLength: 32768 },
                      kind: { enum: ["file", "directory"] }
                    }
                  }
                }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "entryCount", "truncated"],
              properties: {
                kind: { const: "complete" },
                entryCount: { type: "integer", minimum: 0, maximum: 25e3 },
                truncated: { type: "boolean" }
              }
            }
          ]
        }
      }
    ]
  });
  var searchEntrySchema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "kind"],
    properties: {
      path: { type: "string", minLength: 1, maxLength: 512 },
      kind: { enum: ["file", "directory"] }
    }
  };
  var workspaceSearchApi = defineApi({
    id: WORKSPACE_SEARCH,
    version: "1.0.0",
    methods: [
      {
        name: "search",
        effect: "read",
        requiredGrants: [WORKSPACE_SEARCH],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", maxLength: 256 },
            limit: { type: "integer", minimum: 1, maximum: 200 },
            kind: { enum: ["file", "directory"] },
            imageOnly: { type: "boolean" }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["entries", "truncated"],
          properties: {
            entries: { type: "array", maxItems: 200, items: searchEntrySchema },
            truncated: { type: "boolean" }
          }
        }
      },
      {
        name: "searchContents",
        effect: "read",
        requiredGrants: [WORKSPACE_SEARCH],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 256 },
            limit: { type: "integer", minimum: 1, maximum: 500 },
            caseSensitive: { type: "boolean" },
            wholeWord: { type: "boolean" },
            useRegex: { type: "boolean" }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["matches", "truncated"],
          properties: {
            matches: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "lineNumber", "lineContent", "matchRanges"],
                properties: {
                  path: { type: "string", minLength: 1, maxLength: 512 },
                  lineNumber: { type: "integer", minimum: 1 },
                  lineContent: { type: "string", maxLength: 8192 },
                  matchRanges: {
                    type: "array",
                    maxItems: 512,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["start", "end"],
                      properties: {
                        start: { type: "integer", minimum: 0 },
                        end: { type: "integer", minimum: 0 }
                      }
                    }
                  }
                }
              }
            },
            truncated: { type: "boolean" },
            regexFallbackError: { type: "string", maxLength: 512 }
          }
        }
      }
    ]
  });
  var mutationSeqField = {
    type: "integer",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER
  };
  var workspaceChangesEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "mutationSeq"],
        properties: { kind: { const: "snapshot" }, mutationSeq: mutationSeqField }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "mutationSeq", "kinds", "at"],
        properties: {
          kind: { const: "mutation" },
          mutationSeq: mutationSeqField,
          kinds: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: { enum: ["command_execution", "file_change"] }
          },
          at: { type: "string", minLength: 1, maxLength: 64 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "reason"],
        properties: {
          kind: { const: "closed" },
          reason: { enum: ["overflow", "watch-error"] }
        }
      }
    ]
  };
  var workspaceChangesApi = defineStreamApi({
    id: WORKSPACE_CHANGES,
    version: "1.0.0",
    methods: [],
    streams: [
      {
        name: "subscribeChanges",
        requiredGrants: [WORKSPACE_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["threadId"],
          properties: { threadId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        eventSchema: workspaceChangesEventSchema
      }
    ]
  });
  var VCS_READ = "t3.vcs/read";
  var VCS_MUTATE = "t3.vcs/mutate";
  var VCS_STATUS = "t3.vcs/status";
  var VCS_REFS = "t3.vcs/refs";
  var VCS_CHANGES = "t3.vcs/changes";
  var VCS_DIFF = "t3.vcs/diff";
  var VCS_REPOSITORY = "t3.vcs/repository";
  var vcsPath = { type: "string", minLength: 1, maxLength: 512 };
  var vcsPathsInput = {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: vcsPath
  };
  var vcsRefNameInput = {
    type: "string",
    minLength: 1,
    maxLength: 256,
    allOf: [
      { not: { pattern: "\\.\\." } },
      { not: { pattern: "@\\{" } },
      { not: { pattern: "[\\x00-\\x20~^:?*\\[\\\\]" } },
      { not: { pattern: "(^|/)\\." } },
      { not: { pattern: "//" } },
      { not: { pattern: "^[/-]" } },
      { not: { pattern: "[/.]$" } },
      { not: { pattern: "\\.lock(/|$)" } },
      { not: { pattern: "^@$" } }
    ]
  };
  var vcsRefNameOutput = { type: "string", minLength: 1, maxLength: 4096 };
  var vcsRefNameOrNull = { type: ["string", "null"], minLength: 1, maxLength: 4096 };
  var vcsRevSpec = {
    type: "string",
    minLength: 1,
    maxLength: 256,
    allOf: [{ not: { pattern: "^-" } }, { not: { pattern: "[\\s\\x00-\\x1f]" } }]
  };
  var vcsRevSpecOrNull = { anyOf: [{ type: "null" }, vcsRevSpec] };
  var vcsStatusFileSchema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "insertions", "deletions"],
    properties: {
      path: vcsPath,
      insertions: { type: "integer", minimum: 0 },
      deletions: { type: "integer", minimum: 0 }
    }
  };
  var vcsStatusLocalSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "isRepo",
      "hasPrimaryRemote",
      "isDefaultRef",
      "refName",
      "hasWorkingTreeChanges",
      "workingTree"
    ],
    properties: {
      isRepo: { type: "boolean" },
      sourceControlProvider: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "baseUrl"],
        properties: {
          kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
          name: { type: "string", minLength: 1, maxLength: 256 },
          baseUrl: { type: "string", maxLength: 2048 }
        }
      },
      hasPrimaryRemote: { type: "boolean" },
      isDefaultRef: { type: "boolean" },
      refName: vcsRefNameOrNull,
      hasWorkingTreeChanges: { type: "boolean" },
      workingTree: {
        type: "object",
        additionalProperties: false,
        required: ["files", "insertions", "deletions", "truncated"],
        properties: {
          files: { type: "array", maxItems: 5e3, items: vcsStatusFileSchema },
          insertions: { type: "integer", minimum: 0 },
          deletions: { type: "integer", minimum: 0 },
          truncated: { type: "boolean" }
        }
      }
    }
  };
  var vcsChangeRequestSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["number", "title", "url", "baseRef", "headRef", "state"],
    properties: {
      number: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 512 },
      url: { type: "string", maxLength: 2048 },
      baseRef: vcsRefNameOutput,
      headRef: vcsRefNameOutput,
      state: { enum: ["open", "closed", "merged"] },
      isDraft: { type: "boolean" },
      updatedAt: { type: ["string", "null"], maxLength: 64 }
    }
  };
  var vcsStatusRemoteSchema = {
    type: "object",
    additionalProperties: false,
    required: ["hasUpstream", "aheadCount", "behindCount", "pr"],
    properties: {
      hasUpstream: { type: "boolean" },
      aheadCount: { type: "integer", minimum: 0 },
      behindCount: { type: "integer", minimum: 0 },
      aheadOfDefaultCount: { type: "integer", minimum: 0 },
      pr: vcsChangeRequestSchema
    }
  };
  var vcsStatusResultSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "isRepo",
      "hasPrimaryRemote",
      "isDefaultRef",
      "refName",
      "hasWorkingTreeChanges",
      "workingTree",
      "hasUpstream",
      "aheadCount",
      "behindCount",
      "pr"
    ],
    properties: {
      ...vcsStatusLocalSchema.properties,
      ...vcsStatusRemoteSchema.properties
    }
  };
  var vcsEmptyInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var vcsAckOutputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var vcsStatusStreamEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "local", "remote"],
        properties: {
          kind: { const: "snapshot" },
          local: vcsStatusLocalSchema,
          remote: { anyOf: [vcsStatusRemoteSchema, { type: "null" }] }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "local"],
        properties: { kind: { const: "localUpdated" }, local: vcsStatusLocalSchema }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "remote"],
        properties: {
          kind: { const: "remoteUpdated" },
          remote: { anyOf: [vcsStatusRemoteSchema, { type: "null" }] }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "reason"],
        properties: {
          kind: { const: "closed" },
          reason: { enum: ["overflow", "status-error"] }
        }
      }
    ]
  };
  var vcsStatusApi = defineStreamApi({
    id: VCS_STATUS,
    version: "1.0.0",
    methods: [
      {
        name: "get",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: vcsEmptyInputSchema,
        outputSchema: vcsStatusResultSchema
      },
      {
        name: "refresh",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: vcsEmptyInputSchema,
        outputSchema: vcsStatusResultSchema
      }
    ],
    streams: [
      {
        name: "subscribe",
        requiredGrants: [VCS_READ],
        inputSchema: vcsEmptyInputSchema,
        eventSchema: vcsStatusStreamEventSchema
      }
    ]
  });
  var vcsRefEntrySchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "current", "isDefault", "worktreePath"],
    properties: {
      name: vcsRefNameOutput,
      isRemote: { type: "boolean" },
      remoteName: vcsRefNameOutput,
      current: { type: "boolean" },
      isDefault: { type: "boolean" },
      worktreePath: { type: ["string", "null"], minLength: 1, maxLength: 32768 }
    }
  };
  var vcsRefsApi = defineApi({
    id: VCS_REFS,
    version: "1.0.0",
    methods: [
      {
        name: "list",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 256 },
            cursor: { type: "integer", minimum: 0 },
            includeMatchingRemoteRefs: { type: "boolean" },
            refKind: { enum: ["all", "local", "remote"] },
            refresh: { type: "boolean" },
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refs", "isRepo", "hasPrimaryRemote", "nextCursor", "totalCount"],
          properties: {
            refs: { type: "array", maxItems: 200, items: vcsRefEntrySchema },
            isRepo: { type: "boolean" },
            hasPrimaryRemote: { type: "boolean" },
            nextCursor: { type: ["integer", "null"], minimum: 0 },
            totalCount: { type: "integer", minimum: 0 }
          }
        }
      },
      {
        name: "create",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refName"],
          properties: { refName: vcsRefNameInput, switchRef: { type: "boolean" } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refName"],
          properties: { refName: vcsRefNameOutput }
        }
      },
      {
        name: "switch",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refName"],
          properties: { refName: vcsRefNameInput }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refName"],
          properties: { refName: vcsRefNameOrNull }
        }
      }
    ]
  });
  var vcsChangeEntrySchema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "staged", "unstaged", "untracked", "conflicted"],
    properties: {
      path: vcsPath,
      staged: { type: "boolean" },
      unstaged: { type: "boolean" },
      untracked: { type: "boolean" },
      conflicted: { type: "boolean" }
    }
  };
  var vcsChangesApi = defineApi({
    id: VCS_CHANGES,
    version: "1.0.0",
    methods: [
      {
        name: "list",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: vcsEmptyInputSchema,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["isRepo", "entries", "truncated"],
          properties: {
            isRepo: { type: "boolean" },
            entries: { type: "array", maxItems: 5e3, items: vcsChangeEntrySchema },
            truncated: { type: "boolean" }
          }
        }
      },
      {
        name: "stage",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["paths"],
          properties: { paths: vcsPathsInput }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["paths"],
          properties: { paths: vcsPathsInput }
        }
      },
      {
        name: "unstage",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["paths"],
          properties: { paths: vcsPathsInput }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["paths"],
          properties: { paths: vcsPathsInput }
        }
      },
      {
        name: "commit",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 1e4 },
            paths: vcsPathsInput
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["commitSha", "refName"],
          properties: {
            commitSha: { type: "string", minLength: 1, maxLength: 64 },
            refName: vcsRefNameOrNull
          }
        }
      }
    ]
  });
  var vcsDiffPreviewSourceSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "title", "baseRef", "headRef", "diff", "diffHash", "truncated"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 },
      kind: { enum: ["working-tree", "branch-range"] },
      title: { type: "string", minLength: 1, maxLength: 256 },
      baseRef: vcsRefNameOrNull,
      headRef: vcsRefNameOrNull,
      diff: { type: "string", maxLength: 512e3 },
      diffHash: { type: "string", minLength: 1, maxLength: 128 },
      truncated: { type: "boolean" }
    }
  };
  var vcsDiffPreviewInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      baseRef: vcsRevSpec,
      ignoreWhitespace: { type: "boolean" }
    }
  };
  var vcsDiffFileContentsInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["sourceKind", "changeType", "baseRef", "headRef", "oldPath", "newPath"],
    properties: {
      sourceKind: { enum: ["working-tree", "branch-range"] },
      changeType: { enum: ["change", "rename-pure", "rename-changed", "new", "deleted"] },
      baseRef: vcsRevSpecOrNull,
      headRef: vcsRevSpecOrNull,
      oldPath: vcsPath,
      newPath: vcsPath
    }
  };
  var vcsDiffGetPreviewMethod = {
    name: "getPreview",
    effect: "read",
    requiredGrants: [VCS_READ],
    inputSchema: vcsDiffPreviewInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["generatedAt", "sources"],
      properties: {
        generatedAt: { type: "string", maxLength: 64 },
        sources: { type: "array", maxItems: 8, items: vcsDiffPreviewSourceSchema }
      }
    }
  };
  var vcsDiffGetFileContentsMethod = {
    name: "getFileContents",
    effect: "read",
    requiredGrants: [VCS_READ],
    inputSchema: vcsDiffFileContentsInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["oldContents", "newContents"],
      properties: {
        oldContents: { type: "string", maxLength: 1048576 },
        newContents: { type: "string", maxLength: 1048576 }
      }
    }
  };
  var vcsDiffSha256 = {
    type: "string",
    minLength: 64,
    maxLength: 64,
    pattern: "^[0-9a-f]{64}$"
  };
  var vcsDiffChunkData = { type: "string", maxLength: 8192 };
  var vcsDiffStreamSourceSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "title",
      "baseRef",
      "headRef",
      "truncated",
      "diffHash",
      "diffByteLength",
      "chunkCount"
    ],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 64 },
      kind: { enum: ["working-tree", "branch-range"] },
      title: { type: "string", minLength: 1, maxLength: 256 },
      baseRef: vcsRefNameOrNull,
      headRef: vcsRefNameOrNull,
      truncated: { type: "boolean" },
      diffHash: vcsDiffSha256,
      diffByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      chunkCount: { type: "integer", minimum: 0, maximum: 64 }
    }
  };
  var vcsDiffPreviewStreamEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "generatedAt", "sources"],
        properties: {
          kind: { const: "manifest" },
          generatedAt: { type: "string", maxLength: 64 },
          sources: { type: "array", maxItems: 8, items: vcsDiffStreamSourceSchema }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "sourceIndex", "chunkIndex", "data"],
        properties: {
          kind: { const: "chunk" },
          sourceIndex: { type: "integer", minimum: 0, maximum: 7 },
          chunkIndex: { type: "integer", minimum: 0, maximum: 63 },
          data: vcsDiffChunkData
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "payloadSha256"],
        properties: {
          kind: { const: "complete" },
          payloadSha256: vcsDiffSha256
        }
      }
    ]
  };
  var vcsDiffFileContentsStreamEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "oldByteLength", "oldChunkCount", "newByteLength", "newChunkCount"],
        properties: {
          kind: { const: "manifest" },
          // A surrogate pair straddling a boundary shrinks a chunk to 8 191
          // units, so the worst case is ceil(1 048 576 / 8 191) = 129 chunks.
          oldByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          oldChunkCount: { type: "integer", minimum: 0, maximum: 129 },
          newByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          newChunkCount: { type: "integer", minimum: 0, maximum: 129 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "side", "chunkIndex", "data"],
        properties: {
          kind: { const: "chunk" },
          side: { enum: ["old", "new"] },
          chunkIndex: { type: "integer", minimum: 0, maximum: 128 },
          data: vcsDiffChunkData
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "oldSha256", "newSha256"],
        properties: {
          kind: { const: "complete" },
          oldSha256: vcsDiffSha256,
          newSha256: vcsDiffSha256
        }
      }
    ]
  };
  var vcsDiffApi = defineStreamApi({
    id: VCS_DIFF,
    version: "1.1.0",
    methods: [vcsDiffGetPreviewMethod, vcsDiffGetFileContentsMethod],
    streams: [
      {
        name: "streamPreview",
        requiredGrants: [VCS_READ],
        inputSchema: vcsDiffPreviewInputSchema,
        eventSchema: vcsDiffPreviewStreamEventSchema
      },
      {
        name: "streamFileContents",
        requiredGrants: [VCS_READ],
        inputSchema: vcsDiffFileContentsInputSchema,
        eventSchema: vcsDiffFileContentsStreamEventSchema
      }
    ]
  });
  var vcsDiffApiV1 = defineApi({
    id: VCS_DIFF,
    version: "1.0.0",
    methods: [vcsDiffGetPreviewMethod, vcsDiffGetFileContentsMethod]
  });
  var vcsOperationsSupportSchemaV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "status.get",
      "status.refresh",
      "status.subscribe",
      "refs.list",
      "refs.create",
      "refs.switch",
      "changes.list",
      "changes.stage",
      "changes.unstage",
      "changes.commit",
      "diff.getPreview",
      "diff.getFileContents",
      "repository.pull",
      "repository.init",
      "repository.createWorktree",
      "repository.removeWorktree"
    ],
    properties: {
      "status.get": { type: "boolean" },
      "status.refresh": { type: "boolean" },
      "status.subscribe": { type: "boolean" },
      "refs.list": { type: "boolean" },
      "refs.create": { type: "boolean" },
      "refs.switch": { type: "boolean" },
      "changes.list": { type: "boolean" },
      "changes.stage": { type: "boolean" },
      "changes.unstage": { type: "boolean" },
      "changes.commit": { type: "boolean" },
      "diff.getPreview": { type: "boolean" },
      "diff.getFileContents": { type: "boolean" },
      "repository.pull": { type: "boolean" },
      "repository.init": { type: "boolean" },
      "repository.createWorktree": { type: "boolean" },
      "repository.removeWorktree": { type: "boolean" }
    }
  };
  var vcsOperationsSupportSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      ...vcsOperationsSupportSchemaV1.required,
      "repository.push",
      "repository.fetch",
      "repository.listRemotes"
    ],
    properties: {
      ...vcsOperationsSupportSchemaV1.properties,
      "repository.push": { type: "boolean" },
      "repository.fetch": { type: "boolean" },
      "repository.listRemotes": { type: "boolean" }
    }
  };
  var vcsDriverCapabilitiesSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: [
      "kind",
      "supportsWorktrees",
      "supportsBookmarks",
      "supportsAtomicSnapshot",
      "supportsPushDefaultRemote",
      "ignoreClassifier"
    ],
    properties: {
      kind: { enum: ["git", "jj", "unknown"] },
      supportsWorktrees: { type: "boolean" },
      supportsBookmarks: { type: "boolean" },
      supportsAtomicSnapshot: { type: "boolean" },
      supportsPushDefaultRemote: { type: "boolean" },
      ignoreClassifier: { enum: ["native", "git-compatible-fallback"] }
    }
  };
  var vcsCapabilitiesResultSchemaV1 = {
    type: "object",
    additionalProperties: false,
    required: ["detected", "kind", "detail", "driver", "operations"],
    properties: {
      detected: { type: "boolean" },
      kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
      detail: { type: ["string", "null"], maxLength: 512 },
      driver: vcsDriverCapabilitiesSchema,
      operations: vcsOperationsSupportSchemaV1
    }
  };
  var vcsCapabilitiesResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["detected", "kind", "detail", "driver", "operations"],
    properties: {
      detected: { type: "boolean" },
      kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
      detail: { type: ["string", "null"], maxLength: 512 },
      driver: vcsDriverCapabilitiesSchema,
      operations: vcsOperationsSupportSchema
    }
  };
  var vcsRepositoryGetCapabilitiesMethodV1 = {
    name: "getCapabilities",
    effect: "read",
    requiredGrants: [VCS_READ],
    inputSchema: vcsEmptyInputSchema,
    outputSchema: vcsCapabilitiesResultSchemaV1
  };
  var vcsRepositoryGetCapabilitiesMethod = {
    name: "getCapabilities",
    effect: "read",
    requiredGrants: [VCS_READ],
    inputSchema: vcsEmptyInputSchema,
    outputSchema: vcsCapabilitiesResultSchema
  };
  var vcsRepositoryPullMethod = {
    name: "pull",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: vcsEmptyInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status", "refName", "upstreamRef"],
      properties: {
        status: { enum: ["pulled", "skipped_up_to_date"] },
        refName: vcsRefNameOutput,
        upstreamRef: vcsRefNameOrNull
      }
    }
  };
  var vcsRepositoryInitMethod = {
    name: "init",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { kind: { enum: ["git"] } }
    },
    outputSchema: vcsAckOutputSchema
  };
  var vcsRepositoryCreateWorktreeMethod = {
    name: "createWorktree",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["refName", "path"],
      properties: {
        refName: vcsRefNameInput,
        newRefName: vcsRefNameInput,
        baseRefName: vcsRefNameInput,
        path: { type: ["string", "null"], minLength: 1, maxLength: 32768 }
      }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["worktree"],
      properties: {
        worktree: {
          type: "object",
          additionalProperties: false,
          required: ["path", "refName"],
          properties: {
            path: { type: "string", minLength: 1, maxLength: 32768 },
            refName: vcsRefNameOutput
          }
        }
      }
    }
  };
  var vcsRepositoryRemoveWorktreeMethod = {
    name: "removeWorktree",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: {
          type: "string",
          minLength: 1,
          maxLength: 32768
        },
        force: { type: "boolean" }
      }
    },
    outputSchema: vcsAckOutputSchema
  };
  var vcsRepositoryPushMethod = {
    name: "push",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: vcsEmptyInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status", "refName", "upstreamRef", "setUpstream"],
      properties: {
        status: { enum: ["pushed", "skipped_up_to_date"] },
        refName: vcsRefNameOutput,
        upstreamRef: vcsRefNameOrNull,
        setUpstream: { type: "boolean" }
      }
    }
  };
  var vcsRemoteNameInput = {
    type: "string",
    minLength: 1,
    maxLength: 256,
    allOf: [{ not: { pattern: "^-" } }, { not: { pattern: "[\\s\\x00-\\x1f]" } }]
  };
  var vcsRepositoryFetchMethod = {
    name: "fetch",
    effect: "write",
    requiredGrants: [VCS_MUTATE],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { remoteName: vcsRemoteNameInput }
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["remotes"],
      properties: {
        remotes: {
          type: "array",
          maxItems: 64,
          items: { type: "string", minLength: 1, maxLength: 256 }
        }
      }
    }
  };
  var vcsRepositoryListRemotesMethod = {
    name: "listRemotes",
    effect: "read",
    requiredGrants: [VCS_READ],
    inputSchema: vcsEmptyInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["isRepo", "remotes"],
      properties: {
        isRepo: { type: "boolean" },
        remotes: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "url", "pushUrl", "isPrimary"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 256 },
              url: { type: "string", minLength: 1, maxLength: 2048 },
              pushUrl: { type: ["string", "null"], minLength: 1, maxLength: 2048 },
              isPrimary: { type: "boolean" }
            }
          }
        }
      }
    }
  };
  var vcsRepositoryApi = defineApi({
    id: VCS_REPOSITORY,
    version: "1.1.0",
    methods: [
      vcsRepositoryGetCapabilitiesMethod,
      vcsRepositoryPullMethod,
      vcsRepositoryInitMethod,
      vcsRepositoryCreateWorktreeMethod,
      vcsRepositoryRemoveWorktreeMethod,
      vcsRepositoryPushMethod,
      vcsRepositoryFetchMethod,
      vcsRepositoryListRemotesMethod
    ]
  });
  var vcsRepositoryApiV1 = defineApi({
    id: VCS_REPOSITORY,
    version: "1.0.0",
    methods: [
      vcsRepositoryGetCapabilitiesMethodV1,
      vcsRepositoryPullMethod,
      vcsRepositoryInitMethod,
      vcsRepositoryCreateWorktreeMethod,
      vcsRepositoryRemoveWorktreeMethod
    ]
  });
  var VCS_STATUS_API = vcsStatusApi.definition;
  var VCS_REFS_API = vcsRefsApi.definition;
  var VCS_CHANGES_API = vcsChangesApi.definition;
  var VCS_DIFF_API = vcsDiffApi.definition;
  var VCS_DIFF_API_V1 = vcsDiffApiV1.definition;
  var VCS_REPOSITORY_API = vcsRepositoryApi.definition;
  var VCS_REPOSITORY_API_V1 = vcsRepositoryApiV1.definition;
  var RESOURCES_LEASE = "t3.resources/lease";
  var WORKSPACE_RESOURCES = "t3.workspace/resources";
  var BROWSER_SESSIONS = "t3.browser/sessions";
  var BROWSER_SURFACE_COMMANDS = ["attach", "present", "release"];
  var RESOURCE_LEASE_KIND_GRANTS = {
    "workspace-file": WORKSPACE_RESOURCES,
    "project-favicon": WORKSPACE_RESOURCES,
    attachment: null,
    "browser-surface": BROWSER_SESSIONS
  };
  var RESOURCE_LEASE_SUPPORTED_KINDS = Object.keys(RESOURCE_LEASE_KIND_GRANTS).filter((kind) => RESOURCE_LEASE_KIND_GRANTS[kind] !== null);
  var resourceLeaseRefSchemaV1 = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "threadId", "path"],
        properties: {
          _tag: { const: "workspace-file" },
          threadId: { type: "string", minLength: 1, maxLength: 160 },
          path: { type: "string", minLength: 1, maxLength: 1024 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "attachmentId"],
        properties: {
          _tag: { const: "attachment" },
          attachmentId: { type: "string", minLength: 1, maxLength: 256 },
          fileName: { type: "string", minLength: 1, maxLength: 255 },
          mimeType: { type: "string", minLength: 1, maxLength: 100 },
          disposition: { enum: ["inline", "attachment"] }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "cwd"],
        properties: {
          _tag: { const: "project-favicon" },
          cwd: { type: "string", minLength: 1, maxLength: 1024 },
          path: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 1024,
            pattern: "\\.(?:avif|gif|ico|jpe?g|png|svg|webp)$"
          }
        }
      }
    ]
  };
  var resourceLeaseBrowserSurfaceCommandsSchema = {
    type: "array",
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: { enum: [...BROWSER_SURFACE_COMMANDS] }
  };
  var resourceLeaseRefSchema = {
    oneOf: [
      ...resourceLeaseRefSchemaV1.oneOf,
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "threadId", "tabId", "serverEpoch", "allowedCommands"],
        properties: {
          _tag: { const: "browser-surface" },
          threadId: { type: "string", minLength: 1, maxLength: 160 },
          tabId: { type: "string", minLength: 1, maxLength: 128 },
          serverEpoch: { type: "string", minLength: 1, maxLength: 128 },
          allowedCommands: resourceLeaseBrowserSurfaceCommandsSchema
        }
      }
    ]
  };
  var resourcesLeaseApi = defineApi({
    id: RESOURCES_LEASE,
    version: "1.1.0",
    methods: [
      {
        name: "createPresentationUrl",
        effect: "read",
        // Per-kind grants are enforced inside the host adapter — a method-level
        // list can only express "every caller holds all of these".
        requiredGrants: [],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["resource"],
          properties: { resource: resourceLeaseRefSchema }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["url", "expiresAt", "kind"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 4096 },
            expiresAt: { type: "number" },
            kind: {
              enum: [
                "workspace-file",
                "workspace-file-exact",
                "project-favicon",
                "project-favicon-external",
                "browser-surface"
              ]
            }
          }
        }
      },
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["supportedKinds"],
          properties: {
            supportedKinds: {
              type: "array",
              maxItems: 16,
              items: {
                enum: ["workspace-file", "attachment", "project-favicon", "browser-surface"]
              }
            }
          }
        }
      }
    ]
  });
  var RESOURCES_LEASE_API = resourcesLeaseApi.definition;
  var resourcesLeaseApiV1 = defineApi({
    id: RESOURCES_LEASE,
    version: "1.0.0",
    methods: [
      {
        name: "createPresentationUrl",
        effect: "read",
        // Per-kind grants are enforced inside the host adapter — a method-level
        // list can only express "every caller holds all of these".
        requiredGrants: [],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["resource"],
          properties: { resource: resourceLeaseRefSchemaV1 }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["url", "expiresAt", "kind"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 4096 },
            expiresAt: { type: "number" },
            kind: {
              enum: [
                "workspace-file",
                "workspace-file-exact",
                "project-favicon",
                "project-favicon-external"
              ]
            }
          }
        }
      },
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["supportedKinds"],
          properties: {
            supportedKinds: {
              type: "array",
              maxItems: 16,
              items: { enum: ["workspace-file", "attachment", "project-favicon"] }
            }
          }
        }
      }
    ]
  });
  var RESOURCES_LEASE_API_V1 = resourcesLeaseApiV1.definition;
  var PRS_READ = "t3.prs/read";
  var prsActorSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["login", "name", "avatarUrl"],
    properties: {
      login: { type: "string", minLength: 1, maxLength: 256 },
      name: { type: ["string", "null"], maxLength: 512 },
      avatarUrl: { type: ["string", "null"], maxLength: 4096 }
    }
  };
  var prsLabelSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "color"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 512 },
      color: { type: ["string", "null"], maxLength: 64 }
    }
  };
  var prsReactionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["content", "count", "actors", "viewerHasReacted"],
    properties: {
      content: {
        enum: ["thumbs-up", "thumbs-down", "laugh", "hooray", "confused", "heart", "rocket", "eyes"]
      },
      count: { type: "integer", minimum: 1 },
      actors: {
        type: "array",
        maxItems: 500,
        items: { type: "string", minLength: 1, maxLength: 256 }
      },
      viewerHasReacted: { type: "boolean" }
    }
  };
  var prsCheckSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "status", "description", "url"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 512 },
      status: {
        enum: ["pending", "action-required", "success", "failure", "skipped", "neutral", "cancelled"]
      },
      description: { type: ["string", "null"], maxLength: 4096 },
      url: { type: ["string", "null"], maxLength: 4096 }
    }
  };
  var prsRepositoryField = { type: "string", minLength: 1, maxLength: 512 };
  var prsHostField = { type: "string", minLength: 1, maxLength: 256 };
  var prsRefInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["repository", "number"],
    properties: {
      host: prsHostField,
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 }
    }
  };
  var prsListFiltersSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      draft: { enum: ["only", "hide"] },
      review: { enum: ["approved", "changes-requested", "review-required", "none"] },
      checks: { enum: ["passing", "failing"] },
      labels: {
        type: "array",
        maxItems: 10,
        items: {
          type: "array",
          maxItems: 10,
          items: { type: "string", minLength: 1, maxLength: 200 }
        }
      },
      excludedLabels: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1, maxLength: 200 }
      },
      author: { type: "string", minLength: 1, maxLength: 200 }
    }
  };
  var prsCursorsSchema = {
    type: "object",
    additionalProperties: { type: "string", minLength: 1, maxLength: 4096 },
    maxProperties: 100
  };
  var prsProviderSummarySchema = {
    type: "object",
    additionalProperties: false,
    required: ["host", "kind", "searchesOnHost", "projectCount", "configured", "detail"],
    properties: {
      host: prsHostField,
      kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
      searchesOnHost: { type: "boolean" },
      projectCount: { type: "integer", minimum: 1 },
      configured: { type: "boolean" },
      detail: { type: ["string", "null"], maxLength: 1024 }
    }
  };
  var prsListEntrySchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "provider",
      "host",
      "projectId",
      "projectTitle",
      "repository",
      "number",
      "title",
      "url",
      "author",
      "headBranch",
      "baseBranch",
      "state",
      "isDraft",
      "mergeability",
      "additions",
      "deletions",
      "createdAt",
      "updatedAt",
      "viewerReviewRequested",
      "labels"
    ],
    properties: {
      stack: {
        type: "object",
        additionalProperties: false,
        required: ["number", "position", "size", "base"],
        properties: {
          number: { type: "integer", minimum: 1 },
          position: { type: "integer", minimum: 1 },
          size: { type: "integer", minimum: 1 },
          base: { type: "string", minLength: 1, maxLength: 1024 }
        }
      },
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
      host: prsHostField,
      projectId: { type: "string", minLength: 1, maxLength: 160 },
      projectTitle: { type: "string", minLength: 1, maxLength: 512 },
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 2048 },
      url: { type: "string", minLength: 1, maxLength: 4096 },
      author: prsActorSchema,
      headBranch: { type: "string", minLength: 1, maxLength: 1024 },
      baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
      state: { enum: ["open", "closed", "merged"] },
      isDraft: { type: "boolean" },
      mergeability: { enum: ["mergeable", "conflicting", "unknown"] },
      additions: { type: "integer", minimum: 0 },
      deletions: { type: "integer", minimum: 0 },
      createdAt: { type: "string", maxLength: 64 },
      updatedAt: { type: "string", maxLength: 64 },
      viewerReviewRequested: { type: "boolean" },
      labels: { type: "array", maxItems: 100, items: prsLabelSchema },
      reviewDecision: { enum: ["approved", "changes-requested", "review-required"] },
      checksState: { enum: ["passing", "failing", "pending"] }
    }
  };
  var prsListResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["viewers", "providers", "entries", "errors", "truncated", "nextCursors"],
    properties: {
      viewers: {
        type: "object",
        additionalProperties: { type: "string", minLength: 1, maxLength: 256 },
        maxProperties: 100
      },
      providers: { type: "array", maxItems: 100, items: prsProviderSummarySchema },
      entries: { type: "array", maxItems: 100, items: prsListEntrySchema },
      errors: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["projectId", "projectTitle", "message"],
          properties: {
            projectId: { type: "string", minLength: 1, maxLength: 160 },
            projectTitle: { type: "string", minLength: 1, maxLength: 512 },
            message: { type: "string", minLength: 1, maxLength: 1024 }
          }
        }
      },
      truncated: { type: "boolean" },
      nextCursors: prsCursorsSchema
    }
  };
  var prsReviewVerdictsSchema = {
    type: "array",
    maxItems: 3,
    items: { enum: ["comment", "approve", "request-changes"] }
  };
  var prsActionsSchema = {
    type: "array",
    maxItems: 16,
    items: {
      enum: [
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "update-branch",
        "enable-auto-merge",
        "disable-auto-merge",
        "revert",
        "approve-workflows"
      ]
    }
  };
  var prsMergeMethodsSchema = {
    type: "array",
    maxItems: 3,
    items: { enum: ["merge", "squash", "rebase"] }
  };
  var prsUpdateMethodsSchema = {
    type: "array",
    maxItems: 2,
    items: { enum: ["merge", "rebase"] }
  };
  var prsCapabilitiesSchema = {
    type: "object",
    additionalProperties: false,
    required: ["diff", "comment", "actions", "mergeMethods", "search", "review", "reviewers"],
    properties: {
      diff: { type: "boolean" },
      comment: { type: "boolean" },
      actions: prsActionsSchema,
      mergeMethods: prsMergeMethodsSchema,
      updateMethods: prsUpdateMethodsSchema,
      search: { type: "boolean" },
      reactions: { type: "boolean" },
      review: {
        type: "object",
        additionalProperties: false,
        required: ["inlineComment", "reply", "resolve", "verdicts"],
        properties: {
          inlineComment: { type: "boolean" },
          reply: { type: "boolean" },
          resolve: { type: "boolean" },
          verdicts: prsReviewVerdictsSchema
        }
      },
      reviewers: {
        type: "object",
        additionalProperties: false,
        required: ["request", "listCandidates"],
        properties: {
          request: { type: "boolean" },
          listCandidates: { type: "boolean" }
        }
      },
      edit: {
        type: "object",
        additionalProperties: false,
        required: ["changeRequest", "comment"],
        properties: {
          changeRequest: { type: "boolean" },
          comment: { type: "boolean" }
        }
      },
      stacks: { type: "boolean" },
      stackActions: { type: "boolean" },
      labels: { type: "boolean" }
    }
  };
  var prsViewerPermissionsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["actions", "comment", "resolve", "verdicts", "requestReviewers"],
    properties: {
      stackRebase: { type: "boolean" },
      actions: prsActionsSchema,
      comment: { type: "boolean" },
      resolve: { type: "boolean" },
      verdicts: prsReviewVerdictsSchema,
      requestReviewers: { type: "boolean" },
      updateMethods: prsUpdateMethodsSchema,
      labels: { type: "boolean" }
    }
  };
  var prsDetailSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "provider",
      "capabilities",
      "viewerPermissions",
      "projectId",
      "projectTitle",
      "workspaceRoot",
      "repository",
      "number",
      "title",
      "body",
      "url",
      "author",
      "state",
      "isDraft",
      "mergeability",
      "additions",
      "deletions",
      "changedFiles",
      "headBranch",
      "baseBranch",
      "createdAt",
      "updatedAt",
      "mergedAt",
      "closedAt",
      "reviewers",
      "labels",
      "checks",
      "mergeCapabilities"
    ],
    properties: {
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
      capabilities: prsCapabilitiesSchema,
      viewerPermissions: prsViewerPermissionsSchema,
      projectId: { type: "string", minLength: 1, maxLength: 160 },
      projectTitle: { type: "string", minLength: 1, maxLength: 512 },
      workspaceRoot: { type: "string", minLength: 1, maxLength: 32768 },
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 2048 },
      // Delivered bodies are cut at this bound; bodyTruncated says so.
      body: { type: "string", maxLength: 16384 },
      bodyTruncated: { type: "boolean" },
      url: { type: "string", minLength: 1, maxLength: 4096 },
      author: prsActorSchema,
      state: { enum: ["open", "closed", "merged"] },
      isDraft: { type: "boolean" },
      mergeability: { enum: ["mergeable", "conflicting", "unknown"] },
      additions: { type: "integer", minimum: 0 },
      deletions: { type: "integer", minimum: 0 },
      changedFiles: { type: "integer", minimum: 0 },
      headBranch: { type: "string", minLength: 1, maxLength: 1024 },
      headRepositoryNameWithOwner: { type: ["string", "null"], minLength: 1, maxLength: 1024 },
      baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
      createdAt: { type: "string", maxLength: 64 },
      updatedAt: { type: "string", maxLength: 64 },
      mergedAt: { type: ["string", "null"], maxLength: 64 },
      closedAt: { type: ["string", "null"], maxLength: 64 },
      reviewers: { type: "array", maxItems: 100, items: prsActorSchema },
      labels: { type: "array", maxItems: 100, items: prsLabelSchema },
      checks: { type: "array", maxItems: 200, items: prsCheckSchema },
      mergeCapabilities: {
        type: "object",
        additionalProperties: false,
        required: ["merge", "squash", "rebase"],
        properties: {
          merge: { type: "boolean" },
          squash: { type: "boolean" },
          rebase: { type: "boolean" }
        }
      },
      viewer: { type: "string", minLength: 1, maxLength: 256 },
      baseComparison: { enum: ["up-to-date", "behind", "unknown"] },
      behindBy: { type: "integer", minimum: 0 },
      autoMergeEnabled: { type: "boolean" },
      autoMergeMethod: { enum: ["merge", "squash", "rebase"] },
      workflowApprovalsRequired: { type: "integer", minimum: 0 }
    }
  };
  var prsCommentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "author", "body", "createdAt", "url", "path", "reviewState"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 512 },
      kind: { enum: ["issue-comment", "review-comment", "review"] },
      author: prsActorSchema,
      body: { type: "string", maxLength: 8192 },
      createdAt: { type: "string", maxLength: 64 },
      url: { type: ["string", "null"], maxLength: 4096 },
      path: { type: ["string", "null"], maxLength: 1024 },
      reviewState: { type: ["string", "null"], maxLength: 64 },
      reactions: { type: "array", maxItems: 8, items: prsReactionSchema }
    }
  };
  var prsThreadCommentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "author", "body", "createdAt", "url"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 512 },
      author: prsActorSchema,
      body: { type: "string", maxLength: 8192 },
      createdAt: { type: "string", maxLength: 64 },
      url: { type: ["string", "null"], maxLength: 4096 },
      reactions: { type: "array", maxItems: 8, items: prsReactionSchema }
    }
  };
  var prsReviewThreadSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "path", "line", "side", "isResolved", "isOutdated", "comments"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 512 },
      path: { type: "string", minLength: 1, maxLength: 1024 },
      line: { type: ["integer", "null"], minimum: 1 },
      side: { enum: ["left", "right"] },
      isResolved: { type: "boolean" },
      isOutdated: { type: "boolean" },
      comments: { type: "array", maxItems: 100, items: prsThreadCommentSchema },
      commentCount: { type: "integer", minimum: 0 },
      nextCommentsCursor: { type: "string", minLength: 1, maxLength: 4096 }
    }
  };
  var prsActivitySchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "comments",
      "commentCount",
      "commentsTruncated",
      "reviewThreads",
      "commits",
      "truncated"
    ],
    properties: {
      author: prsActorSchema,
      reviewers: { type: "array", maxItems: 100, items: prsActorSchema },
      comments: { type: "array", maxItems: 100, items: prsCommentSchema },
      commentCount: { type: "integer", minimum: 0 },
      commentsTruncated: { type: "boolean" },
      reviewThreads: { type: "array", maxItems: 100, items: prsReviewThreadSchema },
      commits: {
        type: "array",
        maxItems: 250,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["oid", "messageHeadline", "committedDate"],
          properties: {
            oid: { type: "string", minLength: 1, maxLength: 128 },
            messageHeadline: { type: "string", maxLength: 4096 },
            committedDate: { type: "string", maxLength: 64 },
            additions: { type: "integer", minimum: 0 },
            deletions: { type: "integer", minimum: 0 },
            authors: { type: "array", maxItems: 8, items: prsActorSchema }
          }
        }
      },
      reactions: { type: "array", maxItems: 8, items: prsReactionSchema },
      truncated: { type: "boolean" }
    }
  };
  var prsSummarySchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "provider",
      "projectId",
      "repository",
      "number",
      "title",
      "url",
      "state",
      "headBranch",
      "baseBranch",
      "updatedAt"
    ],
    properties: {
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
      projectId: { type: "string", minLength: 1, maxLength: 160 },
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 2048 },
      url: { type: "string", minLength: 1, maxLength: 4096 },
      state: { enum: ["open", "closed", "merged"] },
      isDraft: { type: "boolean" },
      headBranch: { type: "string", minLength: 1, maxLength: 1024 },
      baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
      closedAt: { type: ["string", "null"], maxLength: 64 },
      mergedAt: { type: ["string", "null"], maxLength: 64 },
      updatedAt: { type: "string", maxLength: 64 },
      author: prsActorSchema,
      additions: { type: "integer", minimum: 0 },
      deletions: { type: "integer", minimum: 0 },
      changedFiles: { type: "integer", minimum: 0 },
      reviewDecision: { enum: ["approved", "changes-requested", "review-required", null] },
      checksState: { enum: ["passing", "failing", "pending", null] },
      mergeability: { enum: ["mergeable", "conflicting", "unknown"] }
    }
  };
  var prsStackSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["id", "number", "url", "base", "layers"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 512 },
      number: { type: "integer", minimum: 1 },
      url: { type: "string", minLength: 1, maxLength: 4096 },
      base: { type: "string", minLength: 1, maxLength: 1024 },
      layers: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "headBranch", "state"],
          properties: {
            number: { type: "integer", minimum: 1 },
            title: { type: "string", maxLength: 2048 },
            isDraft: { type: "boolean" },
            headSha: { type: "string", minLength: 1, maxLength: 128 },
            headBranch: { type: "string", minLength: 1, maxLength: 1024 },
            state: { enum: ["open", "closed", "merged"] }
          }
        }
      }
    }
  };
  var prsLinkedThreadsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["threads", "truncated"],
    properties: {
      threads: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "projectId", "title", "archivedAt"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 160 },
            projectId: { type: "string", minLength: 1, maxLength: 160 },
            title: { type: "string", maxLength: 2048 },
            archivedAt: { type: ["string", "null"], maxLength: 64 }
          }
        }
      },
      truncated: { type: "boolean" }
    }
  };
  var prsThreadCommentsResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["comments", "nextCursor", "truncated"],
    properties: {
      comments: { type: "array", maxItems: 100, items: prsThreadCommentSchema },
      nextCursor: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
      truncated: { type: "boolean" }
    }
  };
  var prsReviewerCandidateListSchema = {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "truncated"],
    properties: {
      candidates: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["login", "name", "avatarUrl", "id", "kind", "isRequested"],
          properties: {
            login: { type: "string", minLength: 1, maxLength: 256 },
            name: { type: ["string", "null"], maxLength: 512 },
            avatarUrl: { type: ["string", "null"], maxLength: 4096 },
            id: { type: "string", minLength: 1, maxLength: 512 },
            kind: { enum: ["user", "team"] },
            isRequested: { type: "boolean" }
          }
        }
      },
      truncated: { type: "boolean" }
    }
  };
  var prsLabelCandidateListSchema = {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "truncated"],
    properties: {
      candidates: {
        type: "array",
        maxItems: 500,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "color", "description", "isApplied"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 512 },
            color: { type: ["string", "null"], maxLength: 64 },
            description: { type: ["string", "null"], maxLength: 4096 },
            isApplied: { type: "boolean" }
          }
        }
      },
      truncated: { type: "boolean" }
    }
  };
  var prsOperationsSupportSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "prs.list",
      "prs.listStats",
      "prs.summary",
      "prs.detail",
      "prs.activity",
      "prs.threadComments",
      "prs.linkedThreads",
      "prs.stack",
      "prs.reviewerCandidates",
      "prs.labelCandidates",
      "prs.invalidate",
      "prs.streamDiff",
      "prs.streamDiffFileContents",
      "prs.subscribeRefreshes"
    ],
    properties: {
      "prs.list": { type: "boolean" },
      "prs.listStats": { type: "boolean" },
      "prs.summary": { type: "boolean" },
      "prs.detail": { type: "boolean" },
      "prs.activity": { type: "boolean" },
      "prs.threadComments": { type: "boolean" },
      "prs.linkedThreads": { type: "boolean" },
      "prs.stack": { type: "boolean" },
      "prs.reviewerCandidates": { type: "boolean" },
      "prs.labelCandidates": { type: "boolean" },
      "prs.invalidate": { type: "boolean" },
      "prs.streamDiff": { type: "boolean" },
      "prs.streamDiffFileContents": { type: "boolean" },
      "prs.subscribeRefreshes": { type: "boolean" }
    }
  };
  var prsCapabilitiesResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["hosted", "reason", "detail", "providers", "operations"],
    properties: {
      hosted: { type: "boolean" },
      reason: {
        enum: ["cli-missing", "cli-unauthenticated", "provider-unsupported", null]
      },
      detail: { type: ["string", "null"], maxLength: 1024 },
      providers: { type: "array", maxItems: 100, items: prsProviderSummarySchema },
      operations: prsOperationsSupportSchema
    }
  };
  var prsEmptyInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var prsEmptyOutputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var prsDiffStreamEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "repository",
          "number",
          "diffHash",
          "diffByteLength",
          "chunkCount",
          "truncated",
          "nextCursor"
        ],
        properties: {
          kind: { const: "manifest" },
          repository: prsRepositoryField,
          number: { type: "integer", minimum: 1 },
          host: prsHostField,
          commit: { type: "string", minLength: 1, maxLength: 128 },
          diffHash: vcsDiffSha256,
          diffByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          // The adapter's 4 Mi-unit delivered bound / 8 192-unit chunks = 512.
          chunkCount: { type: "integer", minimum: 0, maximum: 512 },
          truncated: { type: "boolean" },
          nextCursor: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
          omittedFileStats: {
            type: "array",
            maxItems: 1e3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "additions", "deletions"],
              properties: {
                path: { type: "string", minLength: 1, maxLength: 1024 },
                additions: { type: "number" },
                deletions: { type: "number" }
              }
            }
          }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "chunkIndex", "data"],
        properties: {
          kind: { const: "chunk" },
          chunkIndex: { type: "integer", minimum: 0, maximum: 511 },
          data: vcsDiffChunkData
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "payloadSha256"],
        properties: { kind: { const: "complete" }, payloadSha256: vcsDiffSha256 }
      }
    ]
  };
  var prsRefreshedEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "revision"],
        properties: {
          kind: { const: "refreshed" },
          revision: { type: "integer", minimum: 0 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "reason"],
        properties: {
          kind: { const: "closed" },
          reason: { enum: ["overflow", "refresh-error"] }
        }
      }
    ]
  };
  var prsDiffInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["repository", "number"],
    properties: {
      host: prsHostField,
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      commit: { type: "string", minLength: 1, maxLength: 128 },
      cursor: { type: "string", minLength: 1, maxLength: 4096 }
    }
  };
  var prsDiffFileContentsInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["repository", "number", "changeType", "oldPath", "newPath"],
    properties: {
      host: prsHostField,
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      commit: { type: "string", minLength: 1, maxLength: 128 },
      changeType: { enum: ["change", "rename-pure", "rename-changed", "new", "deleted"] },
      oldPath: { type: "string", minLength: 1, maxLength: 1024 },
      newPath: { type: "string", minLength: 1, maxLength: 1024 }
    }
  };
  var prsReadApi = defineStreamApi({
    id: PRS_READ,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsEmptyInputSchema,
        outputSchema: prsCapabilitiesResultSchema
      },
      {
        name: "list",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["state"],
          properties: {
            state: { enum: ["all", "open", "closed", "merged"] },
            involvement: { enum: ["all", "reviewing", "authored"] },
            filters: prsListFiltersSchema,
            host: prsHostField,
            limit: { type: "integer", minimum: 1, maximum: 50 },
            cursors: prsCursorsSchema,
            query: { type: "string", minLength: 1, maxLength: 200 }
          }
        },
        outputSchema: prsListResultSchema
      },
      {
        name: "listStats",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refs"],
          properties: {
            refs: { type: "array", minItems: 1, maxItems: 100, items: prsRefInputSchema }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["stats"],
          properties: {
            stats: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["projectId", "repository", "number", "additions", "deletions"],
                properties: {
                  projectId: { type: "string", minLength: 1, maxLength: 160 },
                  repository: prsRepositoryField,
                  number: { type: "integer", minimum: 1 },
                  additions: { type: "integer", minimum: 0 },
                  deletions: { type: "integer", minimum: 0 }
                }
              }
            }
          }
        }
      },
      {
        name: "summary",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsSummarySchema
      },
      {
        name: "detail",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsDetailSchema
      },
      {
        name: "activity",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsActivitySchema
      },
      {
        name: "threadComments",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "threadId", "cursor"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            threadId: { type: "string", minLength: 1, maxLength: 512 },
            cursor: { type: "string", minLength: 1, maxLength: 4096 }
          }
        },
        outputSchema: prsThreadCommentsResultSchema
      },
      {
        name: "stack",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsStackSchema
      },
      {
        name: "linkedThreads",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsLinkedThreadsSchema
      },
      {
        name: "reviewerCandidates",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsReviewerCandidateListSchema
      },
      {
        name: "labelCandidates",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: prsRefInputSchema,
        outputSchema: prsLabelCandidateListSchema
      },
      {
        name: "invalidate",
        effect: "read",
        requiredGrants: [PRS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { reference: prsRefInputSchema }
        },
        outputSchema: prsEmptyOutputSchema
      }
    ],
    streams: [
      {
        name: "streamDiff",
        requiredGrants: [PRS_READ],
        inputSchema: prsDiffInputSchema,
        eventSchema: prsDiffStreamEventSchema
      },
      {
        name: "streamDiffFileContents",
        requiredGrants: [PRS_READ],
        inputSchema: prsDiffFileContentsInputSchema,
        eventSchema: vcsDiffFileContentsStreamEventSchema
      },
      {
        name: "subscribeRefreshes",
        requiredGrants: [PRS_READ],
        inputSchema: prsEmptyInputSchema,
        eventSchema: prsRefreshedEventSchema
      }
    ]
  });
  var PRS_READ_API = prsReadApi.definition;
  var COMPOSER_CONTEXT = "t3.composer/context";
  var COMPOSER_WRITE = "t3.composer/write";
  var MESSAGES_ENRICHMENT = "t3.messages/enrichment";
  var MESSAGES_WRITE = "t3.messages/write";
  var composerThreadIdInput = { type: "string", minLength: 1, maxLength: 128 };
  var composerLineInput = { type: "integer", minimum: 1, maximum: 1e6 };
  var composerContextRefSchema = {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1, maxLength: 512 },
      startLine: composerLineInput,
      endLine: composerLineInput,
      // 8 refs at these bounds encode to ≤51 KB worst-case (6 bytes/char for
      // C0 escapes) — inside the broker's 64 KiB copyJson envelope.
      excerpt: { type: "string", maxLength: 512 }
    }
  };
  var composerTransportOutput = (operations) => ({
    type: "object",
    additionalProperties: false,
    required: ["adapter", "transport", "detail", "operations"],
    properties: {
      adapter: { type: "string", maxLength: 64 },
      transport: { enum: ["server", "client", "unavailable"] },
      detail: { type: ["string", "null"], maxLength: 512 },
      operations: {
        type: "object",
        additionalProperties: false,
        required: [...operations],
        properties: Object.fromEntries(operations.map((name) => [name, { type: "boolean" }]))
      }
    }
  });
  var composerEmptyInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var composerContextApi = defineApi({
    id: COMPOSER_CONTEXT,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        // Capability discovery is grant-free so callers can tell "no capability"
        // apart from "no grant" — authority gates the mutations, not the report.
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: composerTransportOutput(["insertContext", "getDraftState"])
      },
      {
        name: "insertContext",
        effect: "write",
        requiredGrants: [COMPOSER_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["refs"],
          properties: {
            threadId: composerThreadIdInput,
            refs: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: composerContextRefSchema
            }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["inserted", "target"],
          properties: {
            inserted: { type: "integer", minimum: 0, maximum: 8 },
            target: { type: "string", minLength: 1, maxLength: 256 }
          }
        }
      },
      {
        name: "getDraftState",
        effect: "read",
        // Draft state carries the user's unsent words — it sits under the same
        // write authority as the mutations on this contract.
        requiredGrants: [COMPOSER_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { threadId: composerThreadIdInput }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["draft"],
          properties: {
            draft: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["prompt", "promptTruncated", "contextCounts"],
              properties: {
                // 10,000 chars worst-case encodes to 60,000 UTF-8 bytes
                // (6/char for C0 escapes) — the response always fits the
                // broker's 64 KiB copyJson envelope. Longer drafts are cut
                // on a char boundary and disclosed via promptTruncated.
                prompt: { type: "string", maxLength: 1e4 },
                promptTruncated: { type: "boolean" },
                contextCounts: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "files",
                    "images",
                    "terminalContexts",
                    "elementContexts",
                    "previewAnnotations",
                    "reviewComments"
                  ],
                  properties: {
                    files: { type: "integer", minimum: 0, maximum: 1e4 },
                    images: { type: "integer", minimum: 0, maximum: 1e4 },
                    terminalContexts: { type: "integer", minimum: 0, maximum: 1e4 },
                    elementContexts: { type: "integer", minimum: 0, maximum: 1e4 },
                    previewAnnotations: { type: "integer", minimum: 0, maximum: 1e4 },
                    reviewComments: { type: "integer", minimum: 0, maximum: 1e4 }
                  }
                }
              }
            }
          }
        }
      }
    ]
  });
  var messagesEnrichmentApi = defineApi({
    id: MESSAGES_ENRICHMENT,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: composerTransportOutput(["attachAnnotation"])
      },
      {
        name: "attachAnnotation",
        effect: "write",
        requiredGrants: [MESSAGES_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotation"],
          properties: {
            threadId: composerThreadIdInput,
            annotation: {
              type: "object",
              additionalProperties: false,
              required: ["filePath", "startLine", "endLine", "body"],
              properties: {
                filePath: { type: "string", minLength: 1, maxLength: 512 },
                startLine: composerLineInput,
                endLine: composerLineInput,
                // body + excerpt at 4,096 chars each keep the worst-case
                // encoded request (~53 KB) inside the 64 KiB invoke envelope.
                body: { type: "string", minLength: 1, maxLength: 4096 },
                excerpt: { type: "string", maxLength: 4096 }
              }
            }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotationId"],
          properties: {
            annotationId: { type: "string", minLength: 1, maxLength: 256 }
          }
        }
      }
    ]
  });
  var COMPOSER_CONTEXT_API = composerContextApi.definition;
  var MESSAGES_ENRICHMENT_API = messagesEnrichmentApi.definition;
  var orchestrationStatusApi = defineOrchestrationStatusApi(vcsDiffPreviewStreamEventSchema);
  var ORCHESTRATION_STATUS_API = orchestrationStatusApi.definition;
  var GENERIC_API_CATALOGUE = [
    orchestrationStatusApi.definition,
    orchestrationControlApi.definition,
    browserLocalServersApi.definition,
    workspaceFilesApi.definition,
    workspaceTreeApi.definition,
    workspaceSearchApi.definition,
    workspaceChangesApi.definition,
    textEditsApi.definition,
    textEditsApiV1.definition,
    filePresentationApi.definition,
    terminalSessionsApi.definition,
    terminalOutputApi.definition,
    terminalOutputEventsApi.definition,
    terminalSessionsApiV1.definition,
    terminalControlApi.definition,
    vcsStatusApi.definition,
    vcsRefsApi.definition,
    vcsChangesApi.definition,
    vcsDiffApi.definition,
    vcsRepositoryApi.definition,
    vcsRepositoryApiV1.definition,
    vcsDiffApiV1.definition,
    resourcesLeaseApi.definition,
    resourcesLeaseApiV1.definition,
    prsReadApi.definition,
    composerContextApi.definition,
    messagesEnrichmentApi.definition
  ];
  function canonical(value) {
    if (Array.isArray(value))
      return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => JSON.stringify(key) + ":" + canonical(child)).join(",") + "}";
    return JSON.stringify(value);
  }
  function assertProvidedApiOwner(pluginId, definition) {
    if (definition.id.startsWith(pluginId + "/"))
      return;
    const owned = GENERIC_API_CATALOGUE.some((item) => item.id === definition.id && canonical(item) === canonical(definition));
    if (!owned)
      throw new Error("Foreign API namespace or incompatible shared API contract");
  }
  var WORKSPACE_FILES_API = workspaceFilesApi.definition;
  var WORKSPACE_SEARCH_API = workspaceSearchApi.definition;
  var WORKSPACE_CHANGES_API = workspaceChangesApi.definition;
  var FILE_PRESENTATION_API = filePresentationApi.definition;
  var TERMINAL_SESSIONS_API = terminalSessionsApi.definition;
  var TERMINAL_SESSIONS_API_V1 = terminalSessionsApiV1.definition;
  var TERMINAL_OUTPUT_API = terminalOutputApi.definition;
  var TERMINAL_OUTPUT_EVENTS_API = terminalOutputEventsApi.definition;
  var TERMINAL_CONTROL_API = terminalControlApi.definition;

  // ../../extension-sdk/dist/environment.js
  var ENVIRONMENT_MANIFEST_FILE = "t3-extension.json";
  var ENVIRONMENT_ASSET_MEDIA_TYPES = [
    "application/wasm",
    "application/octet-stream",
    "font/woff2"
  ];
  function validateEntry(value) {
    if (typeof value !== "string" || value.length > 240 || !/\.(mjs|js)$/.test(value) || value.split("/").some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === ".."))
      throw new Error("Entry must be a package-relative bundled ESM .mjs or .js file");
  }
  function validateAssetPath(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 240 || value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)))
      throw new Error("Asset path must be package-relative ASCII segments");
  }
  function validateSchemaRefs(value) {
    if (!value || typeof value !== "object")
      return;
    if (Array.isArray(value)) {
      value.forEach(validateSchemaRefs);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#")))
        throw new Error("Tool schemas cannot use external references");
      validateSchemaRefs(child);
    }
  }
  function validateEnvironmentPackage(value) {
    const pkg = copyJson(value);
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg) || pkg.format !== 1 && pkg.format !== 2 && pkg.format !== 3 && pkg.format !== 4 || Object.keys(pkg).some((key) => !(pkg.format === 1 ? ["format", "manifest", "clientEntry", "serverEntry", "tools"] : [
      "format",
      "manifest",
      "clientEntry",
      "serverEntry",
      "tools",
      "dependencies",
      "provides",
      "requires",
      ...pkg.format === 4 ? ["assets"] : []
    ]).includes(key)))
      throw new Error("Invalid environment package");
    const manifest = validateManifest(pkg.manifest);
    if (pkg.clientEntry === void 0 && pkg.serverEntry === void 0)
      throw new Error("Package requires a client or server entry");
    if (pkg.clientEntry !== void 0)
      validateEntry(pkg.clientEntry);
    if (pkg.serverEntry !== void 0)
      validateEntry(pkg.serverEntry);
    if (!Array.isArray(pkg.tools) || pkg.tools.length > 16 || pkg.tools.length > 0 && !pkg.serverEntry)
      throw new Error("Invalid package tools or missing server entry");
    if ((manifest.surfaces.length || manifest.composerContexts?.length || manifest.messageDecorations?.length) && !pkg.clientEntry)
      throw new Error("Client contributions require a client entry");
    const ids = /* @__PURE__ */ new Set();
    for (const tool of pkg.tools) {
      assertId(tool.id);
      if (!tool.id.startsWith(manifest.id + "/") || ids.has(tool.id))
        throw new Error("Duplicate or foreign tool");
      ids.add(tool.id);
      if (typeof tool.title !== "string" || !tool.title.trim() || tool.title.length > 200 || typeof tool.description !== "string" || !tool.description.trim() || tool.description.length > 4e3 || tool.readOnly !== true || !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema) || !Array.isArray(tool.capabilities) || tool.capabilities.length > 16)
        throw new Error("Invalid tool descriptor");
      const capabilities = /* @__PURE__ */ new Set();
      for (const capability of tool.capabilities) {
        assertId(capability);
        if (capabilities.has(capability))
          throw new Error("Duplicate tool capability");
        capabilities.add(capability);
      }
      validateSchemaRefs(tool.inputSchema);
    }
    if (pkg.format === 2 || pkg.format === 3 || pkg.format === 4) {
      for (const array of [pkg.dependencies, pkg.provides, pkg.requires])
        if (!Array.isArray(array) || array.length > 32)
          throw new Error("Invalid capability declarations");
      if (pkg.provides.length && !pkg.serverEntry)
        throw new Error("API providers require a server entry");
      const dependencies = /* @__PURE__ */ new Set();
      for (const dependency of pkg.dependencies) {
        assertId(dependency.pluginId);
        if (dependency.pluginId.includes("/") || dependencies.has(dependency.pluginId))
          throw new Error("Duplicate or invalid dependency");
        dependencies.add(dependency.pluginId);
        validateRangeText(dependency.versionRange);
        if (!Array.isArray(dependency.apis) || dependency.apis.length > 32)
          throw new Error("Invalid dependency APIs");
        const ids2 = /* @__PURE__ */ new Set();
        for (const api of dependency.apis) {
          validateApiRequirement(api);
          if (ids2.has(api.id))
            throw new Error("Duplicate dependency API");
          ids2.add(api.id);
        }
      }
      const provided = /* @__PURE__ */ new Set();
      for (const api of pkg.provides) {
        validateApiDefinition(api);
        if (pkg.format === 2 && api.streams?.length)
          throw new Error("API streams require package format 3");
        assertProvidedApiOwner(manifest.id, api);
        if (provided.has(api.id))
          throw new Error("Duplicate provided API");
        provided.add(api.id);
      }
      const required = /* @__PURE__ */ new Set();
      for (const api of pkg.requires) {
        validateApiRequirement(api);
        if (required.has(api.id))
          throw new Error("Duplicate required API");
        required.add(api.id);
      }
    }
    if (pkg.format === 4) {
      if (!Array.isArray(pkg.assets) || pkg.assets.length > 32)
        throw new Error("Invalid package assets");
      const paths = /* @__PURE__ */ new Set();
      const entries = /* @__PURE__ */ new Set([pkg.clientEntry, pkg.serverEntry, ENVIRONMENT_MANIFEST_FILE]);
      const allPaths = /* @__PURE__ */ new Set([
        ...[pkg.clientEntry, pkg.serverEntry, ENVIRONMENT_MANIFEST_FILE].filter((path3) => path3 !== void 0),
        ...pkg.assets.map((asset) => asset.path)
      ]);
      for (const asset of pkg.assets) {
        if (!asset || typeof asset !== "object" || Object.keys(asset).some((key) => !["path", "byteLength", "sha256", "mediaType"].includes(key)) || typeof asset.path !== "string" || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0 || asset.byteLength > 4 * 1024 * 1024 || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) || !ENVIRONMENT_ASSET_MEDIA_TYPES.includes(asset.mediaType))
          throw new Error("Invalid package asset");
        validateAssetPath(asset.path);
        if (paths.has(asset.path) || entries.has(asset.path))
          throw new Error("Duplicate package asset");
        paths.add(asset.path);
      }
      for (const path3 of allPaths)
        for (const other of allPaths)
          if (path3 !== other && other.startsWith(path3 + "/"))
            throw new Error("Package path is an ancestor of another path");
      if (pkg.assets.reduce((total, asset) => total + asset.byteLength, 0) > 8 * 1024 * 1024)
        throw new Error("Package assets exceed aggregate limit");
    }
    return { ...pkg, manifest };
  }

  // ../../extension-sdk/dist/authoring.js
  var statePreview = (state2) => {
    const encoded = JSON.stringify(state2);
    return encoded.length > 200 ? encoded.slice(0, 200) + "\u2026" : encoded;
  };
  var shapeText = (schema) => {
    const optional = new Set(schema.optional ?? []);
    return "{" + Object.entries(schema.fields).map(([key, type]) => key + (optional.has(key) ? "?" : "") + ": " + type).join(", ") + "}";
  };
  var restoreFix = "Fix the value passed to session.save() or the stored record. If the persisted shape changed on purpose, update the surface's stateSchema and bump stateVersion so incompatible saves are not restored.";
  function restoreStateValidator(surfaceId, stateVersion, schema) {
    return (state2) => {
      if (state2 === null)
        return true;
      const prefix = `Invalid restore state for "${surfaceId}" (stateVersion ${stateVersion}): `;
      const expected = `expected null (nothing saved yet) or an object matching ${shapeText(schema)}`;
      if (typeof state2 !== "object" || Array.isArray(state2))
        throw new Error(`${prefix}${expected}; received ${statePreview(state2)}. ${restoreFix}`);
      const optional = new Set(schema.optional ?? []);
      for (const [key, type] of Object.entries(schema.fields)) {
        const value = state2[key];
        if (value === void 0) {
          if (optional.has(key))
            continue;
          throw new Error(`${prefix}missing required field "${key}" (${type}). Expected ${shapeText(schema)}; received ${statePreview(state2)}. ${restoreFix}`);
        }
        if (typeof value !== type)
          throw new Error(`${prefix}expected field "${key}" to be ${type}, received ${typeof value} (${statePreview(value)}). Expected ${shapeText(schema)}. ${restoreFix}`);
      }
      return true;
    };
  }
  function nullOnlyValidator(surfaceId) {
    return (state2) => {
      if (state2 === null)
        return true;
      throw new Error(`Invalid restore state for "${surfaceId}": the surface received persisted state ${statePreview(state2)} but declares neither stateSchema nor validateRestore, so only null is accepted. Declare a stateSchema (or a validateRestore predicate) on the surface, and bump stateVersion if the shape differs from older saves.`);
    };
  }
  function defineExtension(source) {
    const surfaces = source.surfaces ?? [];
    const provides = source.provides ?? [];
    const assets = source.assets ?? [];
    for (const asset of assets) {
      validateAssetPath(asset?.path);
      if (!ENVIRONMENT_ASSET_MEDIA_TYPES.includes(asset?.mediaType))
        throw new Error("Invalid package asset media type");
    }
    const manifest = {
      id: source.id,
      version: source.version,
      apiVersion: 1,
      surfaces: surfaces.map(({ name, title, scope, placements, clients, capabilities, stateVersion }) => ({
        id: source.id + "/" + name,
        title,
        scope,
        placements: placements ?? ["side-panel"],
        clients: clients ?? ["web", "desktop"],
        capabilities: capabilities ?? [],
        stateVersion: stateVersion ?? 1
      }))
    };
    const pkg = validateEnvironmentPackage({
      format: assets.length ? 4 : provides.some((api) => api.streams?.length) ? 3 : 2,
      manifest,
      ...surfaces.length ? { clientEntry: "client.mjs" } : {},
      ...source.serverEntry ? { serverEntry: "server.mjs" } : {},
      tools: [],
      provides,
      requires: source.requires ?? [],
      dependencies: source.dependencies ?? [],
      // The packer replaces this placeholder with verified digests; declared paths survive on the extension.
      ...assets.length ? { assets: [] } : {}
    });
    return {
      package: pkg,
      ...assets.length ? { assets } : {},
      ...source.serverEntry ? { serverEntry: source.serverEntry } : {},
      ...surfaces.length ? {
        client: (host) => ({
          manifest: pkg.manifest,
          surfaces: surfaces.map((surface) => {
            const id2 = source.id + "/" + surface.name;
            return {
              id: id2,
              validateRestore: surface.validateRestore ?? (surface.stateSchema ? restoreStateValidator(id2, surface.stateVersion ?? 1, surface.stateSchema) : nullOnlyValidator(id2)),
              createView: (session) => surface.createView(host, session)
            };
          })
        })
      } : {}
    };
  }
  function requireApi(api, versionRange = "^" + api.definition.version) {
    return { id: api.definition.id, versionRange };
  }

  // extension.tsx
  var import_react2 = __toESM(require_react(), 1);

  // viewModel.ts
  var CHANGE_LANES = ["conflicted", "staged", "changes", "untracked"];
  function lanesFromChanges(entries) {
    const groups = { conflicted: [], staged: [], changes: [], untracked: [] };
    for (const entry of entries) {
      if (entry.conflicted) groups.conflicted.push(entry);
      if (entry.staged) groups.staged.push(entry);
      if (entry.unstaged) groups.changes.push(entry);
      if (entry.untracked) groups.untracked.push(entry);
      if (!entry.conflicted && !entry.staged && !entry.unstaged && !entry.untracked)
        groups.changes.push(entry);
    }
    return groups;
  }
  function laneTitle(lane) {
    switch (lane) {
      case "conflicted":
        return "Merge conflicts";
      case "staged":
        return "Staged changes";
      case "changes":
        return "Changes";
      case "untracked":
        return "Untracked files";
    }
  }
  function laneCount(lanes) {
    return lanes.conflicted.length + lanes.staged.length + lanes.changes.length + lanes.untracked.length;
  }
  function describeEntry(entry) {
    if (entry.conflicted) return "conflicted";
    if (entry.untracked) return "untracked";
    if (entry.staged && entry.unstaged) return "staged, also modified";
    if (entry.staged) return "staged";
    if (entry.unstaged) return "modified";
    return "changed";
  }
  var VCS_PATHS_MAX = 100;
  function laneMutation(lane) {
    switch (lane) {
      case "staged":
        return { op: "unstage", label: "Unstage all" };
      case "changes":
      case "untracked":
        return { op: "stage", label: "Stage all" };
      case "conflicted":
        return null;
    }
  }
  function entryMutation(lane) {
    const bulk = laneMutation(lane);
    if (bulk === null) return null;
    return { ...bulk, label: bulk.op === "stage" ? "Stage" : "Unstage" };
  }
  function planCommit(lanes, message2) {
    if (lanes.conflicted.length > 0) {
      return {
        disabled: "Resolve merge conflicts before committing",
        label: "Commit",
        paths: void 0
      };
    }
    const staged = lanes.staged.map((entry) => entry.path);
    if (staged.length > VCS_PATHS_MAX) {
      return {
        disabled: `Over ${VCS_PATHS_MAX} staged paths \u2014 unstage some, or unstage all to commit every change`,
        label: `Commit staged (${staged.length})`,
        paths: void 0
      };
    }
    if (laneCount(lanes) === 0) {
      return { disabled: "No changes to commit", label: "Commit", paths: void 0 };
    }
    if (message2.trim().length === 0) {
      const label = staged.length > 0 ? `Commit staged (${staged.length})` : "Commit all changes";
      return { disabled: "Enter a commit message", label, paths: void 0 };
    }
    if (staged.length > 0) {
      return {
        disabled: null,
        label: `Commit staged (${staged.length})`,
        paths: staged
      };
    }
    return { disabled: null, label: "Commit all changes", paths: void 0 };
  }
  var IDLE_MUTATION = { kind: "idle" };
  function startMutation(phase, op, label) {
    if (phase.kind === "running") return null;
    return { kind: "running", op, label };
  }
  function settleMutation(op, result) {
    return result.ok ? { kind: "succeeded", op, detail: result.detail } : { kind: "failed", op, detail: result.detail };
  }
  function describeMutation(phase) {
    switch (phase.kind) {
      case "idle":
        return null;
      case "running":
        return `${phase.label}\u2026`;
      case "succeeded":
        return phase.detail;
      case "failed":
        return phase.detail;
    }
  }
  function planRefCreate(input, rows) {
    const refName = input.trim();
    if (refName.length === 0) return { refName: null, disabled: "Enter a branch name" };
    if (rows.some((row) => row.remote === null && row.name === refName)) {
      return { refName: null, disabled: `Branch ${refName} already exists` };
    }
    return { refName, disabled: null };
  }
  function refSwitchState(row, currentBranch) {
    if (row.current) return { ok: false, reason: null };
    if (row.worktreePath !== null) return { ok: false, reason: "Checked out in a worktree" };
    if (row.remote !== null && row.name === currentBranch) {
      return { ok: false, reason: "Remote of the current branch" };
    }
    return { ok: true, reason: null };
  }
  function refSwitchTarget(row) {
    return row.remote === null ? row.name : `${row.remote}/${row.name}`;
  }
  function pullState(local, remote) {
    if (local === null) return { disabled: "Repository status pending", label: "Pull" };
    if (local.refName === null)
      return { disabled: "Detached HEAD \u2014 checkout a ref before pulling", label: "Pull" };
    if (remote === null) return { disabled: "Upstream status pending", label: "Pull" };
    if (!remote.hasUpstream) return { disabled: "No upstream configured", label: "Pull" };
    if (remote.behindCount > 0 && remote.aheadCount > 0)
      return { disabled: "Diverged from upstream \u2014 rebase or merge first", label: "Pull" };
    if (remote.behindCount === 0) return { disabled: "Already up to date", label: "Pull" };
    return { disabled: null, label: `Pull \u2193${remote.behindCount}` };
  }
  function pushState(local, remote) {
    if (local === null) return { disabled: "Repository status pending", label: "Push" };
    if (local.refName === null)
      return { disabled: "Detached HEAD \u2014 checkout a ref before pushing", label: "Push" };
    if (local.hasWorkingTreeChanges)
      return { disabled: "Commit local changes before pushing", label: "Push" };
    if (remote === null) return { disabled: "Upstream status pending", label: "Push" };
    if (remote.behindCount > 0)
      return {
        disabled: remote.aheadCount > 0 ? "Diverged from upstream \u2014 rebase or merge first" : "Behind upstream \u2014 pull first",
        label: "Push"
      };
    if (!remote.hasUpstream && !local.hasPrimaryRemote)
      return { disabled: 'Add an "origin" remote before pushing', label: "Push" };
    if (remote.aheadCount === 0) return { disabled: "No local commits to push", label: "Push" };
    return { disabled: null, label: `Push \u2191${remote.aheadCount}` };
  }
  function remoteRows(result) {
    return (result?.remotes ?? []).map((remote) => ({
      name: remote.name,
      url: remote.url,
      isPrimary: remote.isPrimary
    }));
  }
  function worktreeRows(rows) {
    return rows.flatMap(
      (row) => row.worktreePath !== null && !row.current ? [{ refName: row.name, path: row.worktreePath }] : []
    );
  }
  function canWorktreeRef(row) {
    return row.remote === null && !row.current && row.worktreePath === null;
  }
  function planWorktreeCreate(input, rows, currentBranch) {
    const branch = input.trim();
    const none = { branch: null, refName: null, baseRefName: null };
    if (branch.length === 0) return { ...none, disabled: "Enter a branch name" };
    if (rows.some((row) => row.remote === null && row.name === branch)) {
      return { ...none, disabled: `Branch ${branch} already exists` };
    }
    return {
      branch,
      refName: currentBranch ?? "HEAD",
      baseRefName: currentBranch,
      disabled: null
    };
  }
  function retainSelection(selection, lanes) {
    if (selection === null) return null;
    if (lanes[selection.lane].some((entry) => entry.path === selection.path)) return selection;
    for (const lane of CHANGE_LANES) {
      if (lanes[lane].some((entry) => entry.path === selection.path)) {
        return { path: selection.path, lane };
      }
    }
    return null;
  }
  var CONNECTING_STATUS = {
    local: null,
    remote: null,
    stream: "connecting",
    detail: null,
    localRevision: 0
  };
  function applyStatusEvent(model, event) {
    switch (event.kind) {
      case "snapshot":
        return {
          local: event.local,
          remote: event.remote,
          stream: "live",
          detail: null,
          localRevision: model.localRevision + 1
        };
      case "localUpdated":
        return {
          ...model,
          local: event.local,
          stream: "live",
          localRevision: model.localRevision + 1
        };
      case "remoteUpdated":
        return { ...model, remote: event.remote };
      case "closed":
        return {
          ...model,
          stream: "ended",
          detail: event.reason === "overflow" ? "The status stream overflowed its event queue." : "The status stream reported a status error."
        };
    }
  }
  function branchLabel(local) {
    return local.refName ?? "detached HEAD";
  }
  function syncLabel(remote) {
    if (remote === null) return "upstream pending";
    if (!remote.hasUpstream) {
      const ahead = remote.aheadOfDefaultCount;
      return ahead !== void 0 && ahead > 0 ? `\u2191${ahead} vs default branch` : "no upstream";
    }
    if (remote.aheadCount === 0 && remote.behindCount === 0) return "in sync with upstream";
    const parts = [];
    if (remote.aheadCount > 0) parts.push(`\u2191${remote.aheadCount}`);
    if (remote.behindCount > 0) parts.push(`\u2193${remote.behindCount}`);
    return parts.join(" ") + " vs upstream";
  }
  function workingTreeLabel(local) {
    const tree = local.workingTree;
    if (!local.hasWorkingTreeChanges && tree.files.length === 0) return "clean";
    const count = tree.files.length;
    const stat = `+${tree.insertions} \u2212${tree.deletions}`;
    return `${count} file${count === 1 ? "" : "s"} changed (${stat})${tree.truncated ? ", list truncated" : ""}`;
  }
  function numstatFor(local, path3) {
    const file = local?.workingTree.files.find((entry) => entry.path === path3);
    return file ? { insertions: file.insertions, deletions: file.deletions } : null;
  }
  function describeStatus(model) {
    if (model.stream === "ended") return `Status updates ended \u2014 ${model.detail ?? "stream closed"}`;
    if (model.local === null) return "Reading repository status\u2026";
    if (!model.local.isRepo) return "This workspace is not a repository";
    const pr = model.remote?.pr;
    const parts = [branchLabel(model.local), syncLabel(model.remote), workingTreeLabel(model.local)];
    if (pr) parts.push(`PR #${pr.number} ${pr.state}`);
    return parts.join(" \u2014 ");
  }
  function refRows(result) {
    if (result === null) return [];
    return result.refs.map((ref) => ({
      name: ref.name,
      current: ref.current,
      isDefault: ref.isDefault,
      remote: ref.isRemote ? ref.remoteName ?? "remote" : null,
      worktreePath: ref.worktreePath
    }));
  }
  function describeRef(row) {
    const badges = [];
    if (row.current) badges.push("current");
    if (row.isDefault) badges.push("default");
    if (row.remote !== null) badges.push(row.remote);
    if (row.worktreePath !== null) badges.push("worktree");
    return badges.join(" \xB7 ");
  }
  function repositoryState(capabilities, error) {
    if (error !== null) return { kind: "unavailable", detail: error };
    if (capabilities === null) return { kind: "loading" };
    if (!capabilities.detected) {
      return { kind: "no-repository", detail: capabilities.detail };
    }
    const ops = capabilities.operations;
    const required = ["status.get", "status.subscribe", "changes.list", "refs.list"];
    if (required.some((operation) => !ops[operation])) {
      const kind = capabilities.kind ?? "unknown";
      return {
        kind: "unsupported",
        driverKind: kind,
        detail: `The detected ${kind} driver does not serve every status/changes/refs read this panel needs.`
      };
    }
    return { kind: "ready", capabilities };
  }

  // prsPanel.tsx
  var import_react = __toESM(require_react(), 1);

  // ../../../node_modules/.pnpm/@pierre+diffs@1.3.0-beta.10_patch_hash=0ccee155b93b63d810e2c1a40c1fd676fb6fbcfa72cf6430_61e9491b81eb5c1b21f7baa527073f84/node_modules/@pierre/diffs/dist/constants.js
  var DIFFS_DEVELOPMENT_BUILD = (() => {
    try {
      return true;
    } catch {
      return false;
    }
  })();
  var COMMIT_METADATA_SPLIT = /(?=^From [a-f0-9]+ .+$)/m;
  var GIT_DIFF_FILE_BREAK_REGEX = /(?=^diff --git)/gm;
  var FILENAME_HEADER_REGEX = /^(---|\+\+\+)\s+([^\t\r\n]+)/;
  var FILENAME_HEADER_REGEX_GIT = /^(---|\+\+\+)\s+[ab]\/([^\t\r\n]+)/;
  var ALTERNATE_FILE_NAMES_GIT = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/;
  var INDEX_LINE_METADATA = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/i;
  var DEFAULT_VIRTUAL_FILE_METRICS = {
    hunkLineCount: 50,
    lineHeight: 20,
    diffHeaderHeight: 44,
    spacing: 8
  };
  var DEFAULT_CODE_VIEW_FILE_METRICS = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    hunkLineCount: 1
  };
  var DEFAULT_EXPANDED_REGION = Object.freeze({
    fromStart: 0,
    fromEnd: 0
  });

  // ../../../node_modules/.pnpm/@pierre+diffs@1.3.0-beta.10_patch_hash=0ccee155b93b63d810e2c1a40c1fd676fb6fbcfa72cf6430_61e9491b81eb5c1b21f7baa527073f84/node_modules/@pierre/diffs/dist/utils/cleanLastNewline.js
  function cleanLastNewline(contents2) {
    let end = contents2.length;
    if (contents2.charCodeAt(end - 1) === 10) {
      end--;
      if (contents2.charCodeAt(end - 1) === 13) end--;
    }
    return contents2.slice(0, end);
  }

  // ../../../node_modules/.pnpm/@pierre+diffs@1.3.0-beta.10_patch_hash=0ccee155b93b63d810e2c1a40c1fd676fb6fbcfa72cf6430_61e9491b81eb5c1b21f7baa527073f84/node_modules/@pierre/diffs/dist/utils/detachString.js
  var stringDetachEncoder = new TextEncoder();
  var stringDetachDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
  var SURROGATE_CODE_UNIT_PATTERN = /[\uD800-\uDFFF]/;
  var STRING_DETACH_INITIAL_BUFFER_SIZE = 1024;
  var stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);
  function releaseStringDetachBuffer() {
    if (stringDetachBuffer.length !== STRING_DETACH_INITIAL_BUFFER_SIZE) stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);
  }
  function detachString(value) {
    if (value.length === 0) return value;
    if (SURROGATE_CODE_UNIT_PATTERN.test(value)) return JSON.parse(JSON.stringify(value));
    const requiredByteLength = value.length * 3;
    if (stringDetachBuffer.length < requiredByteLength) stringDetachBuffer = new Uint8Array(requiredByteLength);
    const { written } = stringDetachEncoder.encodeInto(value, stringDetachBuffer);
    return stringDetachDecoder.decode(stringDetachBuffer.subarray(0, written));
  }

  // ../../../node_modules/.pnpm/@pierre+diffs@1.3.0-beta.10_patch_hash=0ccee155b93b63d810e2c1a40c1fd676fb6fbcfa72cf6430_61e9491b81eb5c1b21f7baa527073f84/node_modules/@pierre/diffs/dist/utils/realignChangeContent.js
  var MAX_ALIGNMENT_COMPARISONS = 4096;
  var MIN_IMPROVEMENT_PER_PAIR = 0.5;
  function realignChangeContentBySimilarity(diff) {
    for (const hunk of diff.hunks) {
      for (let index = 0; index < hunk.hunkContent.length; index++) {
        const content = hunk.hunkContent[index];
        if (content.type !== "change") continue;
        const replacement = realignChangeBlock(diff, content);
        if (replacement != null) {
          hunk.hunkContent.splice(index, 1, ...replacement);
          index += replacement.length - 1;
        }
      }
      slideBlankBoundaryBlocksUp(hunk, diff);
    }
  }
  function slideBlankBoundaryBlocksUp(hunk, diff) {
    const { hunkContent } = hunk;
    for (let index = 1; index < hunkContent.length; index++) {
      const block = hunkContent[index];
      const previous = hunkContent[index - 1];
      if (block.type !== "change" || block.additions > 0 && block.deletions > 0 || previous.type !== "context") continue;
      const isInsert = block.additions > 0;
      const lines = isInsert ? diff.additionLines : diff.deletionLines;
      const blockStart = isInsert ? block.additionLineIndex : block.deletionLineIndex;
      const blockLength = isInsert ? block.additions : block.deletions;
      const unit = lines[blockStart] ?? "";
      if (unit.trim() !== "") continue;
      let uniform = true;
      for (let offset = 1; offset < blockLength; offset++) if (lines[blockStart + offset] !== unit) {
        uniform = false;
        break;
      }
      if (!uniform) continue;
      let slide = 0;
      while (slide < previous.lines && diff.additionLines[previous.additionLineIndex + previous.lines - 1 - slide] === unit) slide++;
      if (slide === 0) continue;
      block.additionLineIndex -= slide;
      block.deletionLineIndex -= slide;
      const blockAdditionEnd = block.additionLineIndex + block.additions;
      const blockDeletionEnd = block.deletionLineIndex + block.deletions;
      const next = hunkContent[index + 1];
      if (next?.type === "context") {
        next.lines += slide;
        next.additionLineIndex = blockAdditionEnd;
        next.deletionLineIndex = blockDeletionEnd;
      } else hunkContent.splice(index + 1, 0, {
        type: "context",
        lines: slide,
        additionLineIndex: blockAdditionEnd,
        deletionLineIndex: blockDeletionEnd
      });
      previous.lines -= slide;
      if (previous.lines === 0) {
        hunkContent.splice(index - 1, 1);
        index--;
      }
    }
  }
  function realignChangeBlock(diff, content) {
    const { deletions, additions, deletionLineIndex, additionLineIndex } = content;
    const pairCount = Math.min(deletions, additions);
    const surplus = Math.abs(additions - deletions);
    if (pairCount === 0 || surplus === 0 || pairCount * (surplus + 1) > MAX_ALIGNMENT_COMPARISONS) return null;
    const strippedDeletions = [];
    for (let line = 0; line < deletions; line++) strippedDeletions.push(stripWhitespace(diff.deletionLines[deletionLineIndex + line] ?? ""));
    const strippedAdditions = [];
    for (let line = 0; line < additions; line++) strippedAdditions.push(stripWhitespace(diff.additionLines[additionLineIndex + line] ?? ""));
    const additionsAreLonger = additions > deletions;
    let bestOffset = 0;
    let bestScore = -1;
    for (let offset = 0; offset <= surplus; offset++) {
      let score = 0;
      for (let pair = 0; pair < pairCount; pair++) score += lineSimilarity(strippedDeletions[pair + (additionsAreLonger ? 0 : offset)], strippedAdditions[pair + (additionsAreLonger ? offset : 0)]);
      if (offset === 0) bestScore = score + pairCount * MIN_IMPROVEMENT_PER_PAIR;
      else if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    if (bestOffset === 0) return null;
    const blocks = [];
    const pushBlock = (blockDeletions, blockAdditions, blockDeletionIndex, blockAdditionIndex) => {
      if (blockDeletions > 0 || blockAdditions > 0) blocks.push({
        type: "change",
        deletions: blockDeletions,
        additions: blockAdditions,
        deletionLineIndex: blockDeletionIndex,
        additionLineIndex: blockAdditionIndex
      });
    };
    if (additionsAreLonger) {
      pushBlock(0, bestOffset, deletionLineIndex, additionLineIndex);
      pushBlock(pairCount, pairCount, deletionLineIndex, additionLineIndex + bestOffset);
      pushBlock(0, additions - pairCount - bestOffset, deletionLineIndex + pairCount, additionLineIndex + bestOffset + pairCount);
    } else {
      pushBlock(bestOffset, 0, deletionLineIndex, additionLineIndex);
      pushBlock(pairCount, pairCount, deletionLineIndex + bestOffset, additionLineIndex);
      pushBlock(deletions - pairCount - bestOffset, 0, deletionLineIndex + bestOffset + pairCount, additionLineIndex + pairCount);
    }
    return blocks;
  }
  var WHITESPACE = /\s+/g;
  function stripWhitespace(line) {
    return line.replace(WHITESPACE, "");
  }
  function lineSimilarity(a, b) {
    if (a === b) return 1;
    const maxLength = Math.max(a.length, b.length);
    const minLength = Math.min(a.length, b.length);
    if (minLength === 0) return 0;
    let prefix = 0;
    while (prefix < minLength && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < minLength - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    return (prefix + suffix) / maxLength;
  }

  // ../../../node_modules/.pnpm/@pierre+diffs@1.3.0-beta.10_patch_hash=0ccee155b93b63d810e2c1a40c1fd676fb6fbcfa72cf6430_61e9491b81eb5c1b21f7baa527073f84/node_modules/@pierre/diffs/dist/utils/parsePatchFiles.js
  function processPatch(data, cacheKeyPrefix, throwOnError) {
    try {
      return _processPatch(data, cacheKeyPrefix, throwOnError);
    } finally {
      releaseStringDetachBuffer();
    }
  }
  function _processPatch(data, cacheKeyPrefix, throwOnError = false) {
    const isGitDiff = isGitDiffPatch(data);
    const rawFiles = isGitDiff ? splitGitDiffFiles(data) : splitUnifiedDiffFiles(data);
    let patchMetadata;
    const files = [];
    for (const fileOrPatchMetadata of rawFiles) {
      if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
        if (patchMetadata == null) patchMetadata = detachString(fileOrPatchMetadata);
        else if (throwOnError) throw Error("parsePatchContent: unknown file blob");
        else console.error("parsePatchContent: unknown file blob:", fileOrPatchMetadata);
        continue;
      } else if (!isGitDiff && !startsWithUnifiedDiffFileHeader(fileOrPatchMetadata)) {
        if (patchMetadata == null) patchMetadata = detachString(fileOrPatchMetadata);
        else if (throwOnError) throw Error("parsePatchContent: unknown file blob");
        else console.error("parsePatchContent: unknown file blob:", fileOrPatchMetadata);
        continue;
      }
      const currentFile = _processFile(fileOrPatchMetadata, {
        cacheKey: cacheKeyPrefix != null ? `${cacheKeyPrefix}-${files.length}` : void 0,
        isGitDiff,
        throwOnError
      });
      if (currentFile != null) files.push(currentFile);
    }
    return {
      patchMetadata,
      files
    };
  }
  function _processFile(fileDiffString, { cacheKey, isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString), oldFile, newFile, throwOnError = false } = {}) {
    let lastHunkEnd = 0;
    const hunks = splitAtLinePrefix(fileDiffString, "@@ ");
    let currentFile;
    const isPartial = oldFile == null || newFile == null;
    let deletionLineIndex = 0;
    let additionLineIndex = 0;
    for (const hunk of hunks) {
      const lines = splitWithNewlines(hunk);
      const firstLine = lines[0];
      if (firstLine == null) {
        if (throwOnError) throw Error("parsePatchContent: invalid hunk");
        else console.error("parsePatchContent: invalid hunk", hunk);
        continue;
      }
      const fileHeader = parseHunkHeader(firstLine);
      let additionLines = 0;
      let deletionLines = 0;
      if (fileHeader == null || currentFile == null) {
        if (currentFile != null) {
          if (throwOnError) throw Error("parsePatchContent: Invalid hunk");
          else console.error("parsePatchContent: Invalid hunk", hunk);
          continue;
        }
        currentFile = {
          name: "",
          type: "change",
          hunks: [],
          splitLineCount: 0,
          unifiedLineCount: 0,
          isPartial,
          additionLines: !isPartial && oldFile != null && newFile != null ? splitFileContents(newFile.contents) : [],
          deletionLines: !isPartial && oldFile != null && newFile != null ? splitFileContents(oldFile.contents) : [],
          cacheKey: maybeDetachOptionalString(cacheKey)
        };
        if (currentFile.additionLines.length === 1 && newFile?.contents === "") currentFile.additionLines.length = 0;
        if (currentFile.deletionLines.length === 1 && oldFile?.contents === "") currentFile.deletionLines.length = 0;
        for (const line of lines) {
          if (line.startsWith("diff --git")) {
            const filenameMatch2 = line.trim().match(ALTERNATE_FILE_NAMES_GIT);
            const prevName = filenameMatch2?.[1] ?? filenameMatch2?.[2];
            const name = filenameMatch2?.[3] ?? filenameMatch2?.[4];
            if (prevName == null || name == null) {
              if (throwOnError) throw Error("parsePatchContent: invalid git diff header");
              else console.error("parsePatchContent: invalid git diff header", line);
              continue;
            }
            currentFile.name = detachString(name.trim());
            if (prevName !== name) currentFile.prevName = detachString(prevName.trim());
            continue;
          }
          const filenameMatch = line.startsWith("---") || line.startsWith("+++") ? line.match(isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX) : null;
          if (filenameMatch != null) {
            const [, type, fileName] = filenameMatch;
            if (type === "---" && fileName !== "/dev/null") {
              const detachedFileName = detachString(fileName.trim());
              currentFile.prevName = detachedFileName;
              currentFile.name = detachedFileName;
            } else if (type === "+++" && fileName !== "/dev/null") currentFile.name = detachString(fileName.trim());
          } else if (isGitDiff) {
            if (line.startsWith("new mode ")) currentFile.mode = detachString(line.slice(8).trim());
            if (line.startsWith("old mode ")) currentFile.prevMode = detachString(line.slice(8).trim());
            if (line.startsWith("new file mode")) {
              currentFile.type = "new";
              currentFile.mode = detachString(line.slice(13).trim());
            }
            if (line.startsWith("deleted file mode")) {
              currentFile.type = "deleted";
              currentFile.mode = detachString(line.slice(17).trim());
            }
            if (line.startsWith("similarity index")) if (line.startsWith("similarity index 100%")) currentFile.type = "rename-pure";
            else currentFile.type = "rename-changed";
            if (line.startsWith("index ")) {
              const [, prevObjectId, newObjectId, mode] = line.trim().match(INDEX_LINE_METADATA) ?? [];
              if (prevObjectId != null) currentFile.prevObjectId = detachString(prevObjectId);
              if (newObjectId != null) currentFile.newObjectId = detachString(newObjectId);
              if (mode != null) currentFile.mode = detachString(mode);
            }
            if (line.startsWith("rename from ")) currentFile.prevName = detachString(line.slice(12).trim());
            if (line.startsWith("rename to ")) currentFile.name = detachString(line.slice(10).trim());
          }
        }
        continue;
      }
      let currentContent;
      let lastLineType;
      while (lines.length > 0 && (lines[lines.length - 1] === "\n" || lines[lines.length - 1] === "\r" || lines[lines.length - 1] === "\r\n" || lines[lines.length - 1] === "")) lines.pop();
      const { additionStart, deletionStart } = fileHeader;
      deletionLineIndex = isPartial ? deletionLineIndex : deletionStart - 1;
      additionLineIndex = isPartial ? additionLineIndex : additionStart - 1;
      const hunkData = {
        collapsedBefore: 0,
        splitLineCount: 0,
        splitLineStart: 0,
        unifiedLineCount: 0,
        unifiedLineStart: 0,
        additionCount: fileHeader.additionCount,
        additionStart,
        additionLines,
        deletionCount: fileHeader.deletionCount,
        deletionStart,
        deletionLines,
        deletionLineIndex,
        additionLineIndex,
        hunkContent: [],
        hunkContext: maybeDetachOptionalString(fileHeader.hunkContext),
        hunkSpecs: detachString(firstLine),
        noEOFCRAdditions: false,
        noEOFCRDeletions: false
      };
      let parsedAdditionLines = 0;
      let parsedDeletionLines = 0;
      for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
        const rawLine = lines[lineIndex];
        if (parsedAdditionLines >= hunkData.additionCount && parsedDeletionLines >= hunkData.deletionCount && !rawLine.startsWith("\\")) {
          if (throwOnError && isHunkBodyLine(rawLine) && !isFormatPatchVersionSeparator(rawLine)) throw Error("parsePatchContent: hunk has more lines than expected");
          break;
        }
        const firstChar = rawLine[0];
        if (firstChar !== "+" && firstChar !== "-" && firstChar !== " " && firstChar !== "\\") {
          if (throwOnError) throw Error("parsePatchContent: invalid hunk line");
          console.error(`parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`);
          console.error("processFile: invalid rawLine:", rawLine);
          continue;
        }
        const type = parseRawLineType(firstChar);
        if (type === "addition") {
          if (throwOnError && parsedAdditionLines >= hunkData.additionCount) throw Error("parsePatchContent: hunk has too many addition lines");
          const line = getParsedLineContent(rawLine);
          if (currentContent == null || currentContent.type !== "change") {
            currentContent = createContentGroup("change", deletionLineIndex, additionLineIndex);
            hunkData.hunkContent.push(currentContent);
          }
          additionLineIndex++;
          parsedAdditionLines++;
          if (isPartial) currentFile.additionLines.push(line);
          currentContent.additions++;
          additionLines++;
          lastLineType = "addition";
        } else if (type === "deletion") {
          if (throwOnError && parsedDeletionLines >= hunkData.deletionCount) throw Error("parsePatchContent: hunk has too many deletion lines");
          const line = getParsedLineContent(rawLine);
          if (currentContent == null || currentContent.type !== "change") {
            currentContent = createContentGroup("change", deletionLineIndex, additionLineIndex);
            hunkData.hunkContent.push(currentContent);
          }
          deletionLineIndex++;
          parsedDeletionLines++;
          if (isPartial) currentFile.deletionLines.push(line);
          currentContent.deletions++;
          deletionLines++;
          lastLineType = "deletion";
        } else if (type === "context") {
          if (throwOnError && (parsedDeletionLines >= hunkData.deletionCount || parsedAdditionLines >= hunkData.additionCount)) throw Error("parsePatchContent: hunk has too many context lines");
          const line = getParsedLineContent(rawLine);
          if (currentContent == null || currentContent.type !== "context") {
            currentContent = createContentGroup("context", deletionLineIndex, additionLineIndex);
            hunkData.hunkContent.push(currentContent);
          }
          additionLineIndex++;
          deletionLineIndex++;
          parsedAdditionLines++;
          parsedDeletionLines++;
          if (isPartial) {
            currentFile.deletionLines.push(line);
            currentFile.additionLines.push(line);
          }
          currentContent.lines++;
          lastLineType = "context";
        } else if (type === "metadata" && currentContent != null) {
          if (currentContent.type === "context") {
            hunkData.noEOFCRAdditions = true;
            hunkData.noEOFCRDeletions = true;
          } else if (lastLineType === "deletion") hunkData.noEOFCRDeletions = true;
          else if (lastLineType === "addition") hunkData.noEOFCRAdditions = true;
          if (isPartial && (lastLineType === "addition" || lastLineType === "context")) {
            const lastIndex = currentFile.additionLines.length - 1;
            if (lastIndex >= 0) currentFile.additionLines[lastIndex] = cleanLastNewline(currentFile.additionLines[lastIndex]);
          }
          if (isPartial && (lastLineType === "deletion" || lastLineType === "context")) {
            const lastIndex = currentFile.deletionLines.length - 1;
            if (lastIndex >= 0) currentFile.deletionLines[lastIndex] = cleanLastNewline(currentFile.deletionLines[lastIndex]);
          }
        }
      }
      if (throwOnError && (parsedAdditionLines !== hunkData.additionCount || parsedDeletionLines !== hunkData.deletionCount)) throw Error("parsePatchContent: hunk line count mismatch");
      hunkData.additionLines = additionLines;
      hunkData.deletionLines = deletionLines;
      hunkData.collapsedBefore = Math.max(hunkData.additionStart - 1 - lastHunkEnd, 0);
      currentFile.hunks.push(hunkData);
      lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1;
      for (const content of hunkData.hunkContent) if (content.type === "context") {
        hunkData.splitLineCount += content.lines;
        hunkData.unifiedLineCount += content.lines;
      } else {
        hunkData.splitLineCount += Math.max(content.additions, content.deletions);
        hunkData.unifiedLineCount += content.deletions + content.additions;
      }
      hunkData.splitLineStart = currentFile.splitLineCount + hunkData.collapsedBefore;
      hunkData.unifiedLineStart = currentFile.unifiedLineCount + hunkData.collapsedBefore;
      currentFile.splitLineCount += hunkData.collapsedBefore + hunkData.splitLineCount;
      currentFile.unifiedLineCount += hunkData.collapsedBefore + hunkData.unifiedLineCount;
    }
    if (currentFile == null) return;
    if (throwOnError && isPartial && !isGitDiff && currentFile.hunks.length === 0) throw Error("parsePatchContent: unified file has no hunks");
    if (currentFile.hunks.length > 0 && !isPartial && currentFile.additionLines.length > 0 && currentFile.deletionLines.length > 0) {
      const lastHunk = currentFile.hunks[currentFile.hunks.length - 1];
      const lastHunkEnd2 = lastHunk.additionStart + lastHunk.additionCount - 1;
      const totalFileLines = currentFile.additionLines.length;
      const collapsedAfter = Math.max(totalFileLines - lastHunkEnd2, 0);
      currentFile.splitLineCount += collapsedAfter;
      currentFile.unifiedLineCount += collapsedAfter;
    }
    if (!isGitDiff) {
      if (currentFile.prevName != null && currentFile.name !== currentFile.prevName) if (currentFile.hunks.length > 0) currentFile.type = "rename-changed";
      else currentFile.type = "rename-pure";
      else if ((oldFile == null || oldFile.contents === "") && newFile != null && newFile.contents !== "") currentFile.type = "new";
      else if (oldFile != null && oldFile.contents !== "" && (newFile == null || newFile.contents === "")) currentFile.type = "deleted";
    }
    if (currentFile.type !== "rename-pure" && currentFile.type !== "rename-changed") currentFile.prevName = void 0;
    realignChangeContentBySimilarity(currentFile);
    return currentFile;
  }
  function parsePatchFiles(data, cacheKeyPrefix, throwOnError = false) {
    const patches = [];
    const rawPatches = hasCommitMetadataBoundary(data) ? data.split(COMMIT_METADATA_SPLIT) : [data];
    for (const patch of rawPatches) try {
      patches.push(processPatch(patch, cacheKeyPrefix != null ? `${cacheKeyPrefix}-${patches.length}` : void 0, throwOnError));
    } catch (error) {
      if (throwOnError) throw error;
      else console.error(error);
    }
    return patches;
  }
  function hasCommitMetadataBoundary(data) {
    return data.startsWith("From ") || data.includes("\nFrom ");
  }
  function splitFileContents(contents2) {
    const lines = splitWithNewlines(contents2);
    for (let index = 0; index < lines.length; index++) lines[index] = detachString(lines[index]);
    return lines;
  }
  function splitWithNewlines(contents2) {
    if (contents2.length === 0) return [""];
    const lines = [];
    let startIndex = 0;
    for (; ; ) {
      const newlineIndex = contents2.indexOf("\n", startIndex);
      if (newlineIndex === -1) break;
      lines.push(contents2.slice(startIndex, newlineIndex + 1));
      startIndex = newlineIndex + 1;
    }
    if (startIndex < contents2.length) lines.push(contents2.slice(startIndex));
    return lines;
  }
  function splitGitDiffFiles(contents2) {
    return splitAtLinePrefix(contents2, "diff --git");
  }
  function splitUnifiedDiffFiles(contents2) {
    if (contents2.length === 0) return [""];
    const parts = [];
    let partStartIndex = 0;
    let lineStartIndex = 0;
    let remainingDeletionLines = 0;
    let remainingAdditionLines = 0;
    let hasOpenedUnifiedFile = false;
    while (lineStartIndex < contents2.length) {
      const nextLineStartIndex = getNextLineStartIndex(contents2, lineStartIndex);
      if (remainingDeletionLines <= 0 && remainingAdditionLines <= 0) {
        if (isUnifiedDiffFileHeaderAt(contents2, lineStartIndex)) {
          if (lineStartIndex > partStartIndex) parts.push(contents2.slice(partStartIndex, lineStartIndex));
          partStartIndex = lineStartIndex;
          hasOpenedUnifiedFile = true;
          lineStartIndex = getNextLineStartIndex(contents2, nextLineStartIndex);
          continue;
        }
        if (hasOpenedUnifiedFile && contents2.startsWith("@@ -", lineStartIndex)) {
          const fileHeader = parseHunkHeader(contents2.slice(lineStartIndex, nextLineStartIndex));
          if (fileHeader != null) {
            remainingDeletionLines = fileHeader.deletionCount;
            remainingAdditionLines = fileHeader.additionCount;
          }
        }
        lineStartIndex = nextLineStartIndex;
        continue;
      }
      const firstChar = contents2[lineStartIndex];
      if (firstChar === "\\") {
        lineStartIndex = nextLineStartIndex;
        continue;
      }
      if (firstChar === " ") {
        remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
        remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
      } else if (firstChar === "-") remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
      else if (firstChar === "+") remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
      lineStartIndex = nextLineStartIndex;
    }
    parts.push(contents2.slice(partStartIndex));
    return parts;
  }
  function startsWithUnifiedDiffFileHeader(contents2) {
    return isUnifiedDiffFileHeaderAt(contents2, 0);
  }
  function isUnifiedDiffFileHeaderAt(contents2, lineStartIndex) {
    const nextLineStartIndex = getNextLineStartIndex(contents2, lineStartIndex);
    return isUnifiedDiffHeaderLineAt(contents2, lineStartIndex, "---") && isUnifiedDiffHeaderLineAt(contents2, nextLineStartIndex, "+++");
  }
  function isUnifiedDiffHeaderLineAt(contents2, lineStartIndex, prefix) {
    if (!contents2.startsWith(prefix, lineStartIndex)) return false;
    const separator = contents2[lineStartIndex + prefix.length];
    if (separator !== " " && separator !== "	") return false;
    for (let index = lineStartIndex + prefix.length + 1; index < contents2.length; index++) {
      const char = contents2[index];
      if (char === "\n" || char === "\r") break;
      if (char !== " " && char !== "	") return true;
    }
    return false;
  }
  function getNextLineStartIndex(contents2, lineStartIndex) {
    const newlineIndex = contents2.indexOf("\n", lineStartIndex);
    return newlineIndex === -1 ? contents2.length : newlineIndex + 1;
  }
  function isHunkBodyLine(line) {
    const firstChar = line[0];
    return firstChar === "+" || firstChar === "-" || firstChar === " ";
  }
  function isFormatPatchVersionSeparator(line) {
    if (!line.startsWith("--")) return false;
    for (let index = 2; index < line.length; index++) {
      const char = line[index];
      if (char !== " " && char !== "	" && char !== "\n" && char !== "\r") return false;
    }
    return true;
  }
  function parseHunkHeader(line) {
    if (!line.startsWith("@@ -")) return;
    let index = 4;
    const deletionStartResult = readPositiveInteger(line, index);
    if (deletionStartResult == null) return;
    const deletionStart = deletionStartResult.value;
    index = deletionStartResult.endIndex;
    let deletionCount = 1;
    if (line[index] === ",") {
      const deletionCountResult = readPositiveInteger(line, index + 1);
      if (deletionCountResult == null) return;
      deletionCount = deletionCountResult.value;
      index = deletionCountResult.endIndex;
    }
    if (line[index] !== " " || line[index + 1] !== "+") return;
    index += 2;
    const additionStartResult = readPositiveInteger(line, index);
    if (additionStartResult == null) return;
    const additionStart = additionStartResult.value;
    index = additionStartResult.endIndex;
    let additionCount = 1;
    if (line[index] === ",") {
      const additionCountResult = readPositiveInteger(line, index + 1);
      if (additionCountResult == null) return;
      additionCount = additionCountResult.value;
      index = additionCountResult.endIndex;
    }
    if (line[index] !== " " || line[index + 1] !== "@" || line[index + 2] !== "@") return;
    let hunkContext;
    const contextStartIndex = index + 3;
    if (line[contextStartIndex] === " ") hunkContext = trimLineEnd(line.slice(contextStartIndex + 1));
    return {
      additionCount,
      additionStart,
      deletionCount,
      deletionStart,
      hunkContext
    };
  }
  function readPositiveInteger(value, startIndex) {
    let index = startIndex;
    let parsedValue = 0;
    for (; index < value.length; index++) {
      const digit = value.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) break;
      parsedValue = parsedValue * 10 + digit;
    }
    if (index === startIndex) return;
    return {
      value: parsedValue,
      endIndex: index
    };
  }
  function trimLineEnd(value) {
    if (value.endsWith("\r\n")) return value.slice(0, -2);
    if (value.endsWith("\n")) return value.slice(0, -1);
    return value;
  }
  function isGitDiffPatch(data) {
    return data.startsWith("diff --git") || data.includes("\ndiff --git");
  }
  function splitAtLinePrefix(contents2, prefix) {
    if (contents2.length === 0) return [""];
    const newlinePrefix = `
${prefix}`;
    const firstBoundaryIndex = contents2.startsWith(prefix) ? 0 : findLinePrefixIndex(contents2, newlinePrefix, 0);
    if (firstBoundaryIndex === -1) return [contents2];
    const parts = [];
    if (firstBoundaryIndex > 0) parts.push(contents2.slice(0, firstBoundaryIndex));
    let startIndex = firstBoundaryIndex;
    for (; ; ) {
      const nextBoundaryIndex = findLinePrefixIndex(contents2, newlinePrefix, startIndex + 1);
      if (nextBoundaryIndex === -1) break;
      parts.push(contents2.slice(startIndex, nextBoundaryIndex));
      startIndex = nextBoundaryIndex;
    }
    parts.push(contents2.slice(startIndex));
    return parts;
  }
  function findLinePrefixIndex(contents2, newlinePrefix, fromIndex) {
    const index = contents2.indexOf(newlinePrefix, fromIndex);
    return index === -1 ? -1 : index + 1;
  }
  function maybeDetachOptionalString(value) {
    return value == null ? value : detachString(value);
  }
  function parseRawLineType(firstChar) {
    return firstChar === " " ? "context" : firstChar === "\\" ? "metadata" : firstChar === "+" ? "addition" : "deletion";
  }
  function getParsedLineContent(rawLine) {
    const processedLine = rawLine.slice(1);
    return detachString(processedLine === "" ? "\n" : processedLine);
  }
  function createContentGroup(type, deletionLineIndex, additionLineIndex) {
    if (type === "change") return {
      type: "change",
      additions: 0,
      deletions: 0,
      additionLineIndex,
      deletionLineIndex
    };
    return {
      type: "context",
      lines: 0,
      additionLineIndex,
      deletionLineIndex
    };
  }

  // prsViewModel.ts
  function prsGate(capabilities, error) {
    if (error !== null) return { kind: "error", detail: error };
    if (capabilities === null) return { kind: "loading" };
    if (capabilities.hosted && capabilities.reason === null) {
      return {
        kind: "ready",
        providers: capabilities.providers,
        operations: capabilities.operations
      };
    }
    return {
      kind: "unavailable",
      reason: capabilities.reason ?? "provider-unsupported",
      detail: capabilities.detail,
      providers: capabilities.providers
    };
  }
  function prsUnavailableLabel(reason) {
    switch (reason) {
      case "cli-missing":
        return "No host CLI found for this project's pull-request provider";
      case "cli-unauthenticated":
        return "The host CLI is not authenticated";
      case "provider-unsupported":
        return "No pull-request provider for this project's repository";
    }
  }
  function prsProviderLabel(provider) {
    const state2 = provider.configured ? "configured" : "not configured";
    const detail = provider.detail !== null ? ` \u2014 ${provider.detail}` : "";
    return `${provider.host} \xB7 ${provider.kind} \xB7 ${state2}${detail}`;
  }
  var PRS_LIST_STATES = [
    { value: "open", label: "Open" },
    { value: "merged", label: "Merged" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" }
  ];
  var PRS_INVOLVEMENTS = [
    { value: "all", label: "All" },
    { value: "reviewing", label: "Reviewing" },
    { value: "authored", label: "Authored" }
  ];
  var PRS_LIST_LIMIT = 50;
  function prsListInput(state2, involvement, query, cursors) {
    const trimmed = query.trim();
    return {
      state: state2,
      involvement,
      limit: PRS_LIST_LIMIT,
      ...trimmed.length > 0 ? { query: trimmed.slice(0, 200) } : {},
      ...cursors !== void 0 && Object.keys(cursors).length > 0 ? { cursors } : {}
    };
  }
  function prsRefKey(ref) {
    return `${ref.host ?? ""}
${ref.repository}
${ref.number}`;
  }
  function mergePrsEntries(existing, page) {
    const next = [...existing];
    const index = new Map(next.map((entry, i) => [prsRefKey(entry), i]));
    for (const entry of page) {
      const at = index.get(prsRefKey(entry));
      if (at === void 0) {
        index.set(prsRefKey(entry), next.length);
        next.push(entry);
      } else {
        next[at] = entry;
      }
    }
    return next;
  }
  function prsListHasMore(result) {
    return result !== null && Object.keys(result.nextCursors).length > 0;
  }
  function prsReviewLabel(decision2) {
    switch (decision2) {
      case "approved":
        return "Approved";
      case "changes-requested":
        return "Changes requested";
      case "review-required":
        return "Review required";
      default:
        return null;
    }
  }
  function prsChecksLabel(state2) {
    switch (state2) {
      case "passing":
        return "Checks passing";
      case "failing":
        return "Checks failing";
      case "pending":
        return "Checks pending";
      default:
        return null;
    }
  }
  function prsStackLabel(stack) {
    if (stack === void 0) return null;
    return `Stack ${stack.position}/${stack.size} \xB7 ${stack.base}`;
  }
  function prsActorLabel(actor) {
    return actor?.name ?? actor?.login ?? "unknown";
  }
  function prsAuthoredByViewer(entry, viewers) {
    const viewer = viewers[entry.host];
    return viewer !== void 0 && entry.author?.login === viewer;
  }
  function formatRelativeTime(iso, now = Date.now()) {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return iso;
    const delta = now - at;
    if (delta < 45e3) return "just now";
    if (delta < 0) return new Date(at).toLocaleDateString();
    const minutes = Math.floor(delta / 6e4);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(at).toLocaleDateString();
  }
  function prsRowMeta(entry, now) {
    const parts = [
      `${entry.repository}#${entry.number}`,
      entry.author !== null ? prsActorLabel(entry.author) : null,
      entry.additions + entry.deletions > 0 ? `+${entry.additions} \u2212${entry.deletions}` : null,
      formatRelativeTime(entry.updatedAt, now)
    ];
    return parts.filter((part) => part !== null).join(" \xB7 ");
  }
  function prsMergeabilityLabel(mergeability) {
    switch (mergeability) {
      case "mergeable":
        return "Mergeable";
      case "conflicting":
        return "Has conflicts";
      default:
        return "Mergeability unknown";
    }
  }
  function prsCheckStatusLabel(status) {
    switch (status) {
      case "success":
        return "passing";
      case "failure":
        return "failing";
      case "pending":
        return "pending";
      case "action-required":
        return "action required";
      case "skipped":
        return "skipped";
      case "neutral":
        return "neutral";
      case "cancelled":
        return "cancelled";
    }
  }
  function prsChecksSummary(checks) {
    if (checks.length === 0) return null;
    const counts = /* @__PURE__ */ new Map();
    for (const check of checks) {
      const label = prsCheckStatusLabel(check.status);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => `${count} ${label}`).join(" \xB7 ");
  }
  function prsThreadAnchor(thread) {
    const line = thread.line !== null ? `:${thread.line}` : "";
    const side = thread.side === "left" ? " (removed side)" : "";
    return `${thread.path}${line}${side}`;
  }
  function prsThreadStateLabel(thread) {
    if (thread.isResolved) return "Resolved";
    if (thread.isOutdated) return "Outdated";
    return "Open";
  }
  function prsThreadMoreLabel(thread) {
    if (thread.nextCommentsCursor === void 0) return null;
    const rest = thread.commentCount !== void 0 && thread.commentCount > thread.comments.length ? `${thread.commentCount - thread.comments.length} more comment${thread.commentCount - thread.comments.length === 1 ? "" : "s"}` : "more comments";
    return `Show ${rest}`;
  }
  function prsReviewVerdictLabel(state2) {
    if (state2 === null) return null;
    const normalized = state2.toLowerCase().replace(/_/g, " ");
    switch (normalized) {
      case "approved":
        return "approved";
      case "changes requested":
        return "requested changes";
      case "commented":
        return "reviewed";
      case "dismissed":
        return "dismissed a review";
      default:
        return normalized;
    }
  }
  function prsRefreshClosedLabel(reason) {
    return reason === "overflow" ? "Refresh stream overflowed \u2014 updates may be delayed" : "Refresh stream failed on the host";
  }
  function createPrsDiffAssembly() {
    return { manifest: null, chunks: [], complete: null };
  }
  function applyPrsDiffStreamEvent(assembly, event) {
    if (assembly.complete !== null) {
      return { ok: false, detail: "stream continued after the complete frame" };
    }
    if (event.kind === "manifest") {
      if (assembly.manifest !== null) return { ok: false, detail: "duplicate manifest frame" };
      return { ok: true, assembly: { manifest: event, chunks: [], complete: null } };
    }
    if (assembly.manifest === null) {
      return { ok: false, detail: `${event.kind} frame arrived before the manifest` };
    }
    if (event.kind === "chunk") {
      if (event.chunkIndex >= assembly.manifest.chunkCount) {
        return {
          ok: false,
          detail: `chunkIndex ${event.chunkIndex} exceeds declared chunkCount ${assembly.manifest.chunkCount}`
        };
      }
      if (event.chunkIndex !== assembly.chunks.length) {
        return {
          ok: false,
          detail: `out-of-order chunk ${event.chunkIndex} (expected ${assembly.chunks.length})`
        };
      }
      return { ok: true, assembly: { ...assembly, chunks: [...assembly.chunks, event.data] } };
    }
    return { ok: true, assembly: { ...assembly, complete: event.payloadSha256 } };
  }
  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }
  async function verifyPrsDiffAssembly(assembly) {
    if (assembly.manifest === null) {
      return { kind: "incomplete", detail: "stream ended before the manifest" };
    }
    if (assembly.complete === null) {
      return { kind: "incomplete", detail: "stream ended before the complete frame" };
    }
    const manifest = assembly.manifest;
    if (assembly.chunks.length !== manifest.chunkCount) {
      return {
        kind: "incomplete",
        detail: `received ${assembly.chunks.length} of ${manifest.chunkCount} declared chunks`
      };
    }
    const patch = assembly.chunks.join("");
    if (utf8Length(patch) !== manifest.diffByteLength) {
      return {
        kind: "mismatch",
        detail: "reassembled byte length does not match the manifest"
      };
    }
    const hash = await sha256Hex(patch);
    if (hash !== manifest.diffHash) {
      return { kind: "mismatch", detail: "reassembled bytes do not match the manifest hash" };
    }
    if (hash !== assembly.complete) {
      return {
        kind: "mismatch",
        detail: "reassembled payload does not match the terminal checksum"
      };
    }
    return { kind: "verified", manifest, patch };
  }
  async function collectPrsDiffStream(stream, signal) {
    let assembly = createPrsDiffAssembly();
    for await (const frame of stream) {
      if (signal.aborted) return { kind: "cancelled" };
      const next = applyPrsDiffStreamEvent(assembly, frame.value);
      if (!next.ok) return { kind: "protocol", detail: next.detail };
      assembly = next.assembly;
    }
    if (signal.aborted) return { kind: "cancelled" };
    return verifyPrsDiffAssembly(assembly);
  }
  function mergePrsDiffSegment(delivery, manifest, patch) {
    const omitted = manifest.omittedFileStats ?? [];
    return {
      patch: (delivery?.patch ?? "") + patch,
      diffHashes: [...delivery?.diffHashes ?? [], manifest.diffHash],
      truncated: manifest.truncated,
      nextCursor: manifest.nextCursor,
      omittedFileStats: [...delivery?.omittedFileStats ?? [], ...omitted],
      byteLength: (delivery?.byteLength ?? 0) + manifest.diffByteLength
    };
  }
  function prsOmittedFilesLabel(stats) {
    const files = stats.length;
    if (files === 0) return "";
    const additions = stats.reduce((n, s) => n + s.additions, 0);
    const deletions = stats.reduce((n, s) => n + s.deletions, 0);
    return `${files} file${files === 1 ? "" : "s"} omitted from the delivered diff (+${additions} \u2212${deletions})`;
  }
  function resolveDiffPath(raw) {
    if (raw.startsWith("a/") || raw.startsWith("b/")) return raw.slice(2);
    return raw;
  }
  var DIFF_GIT_BOUNDARY = /^diff --git /gm;
  var BINARY_FILES_MARKER = /^Binary files .+ differ$/m;
  var GIT_BINARY_MARKER = /^GIT binary patch$/m;
  var BINARY_B_PATH = /^Binary files .+ and b\/(.+) differ$/m;
  var HEADER_B_PATH_QUOTED = /^diff --git "a\/(?:.*)" "b\/(.*)"$/;
  var HEADER_B_PATH = /^diff --git a\/.* b\/(.*)$/;
  function binaryPathsFromPatch(diff) {
    const paths = /* @__PURE__ */ new Set();
    const boundaries = [...diff.matchAll(DIFF_GIT_BOUNDARY)].map((match) => match.index);
    for (let index = 0; index < boundaries.length; index += 1) {
      const start = boundaries[index];
      const end = index + 1 < boundaries.length ? boundaries[index + 1] : diff.length;
      const section = diff.slice(start, end);
      if (BINARY_FILES_MARKER.test(section)) {
        const path3 = BINARY_B_PATH.exec(section)?.[1];
        if (path3 !== void 0) paths.add(path3);
      } else if (GIT_BINARY_MARKER.test(section)) {
        const header = section.split("\n", 1)[0] ?? "";
        const path3 = HEADER_B_PATH_QUOTED.exec(header)?.[1] ?? HEADER_B_PATH.exec(header)?.[1] ?? null;
        if (path3 !== null) paths.add(path3);
      }
    }
    return paths;
  }
  function rowFromFile(file, binaryPaths) {
    const path3 = resolveDiffPath(file.name ?? file.prevName ?? "");
    const prevPath = file.prevName !== void 0 ? resolveDiffPath(file.prevName) : null;
    let additions = 0;
    let deletions = 0;
    for (const hunk of file.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    const binary = binaryPaths.has(path3) || prevPath !== null && binaryPaths.has(prevPath);
    return {
      key: `${prevPath ?? ""}\0${path3}`,
      path: path3,
      prevPath,
      changeType: file.type,
      additions,
      deletions,
      binary,
      textless: file.hunks.length === 0 && !binary,
      file
    };
  }
  function renderableFromPatch(diff) {
    if (diff === null || diff === void 0) return null;
    const normalized = diff.trim();
    if (normalized.length === 0) return null;
    try {
      const files = parsePatchFiles(normalized, patchCacheKey(normalized)).flatMap(
        (patch) => patch.files
      );
      if (files.length > 0) {
        const binaryPaths = binaryPathsFromPatch(normalized);
        return { kind: "files", files: files.map((file) => rowFromFile(file, binaryPaths)) };
      }
      return {
        kind: "raw",
        text: normalized,
        reason: "Unsupported diff format. Showing raw patch."
      };
    } catch {
      return {
        kind: "raw",
        text: normalized,
        reason: "Failed to parse patch. Showing raw patch."
      };
    }
  }
  function patchCacheKey(patch) {
    let hash = 2166136261;
    for (let index = 0; index < patch.length; index += 1) {
      hash ^= patch.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `t3.prs.diff:${patch.length}:${hash.toString(36)}`;
  }
  function lineText(lines, index) {
    return (lines[index] ?? "").replace(/\r?\n$/, "");
  }
  function fileRows(row) {
    const file = row.file;
    if (file.hunks.length === 0) return [];
    const additionLines = file.additionLines;
    const deletionLines = file.deletionLines;
    const rows = [];
    for (const hunk of file.hunks) {
      if (hunk.collapsedBefore > 0) {
        rows.push({ ordinal: rows.length, kind: "gap", count: hunk.collapsedBefore });
      }
      let additionIndex = hunk.additionLineIndex;
      let deletionIndex = hunk.deletionLineIndex;
      let newLine = hunk.additionStart;
      let oldLine = hunk.deletionStart;
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let offset = 0; offset < content.lines; offset += 1) {
            rows.push({
              ordinal: rows.length,
              kind: "context",
              text: lineText(additionLines, additionIndex + offset),
              oldLine: oldLine + offset,
              newLine: newLine + offset
            });
          }
          additionIndex += content.lines;
          deletionIndex += content.lines;
          oldLine += content.lines;
          newLine += content.lines;
        } else {
          for (let offset = 0; offset < content.deletions; offset += 1) {
            rows.push({
              ordinal: rows.length,
              kind: "deletion",
              text: lineText(deletionLines, deletionIndex + offset),
              oldLine: oldLine + offset
            });
          }
          deletionIndex += content.deletions;
          oldLine += content.deletions;
          for (let offset = 0; offset < content.additions; offset += 1) {
            rows.push({
              ordinal: rows.length,
              kind: "addition",
              text: lineText(additionLines, additionIndex + offset),
              newLine: newLine + offset
            });
          }
          additionIndex += content.additions;
          newLine += content.additions;
        }
      }
    }
    return rows;
  }
  function changeTypeLabel(changeType) {
    switch (changeType) {
      case "new":
        return "added";
      case "deleted":
        return "deleted";
      case "rename-pure":
        return "renamed";
      case "rename-changed":
        return "renamed, modified";
      case "change":
        return "modified";
    }
  }
  function displayPath(row) {
    return row.prevPath !== null ? `${row.prevPath} \u2192 ${row.path}` : row.path;
  }
  function fileStatLabel(row) {
    if (row.binary || row.textless) return "";
    return `+${row.additions} \u2212${row.deletions}`;
  }
  var PRS_MUTATIONS_DEFERRED = "Pull-request mutations are not part of this contract \u2014 merge and update actions, comments, reviews, thread resolution, reactions, reviewers, and labels are deferred to a later control contract.";

  // prsPanel.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var muted = "var(--muted-foreground, #667085)";
  var control = {
    padding: "4px 8px",
    border: "1px solid var(--border, #dfe3e8)",
    borderRadius: 5,
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer"
  };
  var iconButton = { ...control, padding: "2px 6px", fontSize: 11 };
  var inputStyle = {
    flex: 1,
    minWidth: 0,
    font: "inherit",
    fontSize: 12,
    padding: "3px 6px",
    border: "1px solid var(--border, #dfe3e8)",
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  var noteStyle = {
    margin: 0,
    padding: "4px 10px",
    color: muted,
    fontSize: 12
  };
  var headingStyle = {
    margin: 0,
    padding: "2px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: muted,
    textTransform: "uppercase",
    letterSpacing: 0.4
  };
  var mergeThreadComments = (head, tail) => {
    const seen = new Set(head.map((comment) => comment.id));
    const merged = [...head];
    for (const comment of tail) if (!seen.has(comment.id)) merged.push(comment);
    return merged;
  };
  var message = (error, fallback) => error instanceof Error ? error.message : fallback;
  function usePrsCapabilities(host, session, visible, tick) {
    const [result, setResult] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(prsReadApi, host, session.context).invoke("getCapabilities", {}, signal).then(
        (capabilities) => {
          if (!signal.aborted) setResult({ key: tick, capabilities, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: tick,
              capabilities: null,
              error: message(error, "Pull-request capabilities unavailable")
            });
        }
      );
      return () => controller.abort();
    }, [host, session, visible, tick]);
    return result?.key === tick ? result : { capabilities: null, error: null };
  }
  function usePrsRefreshes(host, session, enabled) {
    const [state2, setState] = (0, import_react.useState)({
      tick: 0,
      live: false,
      detail: null
    });
    (0, import_react.useEffect)(() => {
      if (!enabled) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
          let closed = null;
          try {
            const stream = bindStreamApi(prsReadApi, host, session.context).subscribe(
              "subscribeRefreshes",
              {},
              signal
            );
            for await (const frame of stream) {
              if (signal.aborted) return;
              const event = frame.value;
              if (event.kind === "refreshed") {
                setState((prev) => ({ tick: prev.tick + 1, live: true, detail: null }));
              } else {
                closed = prsRefreshClosedLabel(event.reason);
                break;
              }
            }
          } catch (error) {
            if (!signal.aborted)
              setState((prev) => ({
                ...prev,
                live: false,
                detail: message(error, "Refresh stream unavailable")
              }));
            return;
          }
          if (signal.aborted) return;
          if (closed === null) {
            setState((prev) => ({
              ...prev,
              live: false,
              detail: "Refresh stream ended unexpectedly."
            }));
            return;
          }
          setState((prev) => ({ ...prev, live: false, detail: closed }));
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
        if (!signal.aborted)
          setState((prev) => ({
            ...prev,
            live: false,
            detail: "Refresh stream ended repeatedly."
          }));
      })();
      return () => controller.abort();
    }, [host, session, enabled]);
    return state2;
  }
  function usePrsList(host, session, enabled, input, revision2) {
    const inputKey = (0, import_react.useMemo)(() => JSON.stringify(input), [input]);
    const key = `${revision2}|${inputKey}`;
    const [state2, setState] = (0, import_react.useState)(null);
    const continuation = (0, import_react.useRef)(null);
    (0, import_react.useEffect)(() => {
      if (!enabled) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(prsReadApi, host, session.context).invoke("list", input, signal).then(
        (result) => {
          if (!signal.aborted)
            setState(() => ({
              key,
              inputKey,
              // A re-read answers the same question — a row that left the
              // fresh page (a closed PR under the open filter, a renamed
              // search hit) must leave the list rather than linger stale.
              // Continuation pages merge on their own path in loadMore.
              entries: result.entries,
              result,
              error: null,
              pending: false,
              loadingMore: false
            }));
        },
        (error) => {
          if (!signal.aborted)
            setState((prev) => ({
              key,
              inputKey,
              entries: prev?.inputKey === inputKey ? prev.entries : [],
              result: prev?.inputKey === inputKey ? prev.result : null,
              error: message(error, "Pull requests unavailable"),
              pending: false,
              loadingMore: false
            }));
        }
      );
      return () => {
        controller.abort();
        continuation.current?.abort();
        continuation.current = null;
      };
    }, [host, session, enabled, key, inputKey, input]);
    const loadMore = () => {
      if (state2 === null || state2.key !== key || state2.result === null || !prsListHasMore(state2.result))
        return;
      const cursors = state2.result.nextCursors;
      setState((prev) => prev === null || prev.key !== key ? prev : { ...prev, loadingMore: true });
      continuation.current?.abort();
      const controller = new AbortController();
      continuation.current = controller;
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(prsReadApi, host, session.context).invoke("list", { ...input, cursors }, signal).then(
        (page) => {
          if (!signal.aborted)
            setState(
              (prev) => prev === null || prev.key !== key ? prev : {
                ...prev,
                entries: mergePrsEntries(prev.entries, page.entries),
                result: page,
                loadingMore: false
              }
            );
        },
        (error) => {
          if (!signal.aborted)
            setState(
              (prev) => prev === null || prev.key !== key ? prev : { ...prev, error: message(error, "Next page unavailable"), loadingMore: false }
            );
        }
      ).finally(() => {
        if (continuation.current === controller) continuation.current = null;
        controller.abort();
      });
    };
    const sameQuestion = state2 !== null && state2.inputKey === inputKey;
    return {
      entries: sameQuestion ? state2.entries : [],
      result: sameQuestion ? state2.result : null,
      error: state2?.key === key ? state2.error : null,
      pending: state2?.key !== key || state2.pending,
      loadingMore: state2?.key === key ? state2.loadingMore : false,
      loadMore
    };
  }
  var EMPTY_SECTIONS = {
    detail: null,
    detailError: null,
    activity: null,
    activityError: null,
    linked: null,
    linkedError: null,
    stack: null,
    stackError: null
  };
  function usePrsDetail(host, session, ref, operations, revision2) {
    const refKey = ref === null ? null : prsRefKey(ref);
    const key = refKey === null ? null : `${revision2}|${refKey}`;
    const [sections, setSections] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      if (ref === null || refKey === null || key === null || operations === null) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const api = bindApi(prsReadApi, host, session.context);
      const read = (field, errorField, supported, run) => {
        if (!supported) return;
        void run().then(
          (value) => {
            if (!signal.aborted)
              setSections((prev) => ({
                ...prev?.refKey === refKey ? prev : { ...EMPTY_SECTIONS },
                key,
                refKey,
                [field]: value,
                [errorField]: null
              }));
          },
          (error) => {
            if (!signal.aborted)
              setSections((prev) => ({
                ...prev?.refKey === refKey ? prev : { ...EMPTY_SECTIONS },
                key,
                refKey,
                [errorField]: message(error, `${field} unavailable`)
              }));
          }
        );
      };
      read(
        "detail",
        "detailError",
        operations["prs.detail"],
        () => api.invoke("detail", ref, signal)
      );
      read(
        "activity",
        "activityError",
        operations["prs.activity"],
        () => api.invoke("activity", ref, signal)
      );
      read(
        "linked",
        "linkedError",
        operations["prs.linkedThreads"],
        () => api.invoke("linkedThreads", ref, signal)
      );
      read("stack", "stackError", operations["prs.stack"], () => api.invoke("stack", ref, signal));
      return () => controller.abort();
    }, [host, session, ref, refKey, operations, key]);
    return sections?.refKey === refKey && refKey !== null ? sections : { key: key ?? "", refKey: refKey ?? "", ...EMPTY_SECTIONS };
  }
  function prsDiffFailure(detail) {
    switch (detail.kind) {
      case "protocol":
        return `Diff stream protocol error: ${detail.detail ?? "unknown"}`;
      case "incomplete":
        return `Diff stream ended before completing \u2014 ${detail.detail ?? "unknown"}. Refresh to retry.`;
      case "mismatch":
        return `Diff verification failed: ${detail.detail ?? "unknown"}. Nothing is shown.`;
      default:
        return "Diff stream unavailable";
    }
  }
  function usePrsDiff(host, session, ref, enabled, revision2) {
    const refKey = ref === null ? null : prsRefKey(ref);
    const key = refKey === null ? null : `${revision2}|${refKey}`;
    const [state2, setState] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      if (!enabled || ref === null || key === null) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void collectPrsDiffStream(
        bindStreamApi(prsReadApi, host, session.context).subscribe("streamDiff", ref, signal),
        signal
      ).then(
        (outcome) => {
          if (signal.aborted || outcome.kind === "cancelled") return;
          setState(
            outcome.kind === "verified" ? {
              key,
              value: {
                status: "ready",
                delivery: mergePrsDiffSegment(null, outcome.manifest, outcome.patch),
                loadingMore: false
              }
            } : { key, value: { status: "error", detail: prsDiffFailure(outcome) } }
          );
        },
        (error) => {
          if (!signal.aborted)
            setState({
              key,
              value: { status: "error", detail: message(error, "Diff stream unavailable") }
            });
        }
      );
      return () => controller.abort();
    }, [host, session, ref, enabled, key]);
    const loadMore = () => {
      if (ref === null || state2 === null || state2.key !== key || state2.value.status !== "ready")
        return;
      const cursor = state2.value.delivery.nextCursor;
      if (cursor === null) return;
      setState({ key: state2.key, value: { ...state2.value, loadingMore: true } });
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void collectPrsDiffStream(
        bindStreamApi(prsReadApi, host, session.context).subscribe(
          "streamDiff",
          { ...ref, cursor },
          signal
        ),
        signal
      ).then(
        (outcome) => {
          if (signal.aborted || outcome.kind === "cancelled") return;
          setState((prev) => {
            if (prev === null || prev.key !== key || prev.value.status !== "ready") return prev;
            if (outcome.kind !== "verified")
              return {
                key: prev.key,
                value: { status: "error", detail: prsDiffFailure(outcome) }
              };
            return {
              key: prev.key,
              value: {
                status: "ready",
                delivery: mergePrsDiffSegment(prev.value.delivery, outcome.manifest, outcome.patch),
                loadingMore: false
              }
            };
          });
        },
        (error) => {
          if (!signal.aborted)
            setState(
              (prev) => prev === null || prev.key !== key ? prev : {
                key: prev.key,
                value: { status: "error", detail: message(error, "Diff stream unavailable") }
              }
            );
        }
      ).finally(() => controller.abort());
    };
    const value = state2?.key === key ? state2.value : { status: "loading" };
    return { diff: value, loadMore };
  }
  function useDebounced(value, delay) {
    const [debounced, setDebounced] = (0, import_react.useState)(value);
    (0, import_react.useEffect)(() => {
      const timer = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
  }
  function badge(text, tone) {
    const colors = {
      open: "var(--success, #2da44e)",
      closed: "var(--muted-foreground, #667085)",
      merged: "var(--info, #8250df)",
      muted: "var(--muted-foreground, #667085)"
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "span",
      {
        style: {
          flexShrink: 0,
          fontSize: 10,
          padding: "0 5px",
          borderRadius: 8,
          border: `1px solid ${colors[tone]}`,
          color: colors[tone]
        },
        children: text
      }
    );
  }
  function stateBadge(entry) {
    if (entry.state === "open" && entry.isDraft) return badge("Draft", "muted");
    if (entry.state === "open") return badge("Open", "open");
    if (entry.state === "merged") return badge("Merged", "merged");
    return badge("Closed", "closed");
  }
  function PrListRow(props) {
    const { entry, viewers, onSelect } = props;
    const review = prsReviewLabel(entry.reviewDecision);
    const checks = prsChecksLabel(entry.checksState);
    const stack = prsStackLabel(entry.stack);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        onClick: onSelect,
        style: {
          display: "block",
          width: "100%",
          textAlign: "left",
          font: "inherit",
          fontSize: 12,
          padding: "5px 8px",
          border: "1px solid transparent",
          borderRadius: 5,
          cursor: "pointer",
          color: "var(--foreground, #20252d)",
          background: "transparent"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
            stateBadge(entry),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "span",
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                children: entry.title
              }
            ),
            entry.viewerReviewRequested && badge("Review requested", "open")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "span",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                marginTop: 2,
                fontSize: 11,
                color: muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "span",
                  {
                    style: {
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    },
                    children: [
                      prsRowMeta(entry),
                      prsAuthoredByViewer(entry, viewers) ? " \xB7 you" : ""
                    ]
                  }
                ),
                review !== null && badge(review, review === "Approved" ? "open" : "closed"),
                checks !== null && badge(
                  checks,
                  entry.checksState === "passing" ? "open" : entry.checksState === "failing" ? "closed" : "muted"
                ),
                stack !== null && badge(stack, "merged")
              ]
            }
          ),
          entry.labels.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              style: {
                display: "flex",
                gap: 4,
                marginTop: 3,
                flexWrap: "wrap"
              },
              children: entry.labels.map((label) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "span",
                {
                  style: {
                    fontSize: 10,
                    padding: "0 5px",
                    borderRadius: 8,
                    border: "1px solid var(--border, #dfe3e8)",
                    color: muted
                  },
                  children: label.name
                },
                label.name
              ))
            }
          )
        ]
      }
    ) });
  }
  function metaRow(label, value) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, padding: "1px 0", fontSize: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: 110, flexShrink: 0, color: muted }, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { minWidth: 0, overflowWrap: "anywhere" }, children: value })
    ] });
  }
  function CheckRow({ check }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "li",
      {
        style: {
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          padding: "2px 10px",
          fontSize: 12
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              style: {
                color: check.status === "success" ? "var(--success, #2da44e)" : check.status === "failure" || check.status === "action-required" ? "var(--destructive, #b42318)" : muted,
                flexShrink: 0
              },
              children: prsCheckStatusLabel(check.status)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" }, children: check.name }),
          check.description !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              style: {
                color: muted,
                fontSize: 11,
                flexShrink: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: check.description
            }
          )
        ]
      }
    );
  }
  function CommentRow({ comment }) {
    const verdict = prsReviewVerdictLabel(comment.reviewState);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "li",
      {
        style: { padding: "4px 10px", fontSize: 12, borderTop: "1px solid var(--border, #f0f2f5)" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { color: muted, fontSize: 11 }, children: [
            prsActorLabel(comment.author),
            verdict !== null ? ` ${verdict}` : comment.kind === "review" ? " reviewed" : " commented",
            comment.path !== null ? ` on ${comment.path}` : "",
            " \xB7",
            " ",
            formatRelativeTime(comment.createdAt),
            comment.url !== null ? ` \u2014 ${comment.url}` : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 2 }, children: comment.body }),
          comment.reactions !== void 0 && comment.reactions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: muted, fontSize: 11, marginTop: 2 }, children: comment.reactions.map((r) => `${r.content} \xD7${r.count}`).join(" \xB7 ") })
        ]
      }
    );
  }
  function ReviewThreadSection(props) {
    const { thread, canPage, onLoadMore, paging, unrecoverable, pageError } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "section",
      {
        "aria-label": `Thread on ${prsThreadAnchor(thread)}`,
        style: { borderTop: "1px solid var(--border, #f0f2f5)", paddingBottom: 4 },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { style: { ...headingStyle, padding: "4px 10px 2px", textTransform: "none" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" }, children: prsThreadAnchor(thread) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontWeight: 400 }, children: [
              " \u2014 ",
              prsThreadStateLabel(thread)
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: thread.comments.map((comment) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { padding: "3px 10px", fontSize: 12 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { color: muted, fontSize: 11 }, children: [
              prsActorLabel(comment.author),
              " \xB7 ",
              formatRelativeTime(comment.createdAt),
              comment.url !== null ? ` \u2014 ${comment.url}` : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 1 }, children: comment.body }),
            comment.reactions !== void 0 && comment.reactions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: muted, fontSize: 11, marginTop: 1 }, children: comment.reactions.map((r) => `${r.content} \xD7${r.count}`).join(" \xB7 ") })
          ] }, comment.id)) }),
          canPage && prsThreadMoreLabel(thread) !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              disabled: paging,
              onClick: () => onLoadMore(thread),
              style: { ...iconButton, margin: "2px 10px" },
              children: paging ? "Loading\u2026" : prsThreadMoreLabel(thread)
            }
          ),
          canPage === false && thread.nextCommentsCursor !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: "More comments exist; paging is not supported by this host." }),
          pageError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: { ...noteStyle, fontSize: 11 }, children: [
            pageError,
            " \u2014 retry with the button above."
          ] }),
          unrecoverable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Some comments could not be shown \u2014 the host cut this thread's tail without a cursor." })
        ]
      }
    );
  }
  var diffRowBase = {
    display: "flex",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11,
    lineHeight: "18px",
    whiteSpace: "pre"
  };
  var gutter = {
    width: 40,
    flexShrink: 0,
    textAlign: "right",
    paddingRight: 8,
    color: muted,
    userSelect: "none"
  };
  function PrsDiffRow({ row }) {
    if (row.kind === "gap") {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          style: {
            ...diffRowBase,
            justifyContent: "center",
            color: muted,
            background: "var(--muted, #f4f5f7)",
            fontStyle: "italic"
          },
          children: [
            row.count,
            " unmodified line",
            row.count === 1 ? "" : "s"
          ]
        }
      );
    }
    const addition = row.kind === "addition";
    const deletion = row.kind === "deletion";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        style: {
          ...diffRowBase,
          background: addition ? "color-mix(in srgb, var(--success, #2da44e) 14%, transparent)" : deletion ? "color-mix(in srgb, var(--destructive, #cf222e) 12%, transparent)" : "transparent"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: gutter, children: deletion || row.kind === "context" ? row.oldLine : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: gutter, children: addition || row.kind === "context" ? row.newLine : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, userSelect: "none", width: 14 }, children: addition ? "+" : deletion ? "\u2212" : " " }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.text })
        ]
      }
    );
  }
  function PrsFileSection({ row }) {
    const [collapsed, setCollapsed] = (0, import_react.useState)(false);
    const rows = (0, import_react.useMemo)(
      () => collapsed || row.binary || row.textless ? [] : fileRows(row),
      [collapsed, row]
    );
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "section",
      {
        "aria-label": displayPath(row),
        style: { borderTop: "1px solid var(--border, #f0f2f5)" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                fontSize: 12
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-expanded": !collapsed,
                    "aria-label": `${collapsed ? "Expand" : "Collapse"} ${displayPath(row)}`,
                    onClick: () => setCollapsed((value) => !value),
                    style: { ...iconButton, width: 20, textAlign: "center" },
                    children: collapsed ? "\u25B8" : "\u25BE"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "span",
                  {
                    style: {
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1
                    },
                    children: [
                      displayPath(row),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted }, children: [
                        " ",
                        "\u2014 ",
                        row.binary ? "binary" : changeTypeLabel(row.changeType),
                        fileStatLabel(row) !== "" ? ` ${fileStatLabel(row)}` : ""
                      ] })
                    ]
                  }
                )
              ]
            }
          ),
          !collapsed && row.binary && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: noteStyle, children: [
            row.path,
            " is a binary file \u2014 no text diff is available."
          ] }),
          !collapsed && row.textless && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: noteStyle, children: [
            "No textual changes in the patch for ",
            displayPath(row),
            "."
          ] }),
          !collapsed && rows.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PrsDiffRow, { row: line }, line.ordinal))
        ]
      }
    );
  }
  function PrsDiffSection(props) {
    const { diff, supported, onLoadMore } = props;
    if (!supported) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: noteStyle, children: "Diff streaming is not supported by this host (prs.streamDiff)." });
    }
    if (diff.status === "loading") {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: noteStyle, children: "Streaming the verified diff\u2026" });
    }
    if (diff.status === "error") {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: noteStyle, children: diff.detail });
    }
    const { delivery } = diff;
    const renderable = renderableFromPatch(delivery.patch);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { ...noteStyle, fontSize: 11 }, children: [
        delivery.diffHashes[0] !== void 0 ? `sha256 ${delivery.diffHashes[0].slice(0, 12)} \xB7 ${delivery.byteLength} bytes` : "empty diff",
        delivery.diffHashes.length > 1 ? ` \xB7 ${delivery.diffHashes.length} verified segments` : "",
        delivery.truncated ? " \xB7 truncated by the host" : ""
      ] }),
      renderable === null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: noteStyle, children: "The delivered diff is empty." }),
      renderable !== null && renderable.kind === "raw" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: noteStyle, children: renderable.reason }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "pre",
          {
            style: {
              margin: 0,
              padding: "4px 10px",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere"
            },
            children: renderable.text
          }
        )
      ] }),
      renderable !== null && renderable.kind === "files" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: renderable.files.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PrsFileSection, { row }, row.key)) }),
      delivery.omittedFileStats.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: prsOmittedFilesLabel(delivery.omittedFileStats) }),
      delivery.nextCursor !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          disabled: diff.loadingMore,
          onClick: onLoadMore,
          style: { ...iconButton, margin: "4px 10px" },
          children: diff.loadingMore ? "Loading\u2026" : "Load remaining diff"
        }
      )
    ] });
  }
  function PullRequestsPanel(props) {
    const { host, session, visible, selected, onSelect } = props;
    const [tick, setTick] = (0, import_react.useState)(0);
    const [listState, setListState] = (0, import_react.useState)("open");
    const [involvement, setInvolvement] = (0, import_react.useState)("all");
    const [query, setQuery] = (0, import_react.useState)("");
    const [refreshError, setRefreshError] = (0, import_react.useState)(null);
    const [pagingThreads, setPagingThreads] = (0, import_react.useState)(/* @__PURE__ */ new Set());
    const [pagedThreads, setPagedThreads] = (0, import_react.useState)(null);
    const pagedGeneration = (0, import_react.useRef)({
      scope: null,
      activity: null,
      generation: 0
    });
    const { capabilities, error: capsError } = usePrsCapabilities(host, session, visible, tick);
    const gate = prsGate(capabilities, capsError);
    const ready = gate.kind === "ready";
    const ops = ready ? gate.operations : null;
    const refreshes = usePrsRefreshes(
      host,
      session,
      visible && ready && ops?.["prs.subscribeRefreshes"] === true
    );
    const revision2 = `${tick}:${refreshes.tick}`;
    const debouncedQuery = useDebounced(query, 250);
    const listInput = (0, import_react.useMemo)(
      () => prsListInput(listState, involvement, debouncedQuery),
      [listState, involvement, debouncedQuery]
    );
    const list = usePrsList(
      host,
      session,
      visible && ready && ops?.["prs.list"] === true,
      listInput,
      revision2
    );
    const sections = usePrsDetail(host, session, selected, ops, revision2);
    const { diff, loadMore } = usePrsDiff(
      host,
      session,
      selected,
      visible && ready && selected !== null && ops?.["prs.streamDiff"] === true,
      revision2
    );
    const runInvalidate = () => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const api = bindApi(prsReadApi, host, session.context);
      const invalidations = [api.invoke("invalidate", {}, signal)];
      if (selected !== null)
        invalidations.push(api.invoke("invalidate", { reference: selected }, signal));
      void Promise.all(invalidations).then(
        () => {
          if (signal.aborted) return;
          setRefreshError(null);
          setTick((value) => value + 1);
        },
        (error) => {
          if (!signal.aborted) setRefreshError(message(error, "Pull-request refresh unavailable"));
        }
      ).finally(() => controller.abort());
    };
    const selectedKey = selected === null ? null : prsRefKey(selected);
    const pagedScope = selectedKey === null ? null : `${revision2}
${selectedKey}`;
    (0, import_react.useEffect)(() => {
      const current = pagedGeneration.current;
      if (current.scope !== pagedScope || current.activity !== sections.activity)
        pagedGeneration.current = {
          scope: pagedScope,
          activity: sections.activity,
          generation: current.generation + 1
        };
    }, [pagedScope, sections.activity]);
    const loadThreadComments = (thread) => {
      if (selected === null || pagedScope === null || sections.activity === null || thread.nextCommentsCursor === void 0)
        return;
      const cursor = thread.nextCommentsCursor;
      const scope = pagedScope;
      const head = sections.activity;
      const generation = pagedGeneration.current.generation;
      const pendingKey = `${scope}
${thread.id}`;
      if (pagingThreads.has(pendingKey)) return;
      setPagingThreads((prev) => new Set(prev).add(pendingKey));
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(prsReadApi, host, session.context).invoke("threadComments", { ...selected, threadId: thread.id, cursor }, signal).then(
        (page) => {
          if (signal.aborted || generation !== pagedGeneration.current.generation) return;
          setPagedThreads((prev) => {
            if (prev !== null && prev.scope === scope && prev.activity !== head) return prev;
            const map = new Map(prev?.scope === scope ? prev.map : void 0);
            const prior = map.get(thread.id);
            map.set(thread.id, {
              comments: mergeThreadComments(prior?.comments ?? [], page.comments),
              nextCursor: page.nextCursor,
              truncated: page.truncated,
              error: null
            });
            return { scope, activity: head, map };
          });
        },
        (error) => {
          if (signal.aborted || generation !== pagedGeneration.current.generation) return;
          setPagedThreads((prev) => {
            if (prev !== null && prev.scope === scope && prev.activity !== head) return prev;
            const map = new Map(prev?.scope === scope ? prev.map : void 0);
            const prior = map.get(thread.id);
            map.set(thread.id, {
              comments: prior?.comments ?? [],
              nextCursor: prior?.nextCursor ?? thread.nextCommentsCursor ?? null,
              truncated: prior?.truncated ?? false,
              error: message(error, "Comments unavailable")
            });
            return { scope, activity: head, map };
          });
        }
      ).finally(() => {
        setPagingThreads((prev) => {
          if (!prev.has(pendingKey)) return prev;
          const next = new Set(prev);
          next.delete(pendingKey);
          return next;
        });
        controller.abort();
      });
    };
    const detail = sections.detail;
    const activity = sections.activity;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        "aria-label": "Pull requests",
        style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderBottom: "1px solid var(--border, #f0f2f5)",
                flexShrink: 0,
                flexWrap: "wrap"
              },
              children: [
                selected === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { role: "group", "aria-label": "State filter", style: { display: "flex", gap: 2 }, children: PRS_LIST_STATES.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-pressed": listState === option.value,
                      onClick: () => setListState(option.value),
                      style: {
                        ...iconButton,
                        fontWeight: listState === option.value ? 600 : 400,
                        background: listState === option.value ? "var(--accent, #e8eef7)" : "transparent"
                      },
                      children: option.label
                    },
                    option.value
                  )) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "select",
                    {
                      "aria-label": "Involvement",
                      value: involvement,
                      onChange: (event) => setInvolvement(event.target.value),
                      style: { ...control, padding: "2px 4px" },
                      children: PRS_INVOLVEMENTS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option.value, children: option.label }, option.value))
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      "aria-label": "Search pull requests",
                      value: query,
                      onChange: (event) => setQuery(event.target.value),
                      placeholder: "Search",
                      style: { ...inputStyle, maxWidth: 160 }
                    }
                  )
                ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => onSelect(null), style: control, children: "\u2190 Pull requests" }),
                ready && ops?.["prs.invalidate"] === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: runInvalidate, style: control, children: "Refresh" })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: [
            gate.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: noteStyle, children: "Reading pull-request capabilities\u2026" }),
            gate.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: noteStyle, children: [
              "Pull requests unavailable \u2014 ",
              gate.detail
            ] }),
            gate.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: noteStyle, children: [
                prsUnavailableLabel(gate.reason),
                gate.detail !== null ? ` \u2014 ${gate.detail}` : ""
              ] }),
              gate.providers.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: prsProviderLabel(provider) }, provider.host))
            ] }),
            ready && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              refreshError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { ...noteStyle, fontSize: 11 }, children: refreshError }),
              refreshes.detail !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: refreshes.detail }),
              selected === null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                ops !== null && ops["prs.list"] !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: noteStyle, children: "Listing pull requests is not supported by this host (prs.list)." }),
                gate.providers.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: prsProviderLabel(provider) }, provider.host)),
                list.error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: noteStyle, children: list.error }),
                list.result !== null && list.result.errors.map((entryError) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "p",
                  {
                    role: "alert",
                    style: { ...noteStyle, fontSize: 11 },
                    children: [
                      entryError.projectTitle,
                      ": ",
                      entryError.message
                    ]
                  },
                  entryError.projectId
                )),
                list.result !== null && list.result.truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Results truncated by the host \u2014 narrow the search to see more." }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: "2px 4px" }, children: list.entries.map((prEntry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  PrListRow,
                  {
                    entry: prEntry,
                    viewers: list.result?.viewers ?? {},
                    onSelect: () => onSelect({
                      host: prEntry.host,
                      repository: prEntry.repository,
                      number: prEntry.number
                    })
                  },
                  prsRefKey(prEntry)
                )) }),
                !list.pending && list.error === null && list.result !== null && list.result.errors.length === 0 && list.entries.length === 0 && ops?.["prs.list"] === true && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: noteStyle, children: [
                  "No ",
                  listState === "all" ? "" : `${listState} `,
                  "pull requests",
                  involvement !== "all" ? ` (${involvement})` : "",
                  debouncedQuery.trim() !== "" ? ` matching \u201C${debouncedQuery.trim()}\u201D` : "",
                  "."
                ] }),
                list.pending && list.entries.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: noteStyle, children: "Reading pull requests\u2026" }),
                prsListHasMore(list.result) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    disabled: list.loadingMore,
                    onClick: list.loadMore,
                    style: { ...control, margin: "4px 10px" },
                    children: list.loadingMore ? "Loading\u2026" : "Load more"
                  }
                )
              ] }),
              selected !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                ops !== null && ops["prs.detail"] !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: noteStyle, children: "Pull-request detail is not supported by this host (prs.detail)." }),
                detail === null && sections.detailError === null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: noteStyle, children: "Reading pull request\u2026" }),
                sections.detailError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: noteStyle, children: [
                  sections.detailError,
                  detail !== null ? " \u2014 showing the last successful read." : ""
                ] }),
                detail !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "6px 10px 2px" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "div",
                      {
                        style: {
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          flexWrap: "wrap"
                        },
                        children: [
                          stateBadge(detail),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 13, overflowWrap: "anywhere" }, children: detail.title }),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted, fontSize: 11 }, children: [
                            detail.repository,
                            "#",
                            detail.number
                          ] })
                        ]
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: muted, fontSize: 11, marginTop: 2 }, children: detail.url })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "4px 10px" }, children: [
                    metaRow("Author", prsActorLabel(detail.author)),
                    metaRow(
                      "Branches",
                      `${detail.headRepositoryNameWithOwner ?? detail.headBranch}:${detail.headBranch} \u2192 ${detail.baseBranch}`
                    ),
                    metaRow(
                      "Changes",
                      `+${detail.additions} \u2212${detail.deletions} \xB7 ${detail.changedFiles} file${detail.changedFiles === 1 ? "" : "s"}`
                    ),
                    metaRow("Mergeability", prsMergeabilityLabel(detail.mergeability)),
                    detail.baseComparison !== void 0 && metaRow(
                      "Base",
                      detail.baseComparison === "behind" ? `behind ${detail.baseBranch}${detail.behindBy !== void 0 ? ` by ${detail.behindBy}` : ""}` : detail.baseComparison
                    ),
                    detail.autoMergeEnabled === true && metaRow("Auto-merge", detail.autoMergeMethod ?? "enabled"),
                    detail.workflowApprovalsRequired !== void 0 && detail.workflowApprovalsRequired > 0 && metaRow(
                      "Approvals",
                      `${detail.workflowApprovalsRequired} workflow approval${detail.workflowApprovalsRequired === 1 ? "" : "s"} required`
                    ),
                    metaRow("Created", formatRelativeTime(detail.createdAt)),
                    metaRow("Updated", formatRelativeTime(detail.updatedAt)),
                    detail.mergedAt !== null && metaRow("Merged", formatRelativeTime(detail.mergedAt)),
                    detail.closedAt !== null && metaRow("Closed", formatRelativeTime(detail.closedAt)),
                    detail.reviewers.length > 0 && metaRow("Reviewers", detail.reviewers.map(prsActorLabel).join(", ")),
                    detail.labels.length > 0 && metaRow("Labels", detail.labels.map((label) => label.name).join(", "))
                  ] }),
                  detail.body !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "pre",
                    {
                      style: {
                        margin: "2px 10px",
                        padding: "6px 8px",
                        fontSize: 11,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        background: "var(--muted, #f4f5f7)",
                        borderRadius: 5,
                        maxHeight: 220,
                        overflow: "auto"
                      },
                      children: detail.body
                    }
                  ),
                  detail.bodyTruncated === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Description truncated by the contract bound \u2014 read the rest on the host." })
                ] }),
                sections.stackError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { ...noteStyle, fontSize: 11 }, children: sections.stackError }),
                ops !== null && ops["prs.stack"] !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Stack information is not supported by this host (prs.stack)." }),
                sections.stack !== null && sections.stack.layers.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Stack", style: { paddingBottom: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: headingStyle, children: [
                    "Stack \u2014 base ",
                    sections.stack.base,
                    " (",
                    sections.stack.layers.length,
                    ")"
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: sections.stack.layers.map((layer) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                    "li",
                    {
                      style: { padding: "2px 10px", fontSize: 12, color: muted },
                      children: [
                        "#",
                        layer.number,
                        " ",
                        layer.title ?? "",
                        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                          " \u2014 ",
                          layer.isDraft === true ? "draft" : layer.state
                        ] })
                      ]
                    },
                    layer.number
                  )) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Checks", style: { paddingBottom: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: headingStyle, children: [
                    "Checks",
                    detail !== null && prsChecksSummary(detail.checks) !== null ? ` \u2014 ${prsChecksSummary(detail.checks)}` : ""
                  ] }),
                  detail !== null && detail.checks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: "No checks reported." }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: detail?.checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    CheckRow,
                    {
                      check
                    },
                    `${check.name}:${check.status}:${check.url ?? ""}`
                  )) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Linked threads", style: { paddingBottom: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: headingStyle, children: "Linked threads" }),
                  ops !== null && ops["prs.linkedThreads"] !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Linked threads are not supported by this host." }),
                  sections.linkedError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { ...noteStyle, fontSize: 11 }, children: sections.linkedError }),
                  sections.linked !== null && sections.linked.threads.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: "No linked threads." }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: sections.linked?.threads.map((thread) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { padding: "2px 10px", fontSize: 12 }, children: [
                    thread.title,
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted, fontSize: 11 }, children: [
                      " ",
                      "\u2014 ",
                      thread.id,
                      thread.archivedAt !== null ? " \xB7 archived" : ""
                    ] })
                  ] }, thread.id)) }),
                  sections.linked?.truncated === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Linked-thread list truncated." })
                ] }),
                ops !== null && ops["prs.activity"] !== true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Review threads and comments are not supported by this host (prs.activity)." }),
                sections.activityError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { ...noteStyle, fontSize: 11 }, children: sections.activityError }),
                activity !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Review threads", style: { paddingBottom: 4 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: headingStyle, children: [
                      "Review threads",
                      activity.reviewThreads.length > 0 ? ` (${activity.reviewThreads.length})` : ""
                    ] }),
                    activity.reviewThreads.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: "No review threads." }),
                    activity.reviewThreads.map((thread) => {
                      const paged = pagedThreads !== null && pagedThreads.scope === pagedScope && pagedThreads.activity === activity ? pagedThreads.map.get(thread.id) : void 0;
                      const merged = paged === void 0 ? thread : {
                        ...thread,
                        comments: mergeThreadComments(thread.comments, paged.comments),
                        nextCommentsCursor: paged.nextCursor ?? void 0
                      };
                      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        ReviewThreadSection,
                        {
                          thread: merged,
                          canPage: ops?.["prs.threadComments"] === true,
                          paging: pagedScope !== null && pagingThreads.has(`${pagedScope}
${thread.id}`),
                          unrecoverable: paged !== void 0 ? paged.truncated && paged.nextCursor === null : thread.nextCommentsCursor === void 0 && thread.commentCount !== void 0 && thread.commentCount > thread.comments.length,
                          pageError: paged?.error ?? null,
                          onLoadMore: loadThreadComments
                        },
                        thread.id
                      );
                    })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Comments", style: { paddingBottom: 4 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: headingStyle, children: [
                      "Comments",
                      activity.commentCount > 0 ? ` (${activity.commentCount})` : ""
                    ] }),
                    activity.comments.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...noteStyle, fontSize: 11 }, children: "No comments." }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: activity.comments.map((comment) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommentRow, { comment }, comment.id)) }),
                    activity.commentsTruncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Comment list truncated by the host." })
                  ] }),
                  activity.commits.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Commits", style: { paddingBottom: 4 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: headingStyle, children: [
                      "Commits (",
                      activity.commits.length,
                      ")"
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: activity.commits.map((commit) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { padding: "2px 10px", fontSize: 12 }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "span",
                        {
                          style: {
                            fontFamily: "var(--font-mono, ui-monospace, monospace)",
                            color: muted,
                            fontSize: 11
                          },
                          children: commit.oid.slice(0, 8)
                        }
                      ),
                      " ",
                      commit.messageHeadline,
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted, fontSize: 11 }, children: [
                        " ",
                        "\xB7 ",
                        formatRelativeTime(commit.committedDate)
                      ] })
                    ] }, commit.oid)) })
                  ] }),
                  activity.truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11 }, children: "Activity truncated \u2014 some comments, threads, or commits were not delivered." })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Diff", style: { paddingBottom: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: headingStyle, children: "Diff" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    PrsDiffSection,
                    {
                      diff,
                      supported: ops?.["prs.streamDiff"] === true,
                      onLoadMore: loadMore
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { ...noteStyle, fontSize: 11, paddingBottom: 8 }, children: PRS_MUTATIONS_DEFERRED })
              ] })
            ] })
          ] })
        ]
      }
    );
  }

  // extension.tsx
  var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.version-control";
  var REPOSITORY_API_RANGE = "^1.0.0";
  var LANES = new Set(CHANGE_LANES);
  var VIEWS = /* @__PURE__ */ new Set(["pull-requests", "repository"]);
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value;
    return Object.keys(record).every(
      (key) => ["selectedPath", "selectedLane", "view", "prHost", "prRepository", "prNumber"].includes(key)
    ) && (record.selectedPath === void 0 || typeof record.selectedPath === "string") && (record.selectedLane === void 0 || typeof record.selectedLane === "string" && LANES.has(record.selectedLane)) && (record.view === void 0 || typeof record.view === "string" && VIEWS.has(record.view)) && (record.prHost === void 0 || typeof record.prHost === "string") && (record.prRepository === void 0 || typeof record.prRepository === "string") && (record.prNumber === void 0 || typeof record.prNumber === "number");
  }
  function useCapabilities(host, session, visible, tick) {
    const [result, setResult] = (0, import_react2.useState)(null);
    (0, import_react2.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsRepositoryApi, host, session.context, REPOSITORY_API_RANGE).invoke("getCapabilities", {}, signal).then(
        (capabilities) => {
          if (!signal.aborted) setResult({ key: tick, capabilities, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: tick,
              capabilities: null,
              error: error instanceof Error ? error.message : "Capabilities unavailable"
            });
        }
      );
      return () => controller.abort();
    }, [host, session, visible, tick]);
    return result?.key === tick ? result : { capabilities: null, error: null };
  }
  function useStatusStream(host, session, visible, tick) {
    const [model, setModel] = (0, import_react2.useState)(null);
    (0, import_react2.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        let status = CONNECTING_STATUS;
        setModel({ key: tick, status });
        for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
          let closed = false;
          try {
            const stream = bindStreamApi(vcsStatusApi, host, session.context).subscribe(
              "subscribe",
              {},
              signal
            );
            for await (const frame of stream) {
              if (signal.aborted) return;
              status = applyStatusEvent(status, frame.value);
              setModel({ key: tick, status });
              if (frame.value.kind === "closed") {
                closed = true;
                break;
              }
            }
          } catch (error) {
            if (!signal.aborted)
              setModel({
                key: tick,
                status: {
                  ...status,
                  stream: "ended",
                  detail: error instanceof Error ? error.message : "Status stream unavailable"
                }
              });
            return;
          }
          if (signal.aborted) return;
          if (!closed) {
            setModel({
              key: tick,
              status: { ...status, stream: "ended", detail: "Status stream ended unexpectedly." }
            });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
        if (!signal.aborted)
          setModel({
            key: tick,
            status: { ...status, stream: "ended", detail: "Status stream ended repeatedly." }
          });
      })();
      return () => controller.abort();
    }, [host, session, visible, tick]);
    return model?.key === tick ? model.status : CONNECTING_STATUS;
  }
  function useChangesList(host, session, visible, isRepo, revision2) {
    const [result, setResult] = (0, import_react2.useState)(null);
    (0, import_react2.useEffect)(() => {
      if (!visible || !isRepo || revision2 === "") return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsChangesApi, host, session.context).invoke("list", {}, signal).then(
        (changes) => {
          if (!signal.aborted) setResult({ key: revision2, changes, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult((prev) => ({
              key: revision2,
              // A failed re-read keeps the last-good lanes — a settled
              // mutation re-reads every time, so blanking on each settle
              // would flash the panel empty once per click.
              changes: prev?.changes ?? null,
              error: error instanceof Error ? error.message : "Changes list unavailable"
            }));
        }
      );
      return () => controller.abort();
    }, [host, session, visible, isRepo, revision2]);
    if (result === null) return { changes: null, error: null };
    return { changes: result.changes, error: result.key === revision2 ? result.error : null };
  }
  function useRefsList(host, session, visible, isRepo, revision2) {
    const [result, setResult] = (0, import_react2.useState)(null);
    (0, import_react2.useEffect)(() => {
      if (!visible || !isRepo || revision2 === "") return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsRefsApi, host, session.context).invoke("list", { refKind: "all" }, signal).then(
        (refs) => {
          if (!signal.aborted) setResult({ key: revision2, refs, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult((prev) => ({
              key: revision2,
              refs: prev?.refs ?? null,
              error: error instanceof Error ? error.message : "Refs list unavailable"
            }));
        }
      );
      return () => controller.abort();
    }, [host, session, visible, isRepo, revision2]);
    if (result === null) return { refs: null, error: null };
    return { refs: result.refs, error: result.key === revision2 ? result.error : null };
  }
  function useRemotesList(host, session, visible, enabled, revision2) {
    const [result, setResult] = (0, import_react2.useState)(null);
    (0, import_react2.useEffect)(() => {
      if (!visible || !enabled || revision2 === "") return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsRepositoryApi, host, session.context, REPOSITORY_API_RANGE).invoke("listRemotes", {}, signal).then(
        (remotes) => {
          if (!signal.aborted) setResult({ key: revision2, remotes, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult((prev) => ({
              key: revision2,
              remotes: prev?.remotes ?? null,
              error: error instanceof Error ? error.message : "Remotes list unavailable"
            }));
        }
      );
      return () => controller.abort();
    }, [host, session, visible, enabled, revision2]);
    if (result === null) return { remotes: null, error: null };
    return { remotes: result.remotes, error: result.key === revision2 ? result.error : null };
  }
  var control2 = {
    padding: "4px 8px",
    border: "1px solid var(--border, #dfe3e8)",
    borderRadius: 5,
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer"
  };
  var muted2 = "var(--muted-foreground, #667085)";
  function VersionControlView(props) {
    const { host, session } = props;
    const [visible, setVisible] = (0, import_react2.useState)(session.visible);
    const [tick, setTick] = (0, import_react2.useState)(0);
    const [refreshError, setRefreshError] = (0, import_react2.useState)(null);
    const [mutation, setMutation] = (0, import_react2.useState)(IDLE_MUTATION);
    const [mutationSerial, setMutationSerial] = (0, import_react2.useState)(0);
    const [commitMessage, setCommitMessage] = (0, import_react2.useState)("");
    const [newRefName, setNewRefName] = (0, import_react2.useState)("");
    const [newWorktreeName, setNewWorktreeName] = (0, import_react2.useState)("");
    const [worktreeRemoveFailures, setWorktreeRemoveFailures] = (0, import_react2.useState)(
      /* @__PURE__ */ new Set()
    );
    const inFlight = (0, import_react2.useRef)(false);
    (0, import_react2.useEffect)(() => session.onVisibility(setVisible), [session]);
    const restored = session.restoreState && typeof session.restoreState === "object" && !Array.isArray(session.restoreState) ? session.restoreState : null;
    const [selection, setSelection] = (0, import_react2.useState)(
      () => restored?.selectedPath && restored.selectedLane && LANES.has(restored.selectedLane) ? { path: restored.selectedPath, lane: restored.selectedLane } : null
    );
    const [view, setView] = (0, import_react2.useState)(
      restored?.view === "repository" ? "repository" : "pull-requests"
    );
    const [selectedPr, setSelectedPr] = (0, import_react2.useState)(
      () => restored?.prRepository !== void 0 && typeof restored.prNumber === "number" ? {
        repository: restored.prRepository,
        number: restored.prNumber,
        ...restored.prHost !== void 0 && restored.prHost !== "" ? { host: restored.prHost } : {}
      } : null
    );
    const savedState = (0, import_react2.useRef)({ ...restored });
    const persist = (patch) => {
      const next = { ...savedState.current, ...patch };
      for (const key of Object.keys(next)) if (next[key] === void 0) delete next[key];
      savedState.current = next;
      session.save(next);
    };
    const repositoryVisible = visible && view === "repository";
    const { capabilities, error: capsError } = useCapabilities(
      host,
      session,
      repositoryVisible,
      tick
    );
    const repo = repositoryState(capabilities, capsError);
    const status = useStatusStream(host, session, repositoryVisible && repo.kind === "ready", tick);
    const isRepo = status.local?.isRepo === true;
    const listRevision = status.localRevision === 0 ? "" : `${status.localRevision}:${mutationSerial}`;
    const changes = useChangesList(host, session, repositoryVisible, isRepo, listRevision);
    const refs = useRefsList(host, session, repositoryVisible, isRepo, listRevision);
    const ops = repo.kind === "ready" ? repo.capabilities.operations : null;
    const remotes = useRemotesList(
      host,
      session,
      repositoryVisible,
      isRepo && ops?.["repository.listRemotes"] === true,
      listRevision
    );
    const lanes = (0, import_react2.useMemo)(() => lanesFromChanges(changes.changes?.entries ?? []), [changes.changes]);
    const selected = retainSelection(selection, lanes);
    const selectedEntry = selected === null ? null : lanes[selected.lane].find((e) => e.path === selected.path) ?? null;
    const selectedStat = selected === null ? null : numstatFor(status.local, selected.path);
    const rows = (0, import_react2.useMemo)(() => refRows(refs.refs), [refs.refs]);
    const remoteList = (0, import_react2.useMemo)(() => remoteRows(remotes.remotes), [remotes.remotes]);
    const worktrees = (0, import_react2.useMemo)(() => worktreeRows(rows), [rows]);
    const canStage = ops?.["changes.stage"] === true;
    const canUnstage = ops?.["changes.unstage"] === true;
    const canCommit = ops?.["changes.commit"] === true;
    const canCreateRef = ops?.["refs.create"] === true;
    const canSwitchRef = ops?.["refs.switch"] === true;
    const canPull = ops?.["repository.pull"] === true;
    const canPush = ops?.["repository.push"] === true;
    const canFetch = ops?.["repository.fetch"] === true;
    const canListRemotes = ops?.["repository.listRemotes"] === true;
    const canInit = capabilities?.operations["repository.init"] === true;
    const canCreateWorktree = ops?.["repository.createWorktree"] === true;
    const canRemoveWorktree = ops?.["repository.removeWorktree"] === true;
    const busy = mutation.kind === "running";
    const commit = planCommit(lanes, commitMessage);
    const create = planRefCreate(newRefName, rows);
    const currentBranch = rows.find((row) => row.current && row.remote === null)?.name ?? null;
    const pull = pullState(status.local, status.remote);
    const push = pushState(status.local, status.remote);
    const worktreePlan = planWorktreeCreate(newWorktreeName, rows, currentBranch);
    const runMutation = (op, label, invoke) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setMutation((phase) => startMutation(phase, op, label) ?? phase);
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      invoke(signal).then(
        (detail) => setMutation(settleMutation(op, { ok: true, detail })),
        (error) => setMutation(
          settleMutation(op, {
            ok: false,
            detail: `${label} failed: ${error instanceof Error ? error.message : "operation unavailable"}`
          })
        )
      ).finally(() => {
        inFlight.current = false;
        controller.abort();
        setMutationSerial((value) => value + 1);
      });
    };
    const runPaths = (op, paths, label) => runMutation(op, label, async (signal) => {
      const changesApi = bindApi(vcsChangesApi, host, session.context);
      for (let index = 0; index < paths.length; index += VCS_PATHS_MAX) {
        await changesApi.invoke(op, { paths: paths.slice(index, index + VCS_PATHS_MAX) }, signal);
      }
      const noun = `${paths.length} path${paths.length === 1 ? "" : "s"}`;
      return op === "stage" ? `Staged ${noun}` : `Unstaged ${noun}`;
    });
    const runCommit = () => {
      const plan = planCommit(lanes, commitMessage);
      if (plan.disabled !== null) return;
      const message2 = commitMessage.trim();
      runMutation(
        "commit",
        "Committing",
        (signal) => bindApi(vcsChangesApi, host, session.context).invoke(
          "commit",
          plan.paths === void 0 ? { message: message2 } : { message: message2, paths: [...plan.paths] },
          signal
        ).then((result) => {
          setCommitMessage("");
          return `Committed ${result.commitSha.slice(0, 12)}${result.refName !== null ? ` on ${result.refName}` : ""}`;
        })
      );
    };
    const runCreateRef = () => {
      const plan = planRefCreate(newRefName, rows);
      if (plan.refName === null) return;
      const refName = plan.refName;
      runMutation(
        "ref-create",
        `Creating branch ${refName}`,
        (signal) => bindApi(vcsRefsApi, host, session.context).invoke("create", { refName, switchRef: true }, signal).then((result) => {
          setNewRefName("");
          return `Created and switched to ${result.refName}`;
        })
      );
    };
    const runSwitchRef = (refName) => runMutation(
      "ref-switch",
      `Switching to ${refName}`,
      (signal) => bindApi(vcsRefsApi, host, session.context).invoke("switch", { refName }, signal).then((result) => `Switched to ${result.refName ?? refName}`)
    );
    const repository = () => bindApi(vcsRepositoryApi, host, session.context, REPOSITORY_API_RANGE);
    const runPull = () => runMutation(
      "pull",
      "Pulling",
      (signal) => repository().invoke("pull", {}, signal).then(
        (result) => result.status === "pulled" ? `Pulled ${result.refName} from ${result.upstreamRef ?? "upstream"}` : "Already up to date"
      )
    );
    const runPush = () => runMutation(
      "push",
      "Pushing",
      (signal) => repository().invoke("push", {}, signal).then(
        (result) => result.status === "pushed" ? `Pushed ${result.refName}${result.upstreamRef !== null ? ` \u2192 ${result.upstreamRef}` : ""}${result.setUpstream ? " (upstream set)" : ""}` : "Already up to date"
      )
    );
    const runFetch = (remoteName) => runMutation(
      "fetch",
      remoteName === void 0 ? "Fetching all remotes" : `Fetching ${remoteName}`,
      (signal) => repository().invoke("fetch", remoteName === void 0 ? {} : { remoteName }, signal).then((result) => `Fetched ${result.remotes.join(", ")}`)
    );
    const runInit = () => runMutation(
      "init",
      "Initializing repository",
      (signal) => repository().invoke("init", {}, signal).then(() => {
        setTick((value) => value + 1);
        return "Initialized a Git repository";
      })
    );
    const runCreateWorktree = (plan) => runMutation(
      "worktree-create",
      `Creating worktree`,
      (signal) => repository().invoke(
        "createWorktree",
        {
          refName: plan.refName,
          path: null,
          ...plan.newRefName === void 0 ? {} : { newRefName: plan.newRefName },
          ...plan.baseRefName === void 0 || plan.baseRefName === null ? {} : { baseRefName: plan.baseRefName }
        },
        signal
      ).then((result) => {
        setNewWorktreeName("");
        return `Created worktree ${result.worktree.path} (${result.worktree.refName})`;
      })
    );
    const runRemoveWorktree = (path3, force) => runMutation(
      "worktree-remove",
      `Removing worktree`,
      (signal) => repository().invoke("removeWorktree", force ? { path: path3, force: true } : { path: path3 }, signal).then(
        () => `Removed worktree ${path3}`,
        (error) => {
          setWorktreeRemoveFailures((prev) => new Set(prev).add(path3));
          throw error;
        }
      )
    );
    const refresh = () => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsStatusApi, host, session.context).invoke("refresh", {}, signal).then(
        () => setRefreshError(null),
        (error) => setRefreshError(error instanceof Error ? error.message : "Status refresh unavailable")
      ).finally(() => controller.abort());
      setTick((value) => value + 1);
    };
    const select = (path3, lane) => {
      setSelection({ path: path3, lane });
      persist({ selectedPath: path3, selectedLane: lane });
    };
    const selectPr = (ref) => {
      setSelectedPr(ref);
      persist(
        ref === null ? { prHost: void 0, prRepository: void 0, prNumber: void 0 } : {
          prHost: ref.host ?? void 0,
          prRepository: ref.repository,
          prNumber: ref.number
        }
      );
    };
    const switchView = (next) => {
      setView(next);
      persist({ view: next });
    };
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "section",
      {
        "aria-label": "Version Control",
        style: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          color: "var(--foreground, #20252d)",
          background: "var(--background, #fff)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          fontSize: 13
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                gap: 6,
                padding: 8,
                borderBottom: "1px solid var(--border, #dfe3e8)",
                flexShrink: 0,
                alignItems: "center"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "span",
                  {
                    role: "group",
                    "aria-label": "Panel view",
                    style: { display: "flex", gap: 2, flexShrink: 0 },
                    children: [
                      ["pull-requests", "Pull requests"],
                      ["repository", "Repository"]
                    ].map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "button",
                        "aria-pressed": view === value,
                        onClick: () => switchView(value),
                        style: {
                          ...control2,
                          padding: "2px 7px",
                          fontSize: 11,
                          fontWeight: view === value ? 600 : 400,
                          background: view === value ? "var(--accent, #e8eef7)" : "transparent"
                        },
                        children: label
                      },
                      value
                    ))
                  }
                ),
                view === "repository" && repo.kind === "ready" && repo.capabilities.operations["status.refresh"] === true && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: refresh, style: control2, children: "Refresh" }),
                view === "repository" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: muted2, fontSize: 11 }, children: refreshError ?? describeStatus(status) })
              ]
            }
          ),
          view === "pull-requests" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            PullRequestsPanel,
            {
              host,
              session,
              visible,
              selected: selectedPr,
              onSelect: selectPr
            }
          ),
          view === "repository" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            repo.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "note", style: { padding: "6px 10px", color: muted2, fontSize: 12, margin: 0 }, children: "Reading repository capabilities\u2026" }),
            repo.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "alert", style: { padding: "6px 10px", color: muted2, fontSize: 12, margin: 0 }, children: [
              "Repository status unavailable \u2014 ",
              repo.detail
            ] }),
            describeMutation(mutation) !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "output",
              {
                "aria-label": "Mutation status",
                role: mutation.kind === "failed" ? "alert" : "status",
                style: {
                  display: "block",
                  padding: "4px 10px",
                  color: mutation.kind === "failed" ? "var(--destructive, #b42318)" : muted2,
                  fontSize: 11
                },
                children: describeMutation(mutation)
              }
            ),
            repo.kind === "no-repository" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted2, fontSize: 12, margin: 0 }, children: [
              "This workspace is not a repository",
              repo.detail ? ` \u2014 ${repo.detail}` : "",
              ".",
              canInit && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  disabled: busy,
                  onClick: runInit,
                  style: { ...control2, marginLeft: 6 },
                  children: "Initialize Git repository"
                }
              ),
              !canInit && " Repository init is not supported by the detected drivers."
            ] }),
            repo.kind === "unsupported" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted2, fontSize: 12, margin: 0 }, children: [
              "Unsupported repository driver: ",
              repo.driverKind,
              ". ",
              repo.detail
            ] }),
            repo.kind === "ready" && isRepo && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { flex: 1, minHeight: 0, overflow: "auto", padding: 6 }, children: [
              (canPull || canPush) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "section",
                {
                  "aria-label": "Sync",
                  style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px 6px" },
                  children: [
                    canPull && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "button",
                        disabled: busy || pull.disabled !== null,
                        onClick: runPull,
                        style: control2,
                        children: pull.label
                      }
                    ),
                    canPush && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "button",
                        disabled: busy || push.disabled !== null,
                        onClick: runPush,
                        style: control2,
                        children: push.label
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: muted2, fontSize: 11 }, children: [canPull ? pull.disabled : null, canPush ? push.disabled : null].filter((reason) => reason !== null).join(" \xB7 ") })
                  ]
                }
              ),
              changes.error !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "output",
                {
                  "aria-label": "Changes status",
                  style: { display: "block", padding: "4px 6px", color: muted2, fontSize: 11 },
                  children: changes.error
                }
              ),
              changes.changes !== null && laneCount(lanes) === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { padding: "4px 6px", color: muted2, fontSize: 12, margin: 0 }, children: "Working tree clean \u2014 nothing staged, modified, or untracked." }),
              CHANGE_LANES.map((lane) => {
                const bulk = laneMutation(lane);
                const rowAction = entryMutation(lane);
                const bulkAllowed = bulk !== null && (bulk.op === "stage" ? canStage : canUnstage);
                const rowAllowed = rowAction !== null && (rowAction.op === "stage" ? canStage : canUnstage);
                return lanes[lane].length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": laneTitle(lane), style: { marginBottom: 8 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                    "h3",
                    {
                      style: {
                        margin: 0,
                        padding: "2px 6px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: muted2,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 6
                      },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
                          laneTitle(lane),
                          " (",
                          lanes[lane].length,
                          ")"
                        ] }),
                        bulkAllowed && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => runPaths(
                              bulk.op,
                              lanes[lane].map((entry) => entry.path),
                              `${bulk.op === "stage" ? "Staging" : "Unstaging"} ${lanes[lane].length} paths`
                            ),
                            style: { ...control2, padding: "1px 6px", fontSize: 11 },
                            children: bulk.label
                          }
                        )
                      ]
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: lanes[lane].map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                    "li",
                    {
                      style: { display: "flex", alignItems: "center", gap: 4 },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                          "button",
                          {
                            type: "button",
                            "aria-current": selected?.path === entry.path && selected.lane === lane ? "true" : void 0,
                            onClick: () => select(entry.path, lane),
                            style: {
                              flex: 1,
                              minWidth: 0,
                              textAlign: "left",
                              font: "inherit",
                              fontSize: 12,
                              padding: "4px 6px",
                              border: "1px solid transparent",
                              borderRadius: 5,
                              cursor: "pointer",
                              color: "var(--foreground, #20252d)",
                              background: selected?.path === entry.path && selected.lane === lane ? "var(--accent, #e8eef7)" : "transparent",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            },
                            children: [
                              entry.path,
                              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { color: muted2 }, children: [
                                " \u2014 ",
                                describeEntry(entry)
                              ] })
                            ]
                          }
                        ),
                        rowAllowed && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => runPaths(
                              rowAction.op,
                              [entry.path],
                              `${rowAction.op === "stage" ? "Staging" : "Unstaging"} ${entry.path}`
                            ),
                            style: {
                              ...control2,
                              padding: "1px 6px",
                              fontSize: 11,
                              flexShrink: 0
                            },
                            children: rowAction.label
                          }
                        )
                      ]
                    },
                    entry.path
                  )) })
                ] }, lane);
              }),
              canCommit && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "Commit", style: { marginTop: 4, marginBottom: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "h3",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: muted2,
                      textTransform: "uppercase",
                      letterSpacing: 0.4
                    },
                    children: "Commit"
                  }
                ),
                status.local?.isDefaultRef === true && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "p",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      color: "var(--warning, #b54708)"
                    },
                    children: "Warning: committing on the default branch"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "textarea",
                  {
                    "aria-label": "Commit message",
                    value: commitMessage,
                    disabled: busy,
                    onChange: (event) => setCommitMessage(event.target.value),
                    placeholder: "Commit message",
                    rows: 2,
                    style: {
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                      margin: "4px 0",
                      padding: "4px 6px",
                      font: "inherit",
                      fontSize: 12,
                      border: "1px solid var(--border, #dfe3e8)",
                      borderRadius: 5,
                      background: "transparent",
                      color: "inherit",
                      resize: "vertical"
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    "button",
                    {
                      type: "button",
                      disabled: busy || commit.disabled !== null,
                      onClick: runCommit,
                      style: control2,
                      children: commit.label
                    }
                  ),
                  commit.disabled !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: muted2, fontSize: 11 }, children: commit.disabled })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "Refs", style: { marginTop: 4 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "h3",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: muted2,
                      textTransform: "uppercase",
                      letterSpacing: 0.4
                    },
                    children: [
                      "Refs",
                      refs.refs ? ` (${refs.refs.totalCount})` : ""
                    ]
                  }
                ),
                canCreateRef && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 6px 4px"
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "input",
                        {
                          "aria-label": "New branch name",
                          value: newRefName,
                          disabled: busy,
                          onChange: (event) => setNewRefName(event.target.value),
                          onKeyDown: (event) => {
                            if (event.key === "Enter") runCreateRef();
                          },
                          placeholder: "New branch name",
                          style: {
                            flex: 1,
                            minWidth: 0,
                            font: "inherit",
                            fontSize: 12,
                            padding: "3px 6px",
                            border: "1px solid var(--border, #dfe3e8)",
                            borderRadius: 5,
                            background: "transparent",
                            color: "inherit"
                          }
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy || create.refName === null,
                          onClick: runCreateRef,
                          style: { ...control2, padding: "2px 6px", fontSize: 11, flexShrink: 0 },
                          children: "Create & switch"
                        }
                      )
                    ]
                  }
                ),
                canCreateRef && create.disabled !== null && newRefName.trim() !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "output",
                  {
                    "aria-label": "Branch create status",
                    style: { display: "block", padding: "0 6px 4px", color: muted2, fontSize: 11 },
                    children: create.disabled
                  }
                ),
                refs.error !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "output",
                  {
                    "aria-label": "Refs status",
                    style: { display: "block", padding: "4px 6px", color: muted2, fontSize: 11 },
                    children: refs.error
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: rows.map((row) => {
                  const switchState = refSwitchState(row, currentBranch);
                  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                    "li",
                    {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 6px",
                        fontSize: 12
                      },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                          "span",
                          {
                            style: {
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            },
                            children: [
                              row.name,
                              describeRef(row) !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { color: muted2 }, children: [
                                " \u2014 ",
                                describeRef(row)
                              ] })
                            ]
                          }
                        ),
                        canSwitchRef && !row.current && !switchState.ok && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: muted2, fontSize: 11, flexShrink: 0 }, children: switchState.reason }),
                        canSwitchRef && switchState.ok && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => runSwitchRef(refSwitchTarget(row)),
                            style: { ...control2, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                            children: "Switch"
                          }
                        ),
                        canCreateWorktree && canWorktreeRef(row) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => runCreateWorktree({ refName: row.name }),
                            style: { ...control2, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                            children: "Worktree"
                          }
                        )
                      ]
                    },
                    `${row.remote ?? ""}:${row.name}`
                  );
                }) })
              ] }),
              (canCreateWorktree || canRemoveWorktree) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "Worktrees", style: { marginTop: 4 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "h3",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: muted2,
                      textTransform: "uppercase",
                      letterSpacing: 0.4
                    },
                    children: [
                      "Worktrees",
                      worktrees.length > 0 ? ` (${worktrees.length})` : ""
                    ]
                  }
                ),
                canCreateWorktree && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 6px 4px"
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "input",
                        {
                          "aria-label": "New worktree branch",
                          value: newWorktreeName,
                          disabled: busy,
                          onChange: (event) => setNewWorktreeName(event.target.value),
                          onKeyDown: (event) => {
                            if (event.key === "Enter" && worktreePlan.branch !== null && worktreePlan.refName !== null)
                              runCreateWorktree({
                                refName: worktreePlan.refName,
                                newRefName: worktreePlan.branch,
                                baseRefName: worktreePlan.baseRefName ?? void 0
                              });
                          },
                          placeholder: "New worktree branch",
                          style: {
                            flex: 1,
                            minWidth: 0,
                            font: "inherit",
                            fontSize: 12,
                            padding: "3px 6px",
                            border: "1px solid var(--border, #dfe3e8)",
                            borderRadius: 5,
                            background: "transparent",
                            color: "inherit"
                          }
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy || worktreePlan.branch === null,
                          onClick: () => {
                            if (worktreePlan.branch === null || worktreePlan.refName === null) return;
                            runCreateWorktree({
                              refName: worktreePlan.refName,
                              newRefName: worktreePlan.branch,
                              baseRefName: worktreePlan.baseRefName ?? void 0
                            });
                          },
                          style: { ...control2, padding: "2px 6px", fontSize: 11, flexShrink: 0 },
                          children: "Create worktree"
                        }
                      )
                    ]
                  }
                ),
                canCreateWorktree && worktreePlan.disabled !== null && newWorktreeName.trim() !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "output",
                  {
                    "aria-label": "Worktree create status",
                    style: {
                      display: "block",
                      padding: "0 6px 4px",
                      color: muted2,
                      fontSize: 11
                    },
                    children: worktreePlan.disabled
                  }
                ),
                worktrees.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: 0, padding: "2px 6px 4px", color: muted2, fontSize: 11 }, children: "No additional worktrees." }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: worktrees.map((worktree) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "li",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 6px",
                      fontSize: 12
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "span",
                        {
                          style: {
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          },
                          children: [
                            worktree.refName,
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { color: muted2 }, children: [
                              " \u2014 ",
                              worktree.path
                            ] })
                          ]
                        }
                      ),
                      canRemoveWorktree && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runRemoveWorktree(worktree.path, false),
                          style: { ...control2, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                          children: "Remove"
                        }
                      ),
                      canRemoveWorktree && worktreeRemoveFailures.has(worktree.path) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runRemoveWorktree(worktree.path, true),
                          style: {
                            ...control2,
                            padding: "1px 6px",
                            fontSize: 11,
                            flexShrink: 0,
                            color: "var(--destructive, #b42318)"
                          },
                          children: "Force remove"
                        }
                      )
                    ]
                  },
                  worktree.path
                )) })
              ] }),
              canListRemotes && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": "Remotes", style: { marginTop: 4 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "h3",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: muted2,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
                        "Remotes",
                        remoteList.length > 0 ? ` (${remoteList.length})` : ""
                      ] }),
                      canFetch && remoteList.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runFetch(),
                          style: { ...control2, padding: "1px 6px", fontSize: 11 },
                          children: "Fetch all"
                        }
                      )
                    ]
                  }
                ),
                remotes.error !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "output",
                  {
                    "aria-label": "Remotes status",
                    style: { display: "block", padding: "4px 6px", color: muted2, fontSize: 11 },
                    children: remotes.error
                  }
                ),
                remotes.remotes !== null && remoteList.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: 0, padding: "2px 6px 4px", color: muted2, fontSize: 11 }, children: "No remotes configured." }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: remoteList.map((remote) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "li",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 6px",
                      fontSize: 12
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "span",
                        {
                          style: {
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          },
                          children: [
                            remote.name,
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { color: muted2 }, children: [
                              " ",
                              "\u2014 ",
                              remote.url,
                              remote.isPrimary ? " \xB7 primary" : ""
                            ] })
                          ]
                        }
                      ),
                      canFetch && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runFetch(remote.name),
                          style: { ...control2, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                          children: "Fetch"
                        }
                      )
                    ]
                  },
                  remote.name
                )) })
              ] })
            ] }),
            selected !== null && selectedEntry !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "output",
              {
                "aria-label": "Selection",
                style: {
                  padding: "6px 10px",
                  color: muted2,
                  fontSize: 11,
                  borderTop: "1px solid var(--border, #dfe3e8)",
                  flexShrink: 0
                },
                children: [
                  selected.path,
                  " \u2014 ",
                  describeEntry(selectedEntry),
                  selectedStat !== null ? ` (+${selectedStat.insertions} \u2212${selectedStat.deletions})` : ""
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Slice notice",
              style: {
                padding: "6px 10px",
                color: muted2,
                fontSize: 11,
                borderTop: "1px solid var(--border, #dfe3e8)",
                flexShrink: 0
              },
              children: "Version Control on t3.vcs + t3.prs/read: pull-request browse/detail/diff (read-only), status, staging lanes, stage/unstage/commit, branch create/switch, pull/push/fetch, init, worktrees, and remotes (t3.vcs/mutate). PR mutations, publish/clone, stash, and per-hunk diff expansion are deferred slices."
            }
          )
        ]
      }
    );
  }
  var extension_default = defineExtension({
    id: manifestId,
    version: "0.4.0",
    requires: [
      requireApi(prsReadApi),
      requireApi(vcsStatusApi),
      requireApi(vcsChangesApi),
      requireApi(vcsRefsApi),
      requireApi(vcsRepositoryApi, REPOSITORY_API_RANGE)
    ],
    surfaces: [
      {
        name: "view",
        title: "Version Control",
        scope: "project",
        placements: ["side-panel"],
        clients: ["web", "desktop"],
        capabilities: [],
        stateVersion: 2,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(VersionControlView, { host, session }) };
        }
      }
    ]
  });

  // extension.ts
  var extension_default2 = extension_default;

  // generated-client.ts
  var generated_client_default = extension_default2.client;
  return __toCommonJS(generated_client_exports);
})();

return __t3Client.default(__t3Host);
}
