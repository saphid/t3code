export default function (__t3Host) {
"use strict";
var __t3Client = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
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
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // generated-client.ts
  var generated_client_exports = {};
  __export(generated_client_exports, {
    default: () => generated_client_default
  });

  // node_modules/@t3tools/extension-sdk/dist/contracts.js
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
      if (surface.claimsTerminalFocus !== void 0 && typeof surface.claimsTerminalFocus !== "boolean")
        throw new Error("Invalid terminal focus claim");
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

  // node_modules/@t3tools/extension-sdk/dist/capabilities.js
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

  // node_modules/@t3tools/extension-sdk/dist/orchestration.js
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
    requestKind: { enum: ["command", "file-read", "file-change", "mcp-elicitation", "permission"] },
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

  // node_modules/@t3tools/extension-sdk/dist/textEdits.js
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

  // node_modules/@t3tools/extension-sdk/dist/workspaceResources.js
  var WORKSPACE_RESOURCES = "t3.workspace/resources";
  var WORKSPACE_RESOURCE_CHUNK_UNITS = 8192;
  var WORKSPACE_RESOURCE_MAX_CHUNKS = 2048;
  var WORKSPACE_RESOURCE_MAX_BYTES = 8 * 1024 * 1024;
  var WORKSPACE_RESOURCE_REASONS = [
    "not-found",
    "not-regular-file",
    "binary",
    "invalid-utf8",
    "oversized",
    "outside-workspace",
    "unsafe-path",
    "changed-during-read",
    "aborted",
    "io-error",
    "unknown-upload",
    "upload-limit",
    "upload-incomplete",
    "digest-mismatch"
  ];
  var resourcePath = { type: "string", minLength: 1, maxLength: 512 };
  var resourceDigest = {
    type: "string",
    minLength: 64,
    maxLength: 64,
    pattern: "^[0-9a-f]{64}$"
  };
  var resourceReason = { enum: WORKSPACE_RESOURCE_REASONS };
  var uploadId = { type: "string", minLength: 1, maxLength: 128 };
  var resourceByteLength = {
    type: "integer",
    minimum: 0,
    maximum: WORKSPACE_RESOURCE_MAX_BYTES
  };
  var resourceChunkCount = {
    type: "integer",
    minimum: 0,
    maximum: WORKSPACE_RESOURCE_MAX_CHUNKS
  };
  var saveUnavailableOutput = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "reason"],
    properties: {
      kind: { const: "unavailable" },
      relativePath: resourcePath,
      reason: resourceReason
    }
  };
  var workspaceResourcesApi = defineStreamApi({
    id: WORKSPACE_RESOURCES,
    version: "1.0.0",
    methods: [
      {
        name: "save.begin",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath", "expectedRevision", "byteLength", "chunkCount", "sha256"],
          properties: {
            relativePath: resourcePath,
            expectedRevision: resourceDigest,
            byteLength: resourceByteLength,
            chunkCount: resourceChunkCount,
            sha256: resourceDigest
          }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "uploadId"],
              properties: { kind: { const: "session" }, uploadId }
            },
            saveUnavailableOutput
          ]
        }
      },
      {
        name: "save.chunk",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["uploadId", "chunkIndex", "data"],
          properties: {
            uploadId,
            chunkIndex: {
              type: "integer",
              minimum: 0,
              maximum: WORKSPACE_RESOURCE_MAX_CHUNKS - 1
            },
            data: { type: "string", maxLength: WORKSPACE_RESOURCE_CHUNK_UNITS }
          }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "received"],
              properties: {
                kind: { const: "accepted" },
                received: resourceChunkCount
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "reason"],
              properties: { kind: { const: "unavailable" }, reason: resourceReason }
            }
          ]
        }
      },
      {
        name: "save.commit",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["uploadId"],
          properties: { uploadId }
        },
        outputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "revision"],
              properties: {
                kind: { const: "saved" },
                relativePath: resourcePath,
                revision: resourceDigest
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath"],
              properties: { kind: { const: "conflict" }, relativePath: resourcePath }
            },
            saveUnavailableOutput
          ]
        }
      },
      {
        name: "save.abort",
        effect: "write",
        requiredGrants: [WORKSPACE_WRITE_TEXT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["uploadId"],
          properties: { uploadId }
        },
        outputSchema: { type: "object", additionalProperties: false, properties: {} }
      }
    ],
    streams: [
      {
        name: "read",
        requiredGrants: [WORKSPACE_RESOURCES],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: {
            relativePath: resourcePath,
            maxBytes: { type: "integer", minimum: 1, maximum: WORKSPACE_RESOURCE_MAX_BYTES }
          }
        },
        eventSchema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: [
                "kind",
                "relativePath",
                "byteLength",
                "deliveredByteLength",
                "chunkCount",
                "truncated"
              ],
              properties: {
                kind: { const: "manifest" },
                relativePath: resourcePath,
                byteLength: { type: "integer", minimum: 0 },
                deliveredByteLength: resourceByteLength,
                chunkCount: resourceChunkCount,
                truncated: { type: "boolean" }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "chunkIndex", "data"],
              properties: {
                kind: { const: "chunk" },
                chunkIndex: {
                  type: "integer",
                  minimum: 0,
                  maximum: WORKSPACE_RESOURCE_MAX_CHUNKS - 1
                },
                data: { type: "string", maxLength: WORKSPACE_RESOURCE_CHUNK_UNITS }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "sha256"],
              properties: { kind: { const: "complete" }, sha256: resourceDigest }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "relativePath", "reason"],
              properties: {
                kind: { const: "unavailable" },
                relativePath: resourcePath,
                reason: resourceReason
              }
            }
          ]
        }
      }
    ]
  });
  var WORKSPACE_RESOURCES_API = workspaceResourcesApi.definition;

  // node_modules/@t3tools/extension-sdk/dist/clientProviders.js
  var targetSchema = {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { enum: ["self", "connection"] },
      connectionId: { type: "string", minLength: 1, maxLength: 160 }
    }
  };
  var withTarget = (properties, required = []) => ({
    type: "object",
    additionalProperties: false,
    required: ["target", ...required],
    properties: { target: targetSchema, ...properties }
  });
  var okOutput = {
    type: "object",
    additionalProperties: false,
    required: ["applied"],
    properties: { applied: { type: "boolean" } }
  };
  var themeAppearance = { enum: ["light", "dark"] };
  var themeHalvesSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      light: { type: "string", maxLength: 160 },
      dark: { type: "string", maxLength: 160 }
    }
  };
  var themeProviderStateSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "theme",
      "resolvedTheme",
      "systemDark",
      "followSystem",
      "appearanceMode",
      "themeHalves",
      "effectiveTheme",
      "sessionOverlay"
    ],
    properties: {
      theme: { type: "string", maxLength: 160 },
      resolvedTheme: themeAppearance,
      systemDark: { type: "boolean" },
      followSystem: { type: "boolean" },
      appearanceMode: { enum: ["light", "dark", "system"] },
      themeHalves: { anyOf: [themeHalvesSchema, { type: "null" }] },
      effectiveTheme: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: { enum: ["stored", "session-overlay", "external-preview"] },
          theme: { type: "string", maxLength: 160 },
          writer: { type: "string", maxLength: 160 },
          tokens: {
            type: "object",
            additionalProperties: { type: "string", maxLength: 400 }
          }
        }
      },
      sessionOverlay: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["theme", "writer"],
            properties: {
              theme: { type: "string", maxLength: 160 },
              appearanceMode: { enum: ["light", "dark", "system"] },
              themeHalves: themeHalvesSchema,
              writer: { type: "string", minLength: 1, maxLength: 160 }
            }
          },
          { type: "null" }
        ]
      }
    }
  };
  var themeTokensOutput = {
    type: "object",
    additionalProperties: false,
    required: ["tokens", "cssVars"],
    properties: {
      tokens: { type: "object", additionalProperties: { type: "string", maxLength: 400 } },
      cssVars: { type: "object", additionalProperties: { type: "string", maxLength: 80 } }
    }
  };
  var terminalAppearanceSchema = {
    type: "object",
    additionalProperties: false,
    required: ["theme", "font", "appearance"],
    properties: {
      theme: {
        type: "object",
        additionalProperties: false,
        required: ["background", "foreground", "cursor"],
        properties: {
          background: { type: "string", maxLength: 400 },
          foreground: { type: "string", maxLength: 400 },
          cursor: { type: "string", maxLength: 400 },
          selectionBackground: { type: "string", maxLength: 400 }
        }
      },
      font: {
        type: "object",
        additionalProperties: false,
        properties: {
          family: { type: "string", maxLength: 400 },
          size: { type: "number", minimum: 1, maximum: 128 },
          lineHeight: { type: "number", minimum: 0.1, maximum: 10 },
          ligatures: { type: "boolean" }
        }
      },
      appearance: themeAppearance
    }
  };
  var CLIENT_THEME_API = validateApiDefinition({
    id: "t3.client/theme",
    version: "1.0.0",
    methods: [
      {
        name: "getState",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({}),
        outputSchema: themeProviderStateSchema
      },
      {
        name: "resolveTokens",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({ appearance: themeAppearance }),
        outputSchema: themeTokensOutput
      },
      {
        name: "applyPreference",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          writer: { type: "string", minLength: 1, maxLength: 160 },
          preference: {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: {
              theme: { type: "string", minLength: 1, maxLength: 160 },
              appearanceMode: { enum: ["light", "dark", "system"] },
              themeHalves: themeHalvesSchema,
              mode: { enum: ["persist", "session"] },
              clear: { type: "boolean" }
            }
          }
        }, ["writer", "preference"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: {
            applied: { type: "boolean" },
            reason: { type: "string", maxLength: 200 },
            propagatedTo: { enum: ["storage-origin", "connection"] }
          }
        }
      }
    ],
    streams: [
      {
        name: "watchState",
        inputSchema: withTarget({}),
        eventSchema: themeProviderStateSchema,
        requiredGrants: []
      }
    ]
  });
  var notificationActionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 80 },
      label: { type: "string", minLength: 1, maxLength: 80 },
      variant: { enum: ["default", "primary", "destructive"] }
    }
  };
  var notificationBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["notificationId", "severity", "title"],
    properties: {
      notificationId: { type: "string", minLength: 1, maxLength: 160 },
      severity: { enum: ["info", "success", "warning", "error", "loading"] },
      title: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", maxLength: 2e3 },
      threadId: { type: "string", maxLength: 128 },
      projectId: { type: "string", maxLength: 128 },
      anchor: { enum: ["global", "thread"] },
      dismissible: { type: "boolean" },
      durationMs: { type: "integer", minimum: 0, maximum: 6e4 },
      actions: {
        type: "array",
        maxItems: 3,
        items: notificationActionSchema
      }
    }
  };
  var CLIENT_NOTIFICATIONS_API = validateApiDefinition({
    id: "t3.client/notifications",
    version: "1.0.0",
    methods: [
      {
        name: "notify",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ notification: notificationBodySchema }, ["notification"]),
        outputSchema: okOutput
      },
      {
        name: "update",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          notificationId: { type: "string", minLength: 1, maxLength: 160 },
          patch: {
            type: "object",
            additionalProperties: false,
            properties: {
              severity: { enum: ["info", "success", "warning", "error", "loading"] },
              title: { type: "string", minLength: 1, maxLength: 200 },
              body: { type: "string", maxLength: 2e3 },
              dismissible: { type: "boolean" }
            }
          }
        }, ["notificationId", "patch"]),
        outputSchema: okOutput
      },
      {
        name: "dismiss",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ notificationId: { type: "string", minLength: 1, maxLength: 160 } }, ["notificationId"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["dismissed"],
          properties: { dismissed: { type: "boolean" } }
        }
      }
    ]
  });
  var commandDescriptorSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "scope"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 80 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 1e3 },
      defaultKey: { type: "string", minLength: 1, maxLength: 64 },
      when: { type: "string", minLength: 1, maxLength: 256 },
      scope: { enum: ["surface", "thread", "global"] },
      activation: {
        type: "object",
        additionalProperties: false,
        required: ["surfaceId", "placement"],
        properties: {
          surfaceId: { type: "string", minLength: 1, maxLength: 160 },
          placement: { enum: ["side-panel", "bottom-dock"] }
        }
      }
    }
  };
  var commandResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["commandId", "status"],
    properties: {
      commandId: { type: "string", minLength: 1, maxLength: 80 },
      status: { enum: ["registered", "rejected"] },
      reason: { type: "string", maxLength: 400 }
    }
  };
  var CLIENT_KEYBINDINGS_API = validateApiDefinition({
    id: "t3.client/keybindings",
    version: "1.0.0",
    methods: [
      {
        name: "registerCommands",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          installationScoped: { type: "boolean" },
          commands: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: commandDescriptorSchema
          }
        }, ["commands"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["commandSetToken", "results"],
          properties: {
            commandSetToken: { type: "string", minLength: 1, maxLength: 160 },
            results: { type: "array", maxItems: 64, items: commandResultSchema }
          }
        }
      },
      {
        name: "unregisterCommands",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ commandSetToken: { type: "string", minLength: 1, maxLength: 160 } }, ["commandSetToken"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["unregistered"],
          properties: { unregistered: { type: "boolean" } }
        }
      },
      {
        name: "listConflicts",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({}),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["conflicts"],
          properties: {
            conflicts: {
              type: "array",
              maxItems: 256,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["command", "key", "winner", "loser"],
                properties: {
                  command: { type: "string", maxLength: 256 },
                  key: { type: "string", maxLength: 64 },
                  winner: { enum: ["user", "native", "plugin"] },
                  loser: { type: "string", maxLength: 256 }
                }
              }
            }
          }
        }
      }
    ]
  });
  var panelThreadInput = {
    threadId: { type: "string", minLength: 1, maxLength: 128 }
  };
  var CLIENT_PANELS_API = validateApiDefinition({
    id: "t3.client/panels",
    version: "1.0.0",
    methods: [
      {
        name: "openSurface",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget(
          {
            surfaceId: { type: "string", minLength: 1, maxLength: 160 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            placement: { enum: ["side-panel", "bottom-dock"] },
            ...panelThreadInput
          },
          // Optional fields mirror the public contract: the client fills them
          // from the surface's own declared metadata when omitted.
          ["surfaceId", "threadId"]
        ),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId"],
          properties: { surfaceId: { type: "string", maxLength: 160 } }
        }
      },
      {
        name: "activateSurface",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          surfaceId: { type: "string", minLength: 1, maxLength: 160 },
          ...panelThreadInput
        }, ["surfaceId", "threadId"]),
        outputSchema: okOutput
      },
      {
        name: "closeSurface",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          surfaceId: { type: "string", minLength: 1, maxLength: 160 },
          ...panelThreadInput
        }, ["surfaceId", "threadId"]),
        outputSchema: okOutput
      },
      {
        name: "listSurfaces",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({ ...panelThreadInput }, ["threadId"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaces"],
          properties: {
            surfaces: {
              type: "array",
              maxItems: 64,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "title", "placement", "active"],
                properties: {
                  id: { type: "string", maxLength: 160 },
                  title: { type: "string", maxLength: 200 },
                  placement: { enum: ["side-panel", "bottom-dock"] },
                  active: { type: "boolean" }
                }
              }
            }
          }
        }
      },
      {
        name: "hideDock",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ ...panelThreadInput }, ["threadId"]),
        outputSchema: okOutput
      },
      {
        name: "showDock",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ ...panelThreadInput }, ["threadId"]),
        outputSchema: okOutput
      }
    ]
  });
  var composerRefSchema = {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1, maxLength: 512 },
      startLine: { type: "integer", minimum: 1, maximum: 1e6 },
      endLine: { type: "integer", minimum: 1, maximum: 1e6 },
      excerpt: { type: "string", maxLength: 512 }
    }
  };
  var composerAnnotationSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["filePath", "startLine", "endLine", "body"],
        properties: {
          filePath: { type: "string", minLength: 1, maxLength: 512 },
          startLine: { type: "integer", minimum: 1, maximum: 1e6 },
          endLine: { type: "integer", minimum: 1, maximum: 1e6 },
          body: { type: "string", minLength: 1, maxLength: 4096 },
          excerpt: { type: "string", maxLength: 4096 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "filePath",
          "sectionId",
          "sectionTitle",
          "rangeLabel",
          "diff",
          "selection",
          "body"
        ],
        properties: {
          kind: { const: "diff" },
          filePath: { type: "string", minLength: 1, maxLength: 512 },
          sectionId: { type: "string", minLength: 1, maxLength: 512 },
          sectionTitle: { type: "string", minLength: 1, maxLength: 256 },
          rangeLabel: { type: "string", minLength: 1, maxLength: 128 },
          diff: { type: "string", minLength: 1, maxLength: 4096 },
          selection: {
            type: "object",
            additionalProperties: false,
            required: ["start", "side", "end", "endSide"],
            properties: {
              start: { type: "integer", minimum: 1, maximum: 1e6 },
              side: { enum: ["additions", "deletions"] },
              end: { type: "integer", minimum: 1, maximum: 1e6 },
              endSide: { enum: ["additions", "deletions"] }
            }
          },
          startIndex: { type: "integer", minimum: 0, maximum: 1e6 },
          endIndex: { type: "integer", minimum: 0, maximum: 1e6 },
          body: { type: "string", minLength: 1, maxLength: 4096 }
        }
      }
    ]
  };
  var composerThreadIdInput = {
    threadId: { type: "string", minLength: 1, maxLength: 128 }
  };
  var CLIENT_COMPOSER_API = validateApiDefinition({
    id: "t3.client/composer",
    version: "1.1.0",
    methods: [
      {
        name: "insertContext",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          threadId: { type: "string", minLength: 1, maxLength: 128 },
          refs: { type: "array", minItems: 1, maxItems: 8, items: composerRefSchema }
        }, ["threadId", "refs"]),
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
        requiredGrants: [],
        inputSchema: withTarget({ threadId: { type: "string", minLength: 1, maxLength: 128 } }, [
          "threadId"
        ]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["draft"],
          properties: {
            draft: {
              type: ["object", "null"],
              properties: {
                prompt: { type: "string", maxLength: 1e4 },
                promptTruncated: { type: "boolean" },
                contextCounts: { type: "object" }
              }
            }
          }
        }
      },
      {
        name: "attachAnnotation",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          ...composerThreadIdInput,
          annotation: composerAnnotationSchema
        }, ["threadId", "annotation"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotationId"],
          properties: { annotationId: { type: "string", minLength: 1, maxLength: 256 } }
        }
      },
      {
        name: "insertMention",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          ...composerThreadIdInput,
          paths: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 512 }
          }
        }, ["threadId", "paths"]),
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
        name: "insertTerminalContext",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          ...composerThreadIdInput,
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          terminalLabel: { type: "string", minLength: 1, maxLength: 128 },
          // 10,000 chars keeps the worst-case escaped frame inside the 64 KiB
          // broker envelope; matches the public catalogue bound.
          lineStart: { type: "integer", minimum: 1, maximum: 1e6 },
          lineEnd: { type: "integer", minimum: 1, maximum: 1e6 },
          text: { type: "string", minLength: 1, maxLength: 1e4 }
        }, ["threadId", "terminalId", "terminalLabel", "lineStart", "lineEnd", "text"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["inserted", "target"],
          properties: {
            inserted: { type: "boolean" },
            target: { type: "string", minLength: 1, maxLength: 256 },
            reason: { type: "string", maxLength: 64 }
          }
        }
      },
      {
        name: "listAnnotations",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({ ...composerThreadIdInput }, ["threadId"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotations"],
          properties: {
            annotations: {
              type: "array",
              // 8 entries at field maxima stay inside the 64 KiB frame envelope.
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["annotationId", "kind", "filePath", "rangeLabel", "sectionTitle"],
                properties: {
                  annotationId: { type: "string", minLength: 1, maxLength: 256 },
                  kind: { enum: ["file", "diff"] },
                  filePath: { type: "string", minLength: 1, maxLength: 512 },
                  rangeLabel: { type: "string", maxLength: 128 },
                  sectionTitle: { type: "string", maxLength: 256 }
                }
              }
            }
          }
        }
      },
      {
        name: "removeAnnotation",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          ...composerThreadIdInput,
          annotationId: { type: "string", minLength: 1, maxLength: 256 }
        }, ["threadId", "annotationId"]),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["removed"],
          properties: { removed: { type: "boolean" } }
        }
      }
    ]
  });
  var CLIENT_TERMINAL_APPEARANCE_API = validateApiDefinition({
    id: "t3.client/terminal-appearance",
    version: "1.0.0",
    methods: [
      {
        name: "getAppearance",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({}),
        outputSchema: terminalAppearanceSchema
      }
    ],
    streams: [
      {
        name: "watchAppearance",
        inputSchema: withTarget({}),
        eventSchema: terminalAppearanceSchema,
        requiredGrants: []
      }
    ]
  });
  var clientPreferencesSchema = {
    type: "object",
    additionalProperties: false,
    required: ["wordWrap"],
    properties: {
      wordWrap: { type: "boolean" }
    }
  };
  var clientPreferencesPatchSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      wordWrap: { type: "boolean" }
    }
  };
  var clientPreferencesReceiptSchema = {
    type: "object",
    additionalProperties: false,
    required: ["applied", "preferences"],
    properties: {
      applied: { type: "boolean" },
      reason: { type: "string", maxLength: 200 },
      preferences: clientPreferencesSchema
    }
  };
  var CLIENT_PREFERENCES_API = validateApiDefinition({
    id: "t3.client/preferences",
    version: "1.0.0",
    methods: [
      {
        name: "getPreferences",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({}),
        outputSchema: clientPreferencesSchema
      },
      {
        name: "applyPreferences",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          writer: { type: "string", minLength: 1, maxLength: 160 },
          patch: clientPreferencesPatchSchema
        }, ["writer", "patch"]),
        outputSchema: clientPreferencesReceiptSchema
      }
    ],
    streams: [
      {
        name: "watchPreferences",
        inputSchema: withTarget({}),
        eventSchema: clientPreferencesSchema,
        requiredGrants: []
      }
    ]
  });
  var CLIENT_PROVIDER_APIS = new Map([
    CLIENT_THEME_API,
    CLIENT_NOTIFICATIONS_API,
    CLIENT_KEYBINDINGS_API,
    CLIENT_PANELS_API,
    CLIENT_COMPOSER_API,
    CLIENT_TERMINAL_APPEARANCE_API,
    CLIENT_PREFERENCES_API
  ].map((definition) => [definition.id, definition]));

  // node_modules/@t3tools/extension-sdk/dist/catalogue.js
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
  var PROVIDERS_STATUS = "t3.providers/status";
  var PROVIDERS_READ = "t3.providers/read";
  var PROVIDER_STATUS_DISPLAY_NAME_MAX_LENGTH = 200;
  var PROVIDER_STATUS_ENTRY_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["instanceId", "driver", "enabled", "installed", "status", "availability", "checkedAt"],
    properties: {
      instanceId: { type: "string", minLength: 1, maxLength: 160 },
      driver: { type: "string", minLength: 1, maxLength: 64 },
      displayName: {
        type: "string",
        minLength: 1,
        maxLength: PROVIDER_STATUS_DISPLAY_NAME_MAX_LENGTH
      },
      enabled: { type: "boolean" },
      installed: { type: "boolean" },
      status: { enum: ["ready", "warning", "error", "disabled"] },
      availability: { enum: ["available", "unavailable"] },
      checkedAt: { type: "string", minLength: 1, maxLength: 40 },
      supportsConversationRollback: { type: "boolean" },
      supportsTextGeneration: { type: "boolean" },
      requiresNewThreadForModelChange: { type: "boolean" },
      showInteractionModeToggle: { type: "boolean" },
      reportsContextWindow: { type: "boolean" }
    }
  };
  var providersStatusApi = defineStreamApi({
    id: PROVIDERS_STATUS,
    version: "1.0.0",
    methods: [],
    streams: [
      {
        name: "subscribe",
        requiredGrants: [PROVIDERS_READ],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        eventSchema: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "scope", "providers"],
          properties: {
            kind: { const: "snapshot" },
            scope: { const: "environment" },
            providers: { type: "array", maxItems: 64, items: PROVIDER_STATUS_ENTRY_SCHEMA }
          }
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
          "clearGeneration",
          "contentsUnitStart",
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
          clearGeneration: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          contentsUnitStart: {
            type: "integer",
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER
          },
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
        required: ["kind", "terminalId", "streamEpoch", "sequence", "clearGeneration", "reason"],
        properties: {
          kind: { const: "reset" },
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
          sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          clearGeneration: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
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
          kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"] },
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
        name: "releasePresentation",
        // Acquired under the same read-scoped grant as `createPresentationUrl`;
        // releasing your own held claim is not a write of host state beyond what
        // the read grant already entitles the caller to hold. A `write` effect
        // would require a write-scope the minting caller never had, making the
        // release unreachable through the broker for the only callers it serves.
        effect: "read",
        // Only a held `browser-surface` claim can be released, and only by the
        // authority that holds it — enforced inside the host adapter.
        requiredGrants: [],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["presentationUrl"],
          properties: {
            // The value `createPresentationUrl` returned (`/api/assets/<token>/…`)
            // or the bare signed token.
            presentationUrl: { type: "string", minLength: 1, maxLength: 4096 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["released"],
          properties: { released: { type: "boolean" } }
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
      kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"] },
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
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"] },
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
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"] },
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
      provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"] },
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
  var VCS_ACTIONS = "t3.vcs/actions";
  var vcsActionKindSchema = {
    enum: ["commit", "push", "create_pr", "commit_push", "commit_push_pr"]
  };
  var vcsActionPhaseSchema = { enum: ["branch", "commit", "push", "pr"] };
  var vcsActionMessageSourceSchema = { enum: ["caller", "generated", "not_applicable"] };
  var vcsActionContentSourceSchema = {
    enum: ["caller", "generated", "existing", "not_applicable"]
  };
  var vcsActionResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["action", "branch", "commit", "push", "pr", "toast"],
    properties: {
      action: vcsActionKindSchema,
      branch: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: { enum: ["created", "skipped_not_requested"] },
          name: { type: "string", minLength: 1, maxLength: 4096 }
        }
      },
      commit: {
        type: "object",
        additionalProperties: false,
        required: ["status", "messageSource"],
        properties: {
          status: { enum: ["created", "skipped_no_changes", "skipped_not_requested"] },
          commitSha: { type: "string", minLength: 1, maxLength: 128 },
          subject: { type: "string", minLength: 1, maxLength: 4096 },
          messageSource: vcsActionMessageSourceSchema
        }
      },
      push: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: { enum: ["pushed", "skipped_not_requested", "skipped_up_to_date"] },
          branch: { type: "string", minLength: 1, maxLength: 4096 },
          upstreamBranch: { type: "string", minLength: 1, maxLength: 4096 },
          setUpstream: { type: "boolean" }
        }
      },
      pr: {
        type: "object",
        additionalProperties: false,
        required: ["status", "contentSource"],
        properties: {
          status: { enum: ["created", "opened_existing", "skipped_not_requested"] },
          url: { type: "string", minLength: 1, maxLength: 4096 },
          number: { type: "integer", minimum: 1 },
          baseBranch: { type: "string", minLength: 1, maxLength: 4096 },
          headBranch: { type: "string", minLength: 1, maxLength: 4096 },
          title: { type: "string", minLength: 1, maxLength: 2048 },
          contentSource: vcsActionContentSourceSchema
        }
      },
      toast: {
        type: "object",
        additionalProperties: false,
        required: ["title", "cta"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 512 },
          description: { type: "string", minLength: 1, maxLength: 1024 },
          cta: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "none" } }
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "label", "url"],
                properties: {
                  kind: { const: "open_pr" },
                  label: { type: "string", minLength: 1, maxLength: 256 },
                  url: { type: "string", maxLength: 4096 }
                }
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "label", "action"],
                properties: {
                  kind: { const: "run_action" },
                  label: { type: "string", minLength: 1, maxLength: 256 },
                  action: {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind"],
                    properties: { kind: vcsActionKindSchema }
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
  var vcsActionEventBase = {
    action: vcsActionKindSchema
  };
  var vcsActionProgressEventSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "phases"],
        properties: {
          kind: { const: "action_started" },
          ...vcsActionEventBase,
          phases: { type: "array", maxItems: 4, items: vcsActionPhaseSchema }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "phase", "label"],
        properties: {
          kind: { const: "phase_started" },
          ...vcsActionEventBase,
          phase: vcsActionPhaseSchema,
          label: { type: "string", minLength: 1, maxLength: 1024 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "hookName"],
        properties: {
          kind: { const: "hook_started" },
          ...vcsActionEventBase,
          hookName: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "hookName", "stream", "text"],
        properties: {
          kind: { const: "hook_output" },
          ...vcsActionEventBase,
          hookName: { type: ["string", "null"], minLength: 1, maxLength: 512 },
          stream: { enum: ["stdout", "stderr"] },
          // Native bounds hook lines at 500 chars; keep slack for future raises.
          text: { type: "string", minLength: 1, maxLength: 4096 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "hookName", "exitCode", "durationMs"],
        properties: {
          kind: { const: "hook_finished" },
          ...vcsActionEventBase,
          hookName: { type: "string", minLength: 1, maxLength: 512 },
          exitCode: { type: ["integer", "null"] },
          durationMs: { type: ["integer", "null"], minimum: 0 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "result"],
        properties: {
          kind: { const: "action_finished" },
          ...vcsActionEventBase,
          result: vcsActionResultSchema
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "phase", "message"],
        properties: {
          kind: { const: "action_failed" },
          ...vcsActionEventBase,
          phase: { type: ["string", "null"], enum: ["branch", "commit", "push", "pr", null] },
          message: { type: "string", minLength: 1, maxLength: 4096 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "reason"],
        properties: {
          kind: { const: "closed" },
          reason: { enum: ["overflow", "authorization-revoked"] }
        }
      }
    ]
  };
  var vcsActionResolvedPullRequestSchema = {
    type: "object",
    additionalProperties: false,
    required: ["number", "title", "url", "baseBranch", "headBranch", "state"],
    properties: {
      number: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 1, maxLength: 2048 },
      url: { type: "string", maxLength: 4096 },
      baseBranch: { type: "string", minLength: 1, maxLength: 4096 },
      headBranch: { type: "string", minLength: 1, maxLength: 4096 },
      state: { enum: ["open", "closed", "merged"] }
    }
  };
  var vcsActionReferenceInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["reference"],
    properties: {
      reference: { type: "string", minLength: 1, maxLength: 2048 }
    }
  };
  var vcsActionsOperationsSupportSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "actions.run",
      "actions.resolvePullRequest",
      "actions.preparePullRequestThread",
      "actions.publishRepository",
      "actions.actionProgress"
    ],
    properties: {
      "actions.run": { type: "boolean" },
      "actions.resolvePullRequest": { type: "boolean" },
      "actions.preparePullRequestThread": { type: "boolean" },
      "actions.publishRepository": { type: "boolean" },
      "actions.actionProgress": { type: "boolean" }
    }
  };
  var vcsActionsCapabilitiesResultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["detected", "kind", "detail", "driver", "operations"],
    properties: {
      detected: { type: "boolean" },
      kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
      detail: { type: ["string", "null"], maxLength: 512 },
      driver: vcsDriverCapabilitiesSchema,
      operations: vcsActionsOperationsSupportSchema
    }
  };
  var vcsActionsApi = defineStreamApi({
    id: VCS_ACTIONS,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: prsEmptyInputSchema,
        outputSchema: vcsActionsCapabilitiesResultSchema
      },
      {
        name: "run",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            action: vcsActionKindSchema,
            commitMessage: { type: "string", maxLength: 1e4 },
            featureBranch: { type: "boolean" },
            paths: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 512 }
            }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["actionId"],
          properties: { actionId: { type: "string", minLength: 1, maxLength: 128 } }
        }
      },
      {
        name: "resolvePullRequest",
        // Read-shaped but Operate-gated: it shells the provider CLI, matching
        // the native RPC's Operate scope (design: `t3.vcs/mutate`).
        effect: "read",
        requiredGrants: [VCS_MUTATE],
        inputSchema: vcsActionReferenceInputSchema,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["pullRequest"],
          properties: { pullRequest: vcsActionResolvedPullRequestSchema }
        }
      },
      {
        name: "preparePullRequestThread",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["reference", "mode"],
          properties: {
            reference: { type: "string", minLength: 1, maxLength: 2048 },
            mode: { enum: ["local", "worktree"] }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["pullRequest", "branch", "worktreePath", "isOnPullRequestHead"],
          properties: {
            pullRequest: vcsActionResolvedPullRequestSchema,
            branch: { type: "string", minLength: 1, maxLength: 4096 },
            worktreePath: { type: ["string", "null"], minLength: 1, maxLength: 32768 },
            isOnPullRequestHead: { type: "boolean" }
          }
        }
      },
      {
        name: "publishRepository",
        // Declared `t3.vcs/mutate`; the adapter additionally requires every
        // caller in the chain to hold `t3.prs/write` (P-a conjunctive under
        // G3 — a comment-only grant must never reach pushCurrentBranch).
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "repository", "visibility"],
          properties: {
            provider: {
              enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"]
            },
            repository: { type: "string", minLength: 1, maxLength: 512 },
            visibility: { enum: ["private", "public"] },
            remoteName: { type: "string", minLength: 1, maxLength: 256 },
            protocol: { enum: ["auto", "ssh", "https"] }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "remoteName", "remoteUrl", "branch", "status"],
          properties: {
            repository: {
              type: "object",
              additionalProperties: false,
              required: ["provider", "nameWithOwner", "url", "sshUrl"],
              properties: {
                provider: {
                  enum: ["github", "gitlab", "azure-devops", "bitbucket", "forgejo", "unknown"]
                },
                nameWithOwner: { type: "string", minLength: 1, maxLength: 512 },
                url: { type: "string", minLength: 1, maxLength: 4096 },
                sshUrl: { type: "string", minLength: 1, maxLength: 4096 }
              }
            },
            remoteName: { type: "string", minLength: 1, maxLength: 256 },
            remoteUrl: { type: "string", minLength: 1, maxLength: 4096 },
            branch: { type: "string", minLength: 1, maxLength: 4096 },
            upstreamBranch: { type: "string", minLength: 1, maxLength: 4096 },
            status: { enum: ["pushed", "remote_added"] }
          }
        }
      }
    ],
    streams: [
      {
        name: "actionProgress",
        requiredGrants: [VCS_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["actionId"],
          properties: { actionId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        eventSchema: vcsActionProgressEventSchema
      }
    ]
  });
  var VCS_ACTIONS_API = vcsActionsApi.definition;
  var PRS_WRITE = "t3.prs/write";
  var prsWriteBodySchema = { type: "string", minLength: 1, maxLength: 65536 };
  var prsWriteOperationsSupportSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "prs.runAction",
      "prs.update",
      "prs.comment",
      "prs.updateComment",
      "prs.submitReview",
      "prs.replyToThread",
      "prs.setThreadResolution",
      "prs.setReaction",
      "prs.requestReviewers",
      "prs.setLabels"
    ],
    properties: {
      "prs.runAction": { type: "boolean" },
      "prs.update": { type: "boolean" },
      "prs.comment": { type: "boolean" },
      "prs.updateComment": { type: "boolean" },
      "prs.submitReview": { type: "boolean" },
      "prs.replyToThread": { type: "boolean" },
      "prs.setThreadResolution": { type: "boolean" },
      "prs.setReaction": { type: "boolean" },
      "prs.requestReviewers": { type: "boolean" },
      "prs.setLabels": { type: "boolean" }
    }
  };
  var prsWriteActionKindSchema = {
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
  };
  var prsWriteMergeMethodSchema = { enum: ["merge", "squash", "rebase"] };
  var prsWriteVerdictSchema = { enum: ["comment", "approve", "request-changes"] };
  var prsWriteCapabilitiesResultSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "hosted",
      "reason",
      "detail",
      "operations",
      "actions",
      "mergeMethods",
      "updateMethods",
      "verdicts"
    ],
    properties: {
      hosted: { type: "boolean" },
      reason: {
        enum: ["cli-missing", "cli-unauthenticated", "provider-unsupported", null]
      },
      detail: { type: ["string", "null"], maxLength: 1024 },
      operations: prsWriteOperationsSupportSchema,
      actions: { type: "array", maxItems: 16, items: prsWriteActionKindSchema },
      mergeMethods: { type: "array", maxItems: 8, items: prsWriteMergeMethodSchema },
      updateMethods: {
        type: "array",
        maxItems: 4,
        items: { enum: ["merge", "rebase"] }
      },
      verdicts: { type: "array", maxItems: 8, items: prsWriteVerdictSchema }
    }
  };
  var prsWriteActionInputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["repository", "number", "action"],
    properties: {
      host: prsHostField,
      repository: prsRepositoryField,
      number: { type: "integer", minimum: 1 },
      action: prsWriteActionKindSchema,
      mergeMethod: prsWriteMergeMethodSchema,
      updateMethod: { enum: ["merge", "rebase"] },
      stackNumber: { type: "integer", minimum: 1 },
      expectedStackHeads: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "headSha"],
          properties: {
            number: { type: "integer", minimum: 1 },
            headSha: { type: "string", minLength: 1, maxLength: 128 }
          }
        }
      }
    }
  };
  var prsWriteReviewCommentDraftSchema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "position", "body"],
    properties: {
      path: { type: "string", minLength: 1, maxLength: 1024 },
      oldPath: { type: "string", minLength: 1, maxLength: 1024 },
      position: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "newLine"],
            properties: {
              kind: { const: "added" },
              newLine: { type: "integer", minimum: 1 }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "oldLine"],
            properties: {
              kind: { const: "deleted" },
              oldLine: { type: "integer", minimum: 1 }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "oldLine", "newLine", "side"],
            properties: {
              kind: { const: "context" },
              oldLine: { type: "integer", minimum: 1 },
              newLine: { type: "integer", minimum: 1 },
              side: { enum: ["left", "right"] }
            }
          }
        ]
      },
      body: prsWriteBodySchema
    }
  };
  var prsWriteApi = defineApi({
    id: PRS_WRITE,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [PRS_WRITE],
        inputSchema: prsEmptyInputSchema,
        outputSchema: prsWriteCapabilitiesResultSchema
      },
      {
        name: "runAction",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: prsWriteActionInputSchema,
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "update",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            title: { type: "string", minLength: 1, maxLength: 1024 },
            body: { type: "string", maxLength: 65536 }
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "comment",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "body"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            body: prsWriteBodySchema
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "updateComment",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "commentId", "kind", "body"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            commentId: { type: "string", minLength: 1, maxLength: 512 },
            kind: { enum: ["issue-comment", "review-comment"] },
            body: prsWriteBodySchema
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "submitReview",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "verdict", "body", "comments"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            verdict: { enum: ["comment", "approve", "request-changes"] },
            body: { type: "string", maxLength: 65536 },
            comments: { type: "array", maxItems: 100, items: prsWriteReviewCommentDraftSchema }
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "replyToThread",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "threadId", "body"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            threadId: { type: "string", minLength: 1, maxLength: 512 },
            body: prsWriteBodySchema
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "setThreadResolution",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "threadId", "resolved"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            threadId: { type: "string", minLength: 1, maxLength: 512 },
            resolved: { type: "boolean" }
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "setReaction",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "content", "reacted"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            subjectId: { type: "string", minLength: 1, maxLength: 512 },
            content: {
              enum: [
                "thumbs-up",
                "thumbs-down",
                "laugh",
                "hooray",
                "confused",
                "heart",
                "rocket",
                "eyes"
              ]
            },
            reacted: { type: "boolean" }
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "requestReviewers",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "reviewers", "requested"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            reviewers: {
              type: "array",
              minItems: 1,
              maxItems: 25,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "kind"],
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 512 },
                  kind: { enum: ["user", "team"] }
                }
              }
            },
            requested: { type: "boolean" }
          }
        },
        outputSchema: prsEmptyOutputSchema
      },
      {
        name: "setLabels",
        effect: "write",
        requiredGrants: [PRS_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["repository", "number", "labels", "applied"],
          properties: {
            host: prsHostField,
            repository: prsRepositoryField,
            number: { type: "integer", minimum: 1 },
            labels: {
              type: "array",
              minItems: 1,
              maxItems: 25,
              items: { type: "string", minLength: 1, maxLength: 512 }
            },
            applied: { type: "boolean" }
          }
        },
        outputSchema: prsEmptyOutputSchema
      }
    ]
  });
  var PRS_WRITE_API = prsWriteApi.definition;
  var BROWSER_OPERATE = "t3.browser/operate";
  var BROWSER_SESSION_COMMANDS = [
    "back",
    "forward",
    "reload",
    "hardReload",
    "resize",
    "zoom",
    "setAppearance",
    "setAudioMuted"
  ];
  var BROWSER_SESSION_URL_MAX_LENGTH = 2048;
  var BROWSER_SESSION_TITLE_MAX_LENGTH = 512;
  var BROWSER_SESSION_LIMIT = 64;
  var browserSessionTabId = {
    type: "string",
    minLength: 1,
    maxLength: 128
  };
  var browserSessionEpoch = {
    type: "string",
    minLength: 1,
    maxLength: 128
  };
  var browserSessionRevision = { type: "integer", minimum: 0 };
  var browserSessionUrl = {
    type: "string",
    minLength: 1,
    maxLength: BROWSER_SESSION_URL_MAX_LENGTH
  };
  var browserSessionViewport = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag"],
        properties: { _tag: { const: "fill" } }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "width", "height"],
        properties: {
          _tag: { const: "freeform" },
          width: { type: "integer", minimum: 240, maximum: 3840 },
          height: { type: "integer", minimum: 240, maximum: 3840 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["_tag", "width", "height", "presetId"],
        properties: {
          _tag: { const: "preset" },
          width: { type: "integer", minimum: 240, maximum: 3840 },
          height: { type: "integer", minimum: 240, maximum: 3840 },
          presetId: { type: "string", minLength: 1, maxLength: 64 }
        }
      }
    ]
  };
  var browserSessionObject = {
    type: "object",
    additionalProperties: false,
    required: [
      "tabId",
      "requestedUrl",
      "navigation",
      "canGoBack",
      "canGoForward",
      "viewport",
      "engine",
      "zoomFactor",
      "appearance",
      "audioMuted",
      "audible"
    ],
    properties: {
      tabId: browserSessionTabId,
      requestedUrl: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: BROWSER_SESSION_URL_MAX_LENGTH
      },
      navigation: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "url", "title"],
        properties: {
          kind: { enum: ["idle", "pending", "loading", "loaded", "failed"] },
          url: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: BROWSER_SESSION_URL_MAX_LENGTH
          },
          title: { type: "string", maxLength: BROWSER_SESSION_TITLE_MAX_LENGTH },
          failureCode: {
            enum: [
              "aborted",
              "dns",
              "offline",
              "timeout",
              "refused",
              "reset",
              "certificate",
              "blocked",
              "redirect",
              "invalid-url",
              "crash",
              "unknown"
            ]
          }
        }
      },
      canGoBack: { type: "boolean" },
      canGoForward: { type: "boolean" },
      viewport: browserSessionViewport,
      profileId: { type: "string", minLength: 1, maxLength: 64 },
      engine: {
        type: "object",
        additionalProperties: false,
        required: ["state", "generation"],
        properties: {
          state: { enum: ["unavailable", "starting", "ready", "recovering", "crashed"] },
          generation: { type: ["string", "null"], minLength: 1, maxLength: 128 },
          reason: { type: "string", minLength: 1, maxLength: 256 }
        }
      },
      zoomFactor: { type: ["number", "null"] },
      appearance: { enum: ["system", "light", "dark", null] },
      audioMuted: { type: ["boolean", "null"] },
      audible: { type: ["boolean", "null"] }
    }
  };
  var browserSessionReceipt = {
    type: "object",
    additionalProperties: false,
    required: ["commandId", "outcome", "serverEpoch", "revision", "session"],
    properties: {
      commandId: { type: "string", minLength: 1, maxLength: 64 },
      outcome: { enum: ["accepted", "rejected", "unknown"] },
      serverEpoch: browserSessionEpoch,
      revision: browserSessionRevision,
      session: browserSessionObject
    }
  };
  var browserSessionCommandGuard = {
    tabId: browserSessionTabId,
    serverEpoch: browserSessionEpoch,
    expectedEngineGeneration: { type: ["string", "null"], minLength: 1, maxLength: 128 }
  };
  var browserSessionGuardRequired = ["tabId", "serverEpoch", "expectedEngineGeneration"];
  var browserSessionCommandMethod = (name, extraProperties = {}, extraRequired = []) => ({
    name,
    effect: "write",
    requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [...browserSessionGuardRequired, ...extraRequired],
      properties: { ...browserSessionCommandGuard, ...extraProperties }
    },
    outputSchema: browserSessionReceipt
  });
  var BROWSER_SESSION_ZOOM_LEVELS = [
    0.25,
    0.33,
    0.5,
    0.67,
    0.75,
    0.8,
    0.9,
    1,
    1.1,
    1.25,
    1.5,
    1.75,
    2,
    2.5,
    3,
    4,
    5
  ];
  var browserSessionEmptyInput = {
    type: "object",
    additionalProperties: false,
    properties: {}
  };
  var browserSessionsApi = defineStreamApi({
    id: BROWSER_SESSIONS,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [BROWSER_SESSIONS],
        inputSchema: browserSessionEmptyInput,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["metadata", "presentation", "commands"],
          properties: {
            metadata: {
              type: "object",
              additionalProperties: false,
              required: ["supported"],
              properties: { supported: { const: true } }
            },
            presentation: {
              type: "object",
              additionalProperties: false,
              required: ["supported"],
              properties: {
                supported: { type: "boolean" },
                reason: { enum: ["desktop-required"] }
              }
            },
            commands: {
              type: "array",
              maxItems: BROWSER_SESSION_COMMANDS.length,
              uniqueItems: true,
              items: { enum: [...BROWSER_SESSION_COMMANDS] }
            }
          }
        }
      },
      {
        name: "list",
        effect: "read",
        requiredGrants: [BROWSER_SESSIONS],
        inputSchema: browserSessionEmptyInput,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["serverEpoch", "revision", "sessions"],
          properties: {
            serverEpoch: browserSessionEpoch,
            revision: browserSessionRevision,
            sessions: {
              type: "array",
              maxItems: BROWSER_SESSION_LIMIT,
              items: browserSessionObject
            }
          }
        }
      },
      {
        name: "open",
        effect: "write",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: browserSessionUrl,
            viewport: browserSessionViewport,
            profileId: { type: "string", minLength: 1, maxLength: 64 }
          }
        },
        outputSchema: browserSessionReceipt
      },
      {
        name: "navigate",
        effect: "write",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["tabId", "serverEpoch", "url", "expectedEngineGeneration"],
          properties: { ...browserSessionCommandGuard, url: browserSessionUrl }
        },
        outputSchema: browserSessionReceipt
      },
      {
        name: "close",
        effect: "write",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["tabId", "serverEpoch"],
          properties: { tabId: browserSessionTabId, serverEpoch: browserSessionEpoch }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["outcome", "serverEpoch", "revision"],
          properties: {
            outcome: { enum: ["closed", "already-closed"] },
            serverEpoch: browserSessionEpoch,
            revision: browserSessionRevision
          }
        }
      },
      browserSessionCommandMethod("back"),
      browserSessionCommandMethod("forward"),
      browserSessionCommandMethod("reload"),
      browserSessionCommandMethod("hardReload"),
      browserSessionCommandMethod("resize", { viewport: browserSessionViewport }, ["viewport"]),
      browserSessionCommandMethod("zoom", { zoomFactor: { enum: [...BROWSER_SESSION_ZOOM_LEVELS] } }, ["zoomFactor"]),
      browserSessionCommandMethod("setAppearance", { appearance: { enum: ["system", "light", "dark"] } }, ["appearance"]),
      browserSessionCommandMethod("setAudioMuted", { muted: { type: "boolean" } }, ["muted"])
    ],
    streams: [
      {
        name: "events",
        requiredGrants: [BROWSER_SESSIONS],
        inputSchema: browserSessionEmptyInput,
        eventSchema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "snapshotId", "serverEpoch", "revision", "sessionCount"],
              properties: {
                kind: { const: "snapshot-start" },
                snapshotId: { type: "string", minLength: 1, maxLength: 64 },
                serverEpoch: browserSessionEpoch,
                revision: browserSessionRevision,
                sessionCount: { type: "integer", minimum: 0, maximum: BROWSER_SESSION_LIMIT }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "snapshotId", "chunkIndex", "sessions"],
              properties: {
                kind: { const: "snapshot-chunk" },
                snapshotId: { type: "string", minLength: 1, maxLength: 64 },
                chunkIndex: { type: "integer", minimum: 0 },
                sessions: {
                  type: "array",
                  maxItems: BROWSER_SESSION_LIMIT,
                  items: browserSessionObject
                }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "snapshotId", "serverEpoch", "revision", "sessionCount"],
              properties: {
                kind: { const: "snapshot-complete" },
                snapshotId: { type: "string", minLength: 1, maxLength: 64 },
                serverEpoch: browserSessionEpoch,
                revision: browserSessionRevision,
                sessionCount: { type: "integer", minimum: 0, maximum: BROWSER_SESSION_LIMIT }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "revision", "session"],
              properties: {
                kind: { const: "session-upsert" },
                revision: browserSessionRevision,
                session: browserSessionObject
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "revision", "tabId", "reason"],
              properties: {
                kind: { const: "session-removed" },
                revision: browserSessionRevision,
                tabId: browserSessionTabId,
                reason: { enum: ["user-closed", "thread-deleted"] }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "reason"],
              properties: {
                kind: { const: "closed" },
                reason: {
                  enum: [
                    "epoch-changed",
                    "host-disconnected",
                    "scope-invalidated",
                    "grant-revoked",
                    "installation-changed",
                    "overflow",
                    "source-unavailable"
                  ]
                }
              }
            }
          ]
        }
      }
    ]
  });
  var BROWSER_SESSIONS_API = browserSessionsApi.definition;
  var BROWSER_FRAMES = "t3.browser/frames";
  var BROWSER_FRAMES_VERSION = "1.0.0";
  var browserFrameSessionIdentity = {
    type: "object",
    additionalProperties: false,
    required: ["environmentId", "threadId", "serverEpoch", "tabId", "engineGeneration"],
    properties: {
      environmentId: { type: "string", minLength: 1, maxLength: 128 },
      threadId: { type: "string", minLength: 1, maxLength: 128 },
      serverEpoch: { type: "string", minLength: 1, maxLength: 128 },
      tabId: browserSessionTabId,
      engineGeneration: { type: ["string", "null"], minLength: 1, maxLength: 128 }
    }
  };
  var browserFrameTarget = {
    type: "object",
    additionalProperties: false,
    required: ["tabId", "serverEpoch", "surfaceLease"],
    properties: {
      tabId: browserSessionTabId,
      serverEpoch: browserSessionEpoch,
      expectedEngineGeneration: { type: ["string", "null"], minLength: 1, maxLength: 128 },
      /**
       * Held-presentation evidence: a `browser-surface` claim token minted
       * through `t3.resources/lease` `createPresentationUrl` for this exact
       * session tuple. Minting a frame ticket without one is denied.
       */
      surfaceLease: { type: "string", minLength: 1, maxLength: 4096 }
    }
  };
  var browserFrameStreamDescriptor = {
    type: "object",
    additionalProperties: false,
    required: ["session", "hostId", "paths", "ticket", "expiresAt"],
    properties: {
      session: browserFrameSessionIdentity,
      hostId: { type: ["string", "null"], minLength: 1, maxLength: 128 },
      paths: {
        type: "object",
        additionalProperties: false,
        required: ["stream", "snapshot", "config"],
        properties: {
          stream: { type: "string", minLength: 1, maxLength: 512 },
          snapshot: { type: "string", minLength: 1, maxLength: 512 },
          config: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      ticket: { type: "string", minLength: 1, maxLength: 256 },
      expiresAt: { type: "integer", minimum: 1 }
    }
  };
  var browserFrameInputLease = {
    type: "object",
    additionalProperties: false,
    required: ["leaseId", "inputTicket", "expiresAt", "paths"],
    properties: {
      leaseId: { type: "string", minLength: 1, maxLength: 128 },
      inputTicket: { type: "string", minLength: 1, maxLength: 256 },
      expiresAt: { type: "integer", minimum: 1 },
      paths: {
        type: "object",
        additionalProperties: false,
        required: ["input"],
        properties: { input: { type: "string", minLength: 1, maxLength: 512 } }
      }
    }
  };
  var browserFramesApi = defineApi({
    id: BROWSER_FRAMES,
    version: BROWSER_FRAMES_VERSION,
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [BROWSER_FRAMES],
        inputSchema: browserSessionEmptyInput,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["metadata", "stream", "input"],
          properties: {
            metadata: {
              type: "object",
              additionalProperties: false,
              required: ["supported"],
              properties: { supported: { const: true } }
            },
            stream: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["supported"],
                  properties: { supported: { const: true } }
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["supported", "reason"],
                  properties: {
                    supported: { const: false },
                    reason: { enum: ["engine-unavailable"] }
                  }
                }
              ]
            },
            input: {
              type: "object",
              additionalProperties: false,
              required: ["supported"],
              properties: { supported: { type: "boolean" } }
            }
          }
        }
      },
      {
        name: "openStream",
        effect: "read",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_FRAMES],
        inputSchema: browserFrameTarget,
        outputSchema: browserFrameStreamDescriptor
      },
      {
        name: "openInput",
        effect: "write",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_FRAMES],
        inputSchema: browserFrameTarget,
        outputSchema: browserFrameInputLease
      },
      {
        name: "closeInput",
        effect: "write",
        requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_FRAMES],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["leaseId"],
          properties: {
            leaseId: { type: "string", minLength: 1, maxLength: 128 },
            // The closing slot's own presentation claim — leases are keyed to
            // the slot that minted them, so a close without it names no slot.
            surfaceLease: { type: "string", minLength: 1, maxLength: 2048 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["closed"],
          properties: { closed: { type: "boolean" } }
        }
      }
    ]
  });
  var BROWSER_FRAMES_API = browserFramesApi.definition;
  var COMPOSER_CONTEXT = "t3.composer/context";
  var COMPOSER_WRITE = "t3.composer/write";
  var MESSAGES_ENRICHMENT = "t3.messages/enrichment";
  var MESSAGES_WRITE = "t3.messages/write";
  var composerThreadIdInput2 = { type: "string", minLength: 1, maxLength: 128 };
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
  var composerTerminalIdInput = { type: "string", minLength: 1, maxLength: 128 };
  var composerTerminalTextInput = { type: "string", minLength: 1, maxLength: 1e4 };
  var composerInsertResultOutput = {
    type: "object",
    additionalProperties: false,
    required: ["inserted", "target"],
    properties: {
      inserted: { type: "integer", minimum: 0, maximum: 8 },
      target: { type: "string", minLength: 1, maxLength: 256 }
    }
  };
  var annotationSelectionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["start", "side", "end", "endSide"],
    properties: {
      start: composerLineInput,
      side: { enum: ["additions", "deletions"] },
      end: composerLineInput,
      endSide: { enum: ["additions", "deletions"] }
    }
  };
  var diffAnnotationSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "filePath",
      "sectionId",
      "sectionTitle",
      "rangeLabel",
      "diff",
      "selection",
      "body"
    ],
    properties: {
      kind: { const: "diff" },
      filePath: { type: "string", minLength: 1, maxLength: 512 },
      sectionId: { type: "string", minLength: 1, maxLength: 512 },
      sectionTitle: { type: "string", minLength: 1, maxLength: 256 },
      rangeLabel: { type: "string", minLength: 1, maxLength: 128 },
      diff: { type: "string", minLength: 1, maxLength: 4096 },
      selection: annotationSelectionSchema,
      startIndex: { type: "integer", minimum: 0, maximum: 1e6 },
      endIndex: { type: "integer", minimum: 0, maximum: 1e6 },
      body: { type: "string", minLength: 1, maxLength: 4096 }
    }
  };
  var composerContextApi = defineApi({
    id: COMPOSER_CONTEXT,
    version: "1.1.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        // Capability discovery is grant-free so callers can tell "no capability"
        // apart from "no grant" — authority gates the mutations, not the report.
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: composerTransportOutput([
          "insertContext",
          "getDraftState",
          "insertMention",
          "insertTerminalContext"
        ])
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
            threadId: composerThreadIdInput2,
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
          properties: { threadId: composerThreadIdInput2 }
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
      },
      {
        name: "insertMention",
        effect: "write",
        requiredGrants: [COMPOSER_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["paths"],
          properties: {
            threadId: composerThreadIdInput2,
            paths: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 512 }
            }
          }
        },
        outputSchema: composerInsertResultOutput
      },
      {
        name: "insertTerminalContext",
        effect: "write",
        requiredGrants: [COMPOSER_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["terminalId", "terminalLabel", "lineStart", "lineEnd", "text"],
          properties: {
            threadId: composerThreadIdInput2,
            terminalId: composerTerminalIdInput,
            terminalLabel: composerTerminalIdInput,
            lineStart: composerLineInput,
            lineEnd: composerLineInput,
            text: composerTerminalTextInput
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["inserted", "target"],
          properties: {
            inserted: { type: "boolean" },
            reason: { enum: ["duplicate"] },
            target: { type: "string", minLength: 1, maxLength: 256 }
          }
        }
      }
    ]
  });
  var messagesEnrichmentApi = defineApi({
    id: MESSAGES_ENRICHMENT,
    version: "1.1.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: composerTransportOutput([
          "attachAnnotation",
          "listAnnotations",
          "removeAnnotation"
        ])
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
            threadId: composerThreadIdInput2,
            annotation: {
              oneOf: [
                {
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
                },
                diffAnnotationSchema
              ]
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
      },
      {
        name: "listAnnotations",
        effect: "read",
        // Lists the caller's own unsent annotations only, but the draft itself
        // is the user's unsent words — same write-authority stance as
        // getDraftState on the composer contract.
        requiredGrants: [MESSAGES_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { threadId: composerThreadIdInput2 }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotations"],
          properties: {
            annotations: {
              // 8 entries at field maxima stay inside the 64 KiB frame envelope.
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["annotationId", "kind", "filePath", "rangeLabel", "sectionTitle"],
                properties: {
                  annotationId: { type: "string", minLength: 1, maxLength: 256 },
                  kind: { enum: ["file", "diff"] },
                  filePath: { type: "string", minLength: 1, maxLength: 512 },
                  rangeLabel: { type: "string", minLength: 1, maxLength: 128 },
                  sectionTitle: { type: "string", minLength: 1, maxLength: 256 }
                }
              }
            }
          }
        }
      },
      {
        name: "removeAnnotation",
        effect: "write",
        requiredGrants: [MESSAGES_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["annotationId"],
          properties: {
            threadId: composerThreadIdInput2,
            annotationId: { type: "string", minLength: 1, maxLength: 256 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["removed"],
          properties: { removed: { type: "boolean" } }
        }
      }
    ]
  });
  var COMPOSER_CONTEXT_API = composerContextApi.definition;
  var MESSAGES_ENRICHMENT_API = messagesEnrichmentApi.definition;
  var UI_THEME = "t3.ui/theme";
  var UI_THEME_READ = "t3.ui/theme.read";
  var UI_THEME_WRITE = "t3.ui/theme.write";
  var UI_KEYBINDINGS = "t3.ui/keybindings";
  var UI_KEYBINDINGS_VERSION = "1.1.0";
  var UI_NOTIFY = "t3.ui/notify";
  var UI_PANELS = "t3.ui/panels";
  var UI_PREFERENCES = "t3.ui/preferences";
  var UI_PREFERENCES_READ = "t3.ui/preferences.read";
  var UI_PREFERENCES_WRITE = "t3.ui/preferences.write";
  var uiClientTargetSchema = {
    type: "object",
    additionalProperties: false,
    required: ["connectionId", "providers", "connectedAt"],
    properties: {
      connectionId: { type: "string", minLength: 1, maxLength: 160 },
      announcedOrigin: {
        type: "object",
        additionalProperties: false,
        properties: {
          surface: { type: "string", maxLength: 80 },
          appVersion: { type: "string", maxLength: 80 },
          os: { type: "string", maxLength: 120 },
          deviceType: { type: "string", maxLength: 80 },
          connectionMethod: { type: "string", maxLength: 40 }
        }
      },
      providers: {
        type: "array",
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "version"],
          properties: {
            id: { type: "string", maxLength: 80 },
            version: { type: "string", maxLength: 40 }
          }
        }
      },
      connectedAt: { type: "string", maxLength: 80 }
    }
  };
  var uiCapabilitiesOutput = (operations) => ({
    type: "object",
    additionalProperties: false,
    required: ["adapter", "operations", "clients"],
    properties: {
      adapter: { type: "string", maxLength: 64 },
      operations: {
        type: "object",
        additionalProperties: false,
        required: [...operations],
        properties: Object.fromEntries(operations.map((name) => [name, { type: "boolean" }]))
      },
      clients: { type: "array", maxItems: 64, items: uiClientTargetSchema }
    }
  });
  var uiThemeApi = defineApi({
    id: UI_THEME,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput([
          "getState",
          "getTokens",
          "setPreference",
          "subscribeState",
          "getTerminalAppearance",
          "subscribeTerminalAppearance"
        ])
      },
      {
        name: "getState",
        effect: "read",
        requiredGrants: [UI_THEME_READ],
        inputSchema: composerEmptyInputSchema,
        outputSchema: themeProviderStateSchema
      },
      {
        name: "getTokens",
        effect: "read",
        requiredGrants: [UI_THEME_READ],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { appearance: { enum: ["light", "dark"] } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["tokens", "cssVars"],
          properties: {
            tokens: { type: "object", additionalProperties: { type: "string", maxLength: 400 } },
            cssVars: { type: "object", additionalProperties: { type: "string", maxLength: 80 } }
          }
        }
      },
      {
        name: "setPreference",
        effect: "write",
        requiredGrants: [UI_THEME_WRITE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["mode"],
          properties: {
            theme: { type: "string", minLength: 1, maxLength: 160 },
            appearanceMode: { enum: ["light", "dark", "system"] },
            themeHalves: themeHalvesSchema,
            mode: { enum: ["persist", "session"] },
            clear: { type: "boolean" }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: {
            applied: { type: "boolean" },
            reason: { type: "string", maxLength: 200 },
            propagatedTo: { enum: ["storage-origin", "connection"] }
          }
        }
      },
      {
        name: "getTerminalAppearance",
        effect: "read",
        requiredGrants: [UI_THEME_READ],
        inputSchema: composerEmptyInputSchema,
        outputSchema: terminalAppearanceSchema
      }
    ],
    streams: [
      {
        name: "subscribeState",
        inputSchema: composerEmptyInputSchema,
        eventSchema: themeProviderStateSchema,
        requiredGrants: [UI_THEME_READ]
      },
      {
        name: "subscribeTerminalAppearance",
        inputSchema: composerEmptyInputSchema,
        eventSchema: terminalAppearanceSchema,
        requiredGrants: [UI_THEME_READ]
      }
    ]
  });
  var uiKeybindingsApi = defineApi({
    id: UI_KEYBINDINGS,
    version: UI_KEYBINDINGS_VERSION,
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput([
          "registerCommands",
          "unregisterCommands",
          "listConflicts"
        ])
      },
      {
        name: "registerCommands",
        effect: "write",
        requiredGrants: [UI_KEYBINDINGS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["commands"],
          properties: {
            commands: {
              type: "array",
              minItems: 1,
              maxItems: 64,
              items: commandDescriptorSchema
            }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["commandSetToken", "results"],
          properties: {
            commandSetToken: { type: "string", minLength: 1, maxLength: 160 },
            results: { type: "array", maxItems: 64, items: commandResultSchema }
          }
        }
      },
      {
        name: "unregisterCommands",
        effect: "write",
        requiredGrants: [UI_KEYBINDINGS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["commandSetToken"],
          properties: {
            commandSetToken: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["unregistered"],
          properties: { unregistered: { type: "boolean" } }
        }
      },
      {
        name: "listConflicts",
        effect: "read",
        requiredGrants: [UI_KEYBINDINGS],
        inputSchema: composerEmptyInputSchema,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["conflicts"],
          properties: {
            conflicts: {
              type: "array",
              maxItems: 256,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["command", "key", "winner", "loser"],
                properties: {
                  command: { type: "string", maxLength: 256 },
                  key: { type: "string", maxLength: 64 },
                  winner: { enum: ["user", "native", "plugin"] },
                  loser: { type: "string", maxLength: 256 }
                }
              }
            }
          }
        }
      }
    ]
  });
  var uiNotificationActionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 80 },
      label: { type: "string", minLength: 1, maxLength: 80 },
      variant: { enum: ["default", "primary", "destructive"] }
    }
  };
  var uiNotificationsApi = defineApi({
    id: "t3.ui/notifications",
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput(["notify", "update", "dismiss", "awaitAction"])
      },
      {
        name: "notify",
        effect: "write",
        requiredGrants: [UI_NOTIFY],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "title"],
          properties: {
            severity: { enum: ["info", "success", "warning", "error", "loading"] },
            title: { type: "string", minLength: 1, maxLength: 200 },
            body: { type: "string", maxLength: 2e3 },
            threadId: { type: "string", maxLength: 128 },
            projectId: { type: "string", maxLength: 128 },
            anchor: { enum: ["global", "thread"] },
            dismissible: { type: "boolean" },
            durationMs: { type: "integer", minimum: 0, maximum: 6e4 },
            actions: { type: "array", maxItems: 3, items: uiNotificationActionSchema }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: { notificationId: { type: "string", minLength: 1, maxLength: 160 } }
        }
      },
      {
        name: "update",
        effect: "write",
        requiredGrants: [UI_NOTIFY],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: {
            notificationId: { type: "string", minLength: 1, maxLength: 160 },
            severity: { enum: ["info", "success", "warning", "error", "loading"] },
            title: { type: "string", minLength: 1, maxLength: 200 },
            body: { type: "string", maxLength: 2e3 },
            dismissible: { type: "boolean" }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: { applied: { type: "boolean" } }
        }
      },
      {
        name: "dismiss",
        effect: "write",
        requiredGrants: [UI_NOTIFY],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: { notificationId: { type: "string", minLength: 1, maxLength: 160 } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["dismissed"],
          properties: { dismissed: { type: "boolean" } }
        }
      },
      {
        name: "awaitAction",
        effect: "read",
        requiredGrants: [UI_NOTIFY],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: { notificationId: { type: "string", minLength: 1, maxLength: 160 } }
        },
        outputSchema: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["actionId"],
              properties: { actionId: { type: "string", minLength: 1, maxLength: 80 } }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["dismissed"],
              properties: { dismissed: { const: true } }
            }
          ]
        }
      }
    ]
  });
  var uiPanelsApi = defineApi({
    id: "t3.ui/panels",
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput([
          "openSurface",
          "activateSurface",
          "closeSurface",
          "listSurfaces",
          "hideDock",
          "showDock"
        ])
      },
      {
        name: "openSurface",
        effect: "write",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId"],
          properties: {
            surfaceId: { type: "string", minLength: 1, maxLength: 160 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            placement: { enum: ["side-panel", "bottom-dock"] },
            threadId: { type: "string", maxLength: 128 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId"],
          properties: { surfaceId: { type: "string", maxLength: 160 } }
        }
      },
      {
        name: "activateSurface",
        effect: "write",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId"],
          properties: {
            surfaceId: { type: "string", minLength: 1, maxLength: 160 },
            threadId: { type: "string", maxLength: 128 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: { applied: { type: "boolean" } }
        }
      },
      {
        name: "closeSurface",
        effect: "write",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaceId"],
          properties: {
            surfaceId: { type: "string", minLength: 1, maxLength: 160 },
            threadId: { type: "string", maxLength: 128 }
          }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: { applied: { type: "boolean" } }
        }
      },
      {
        name: "listSurfaces",
        effect: "read",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["threadId"],
          properties: { threadId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["surfaces"],
          properties: {
            surfaces: {
              type: "array",
              maxItems: 64,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "title", "placement", "active"],
                properties: {
                  id: { type: "string", maxLength: 160 },
                  title: { type: "string", maxLength: 200 },
                  placement: { enum: ["side-panel", "bottom-dock"] },
                  active: { type: "boolean" }
                }
              }
            }
          }
        }
      },
      {
        name: "hideDock",
        effect: "write",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["threadId"],
          properties: { threadId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: { applied: { type: "boolean" } }
        }
      },
      {
        name: "showDock",
        effect: "write",
        requiredGrants: [UI_PANELS],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["threadId"],
          properties: { threadId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["applied"],
          properties: { applied: { type: "boolean" } }
        }
      }
    ]
  });
  var uiPreferencesApi = defineApi({
    id: UI_PREFERENCES,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput([
          "getPreferences",
          "setPreferences",
          "subscribePreferences"
        ])
      },
      {
        name: "getPreferences",
        effect: "read",
        requiredGrants: [UI_PREFERENCES_READ],
        inputSchema: composerEmptyInputSchema,
        outputSchema: clientPreferencesSchema
      },
      {
        name: "setPreferences",
        effect: "write",
        requiredGrants: [UI_PREFERENCES_WRITE],
        inputSchema: clientPreferencesPatchSchema,
        outputSchema: clientPreferencesReceiptSchema
      }
    ],
    streams: [
      {
        name: "subscribePreferences",
        inputSchema: composerEmptyInputSchema,
        eventSchema: clientPreferencesSchema,
        requiredGrants: [UI_PREFERENCES_READ]
      }
    ]
  });
  var UI_THEME_API = uiThemeApi.definition;
  var UI_KEYBINDINGS_API = uiKeybindingsApi.definition;
  var UI_NOTIFICATIONS_API = uiNotificationsApi.definition;
  var UI_PANELS_API = uiPanelsApi.definition;
  var UI_PREFERENCES_API = uiPreferencesApi.definition;
  var orchestrationStatusApi = defineOrchestrationStatusApi(vcsDiffPreviewStreamEventSchema);
  var ORCHESTRATION_STATUS_API = orchestrationStatusApi.definition;
  var GENERIC_API_CATALOGUE = [
    orchestrationStatusApi.definition,
    orchestrationControlApi.definition,
    browserLocalServersApi.definition,
    browserSessionsApi.definition,
    browserFramesApi.definition,
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
    vcsActionsApi.definition,
    resourcesLeaseApi.definition,
    resourcesLeaseApiV1.definition,
    workspaceResourcesApi.definition,
    prsReadApi.definition,
    prsWriteApi.definition,
    composerContextApi.definition,
    messagesEnrichmentApi.definition,
    uiThemeApi.definition,
    uiKeybindingsApi.definition,
    uiNotificationsApi.definition,
    uiPanelsApi.definition,
    uiPreferencesApi.definition
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

  // node_modules/@t3tools/extension-sdk/dist/environment.js
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

  // node_modules/@t3tools/extension-sdk/dist/authoring.js
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
      surfaces: surfaces.map(({ name, title, scope, placements, clients, capabilities, claimsTerminalFocus, stateVersion }) => ({
        id: source.id + "/" + name,
        title,
        scope,
        placements: placements ?? ["side-panel"],
        clients: clients ?? ["web", "desktop"],
        capabilities: capabilities ?? [],
        ...claimsTerminalFocus === true ? { claimsTerminalFocus: true } : {},
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
  function useApiRead(host, session, api, method, input) {
    const { useEffect, useState } = host.React;
    const definition = api.definition.methods?.find((item) => item.name === method);
    if (!definition || definition.effect !== "read")
      throw new Error("useApiRead requires a declared read method");
    const [visible, setVisible] = useState(session.visible);
    const key = JSON.stringify([api.definition, method, input, session.context, visible]);
    const [state2, setState] = useState();
    useEffect(() => session.onVisibility(setVisible), [session]);
    useEffect(() => {
      if (!visible)
        return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const client = bindApi(api, host, session.context);
      setState({ key, result: { status: "loading" } });
      void client.invoke(method, input, signal).then((value) => {
        if (!signal.aborted)
          setState({ key, result: { status: "ready", value } });
      }, (error) => {
        if (!signal.aborted)
          setState({
            key,
            result: {
              status: "unavailable",
              error: error instanceof Error ? error.message : "API unavailable"
            }
          });
      });
      return () => controller.abort();
    }, [key, host, session]);
    return state2?.key === key ? state2.result : { status: "loading" };
  }

  // extension.ts
  var extension_default = defineExtension({
    id: "example.orchestration-contracts",
    version: "1.0.0",
    requires: [requireApi(orchestrationStatusApi), requireApi(orchestrationControlApi)],
    surfaces: [
      {
        name: "view",
        title: "Agent capabilities",
        scope: "thread",
        createView(host, session) {
          return {
            renderer: function Capabilities() {
              const result = useApiRead(host, session, orchestrationStatusApi, "getCapabilities", {});
              return host.React.createElement(
                "pre",
                null,
                result.status === "ready" ? JSON.stringify(result.value.operations, null, 2) : result.status === "unavailable" ? result.error : "Loading\u2026"
              );
            }
          };
        }
      }
    ]
  });

  // generated-client.ts
  var generated_client_default = extension_default.client;
  return __toCommonJS(generated_client_exports);
})();

return __t3Client.default(__t3Host);
}
