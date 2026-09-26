// node_modules/@t3tools/extension-sdk/dist/contracts.js
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

// node_modules/@t3tools/extension-sdk/dist/capabilities.js
function defineApi(definition) {
  return { definition: validateApiDefinition(definition) };
}
function defineStreamApi(definition) {
  const validated = validateApiDefinition(definition);
  if (!validated.streams?.length)
    throw new Error("Expected API stream definitions");
  return { definition: validated };
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
var ORCHESTRATION_LAUNCH_WORKFLOW = "t3.orchestration/launch-workflow";
var WORKFLOW_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
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
  "checkpoint.revert": obj({ ...guard, turnCount: num }, ["turnCount"]),
  "workflow.launch": obj({ ...guard, workflowName: { type: "string", pattern: WORKFLOW_NAME_PATTERN } }, ["workflowName"])
};
var orchestrationControlApi = defineApi({
  id: ORCHESTRATION_CONTROL,
  version: "1.1.0",
  methods: [
    ...ORCHESTRATION_CONTROL_OPS.map((name) => ({
      name,
      effect: "write",
      requiredGrants: [ORCHESTRATION_OPERATE],
      inputSchema: operationInputs[name],
      outputSchema: receipt
    })),
    {
      name: "workflow.launch",
      effect: "write",
      requiredGrants: [ORCHESTRATION_OPERATE, ORCHESTRATION_LAUNCH_WORKFLOW],
      inputSchema: operationInputs["workflow.launch"],
      outputSchema: receipt
    }
  ]
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
    defaultKey: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 64 },
        {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 64 }
        }
      ]
    },
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
var BROWSER_CAPTURE_ARTIFACT_REF_PATTERN = "^pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
var CLIENT_COMPOSER_API = validateApiDefinition({
  id: "t3.client/composer",
  version: "1.2.0",
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
      name: "insertImage",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({
        ...composerThreadIdInput,
        artifactRef: {
          type: "string",
          maxLength: 128,
          pattern: BROWSER_CAPTURE_ARTIFACT_REF_PATTERN
        },
        name: { type: "string", minLength: 1, maxLength: 128 }
      }, ["threadId", "artifactRef"]),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["inserted", "target"],
        properties: {
          inserted: { type: "boolean" },
          target: { type: "string", minLength: 1, maxLength: 256 }
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
var uiExternalOpenReceiptSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "url", "opener"],
      properties: {
        status: { const: "opened" },
        url: { type: "string", minLength: 1, maxLength: 4096 },
        opener: { enum: ["desktop-shell", "browser-window"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason"],
      properties: {
        status: { const: "refused" },
        reason: { enum: ["invalid-url", "scheme-not-allowed", "opener-refused"] }
      }
    }
  ]
};
var CLIENT_EXTERNAL_API = validateApiDefinition({
  id: "t3.client/external",
  version: "1.0.0",
  methods: [
    {
      name: "open",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({ url: { type: "string", minLength: 1, maxLength: 4096 } }, ["url"]),
      outputSchema: uiExternalOpenReceiptSchema
    }
  ]
});
var browserHistoryEntriesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "lastVisitedAt"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 2048 },
          lastVisitedAt: { type: "number" },
          title: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    },
    truncated: { const: true }
  }
};
var historyUrl = { type: "string", minLength: 1, maxLength: 4096 };
var CLIENT_BROWSER_HISTORY_API = validateApiDefinition({
  id: "t3.client/browser-history",
  version: "1.1.0",
  methods: [
    {
      name: "list",
      effect: "read",
      requiredGrants: [],
      inputSchema: withTarget({}),
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "record",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({ url: historyUrl }, ["url"]),
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "setTitle",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({ url: historyUrl, title: { type: "string", minLength: 1, maxLength: 4096 } }, ["url", "title"]),
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "remove",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({ url: historyUrl }, ["url"]),
      outputSchema: browserHistoryEntriesSchema
    }
  ]
});
var uiNavigationReceiptSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "threadId"],
      properties: {
        status: { const: "opened" },
        threadId: { type: "string", minLength: 1, maxLength: 128 },
        surfaceId: { type: "string", minLength: 1, maxLength: 160 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason"],
      properties: {
        status: { const: "refused" },
        reason: { enum: ["unknown-thread", "out-of-scope", "surface-not-found"] }
      }
    }
  ]
};
var uiNavigationSessionReceiptSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "agentId", "opener"],
      properties: {
        status: { const: "opened" },
        agentId: { type: "string", minLength: 1, maxLength: 256 },
        opener: { enum: ["desktop-shell", "browser-window"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason"],
      properties: {
        status: { const: "refused" },
        reason: { enum: ["unknown-thread", "unknown-agent", "no-session", "opener-refused"] }
      }
    }
  ]
};
var CLIENT_NAVIGATION_API = validateApiDefinition({
  id: "t3.client/navigation",
  version: "1.0.0",
  methods: [
    {
      name: "openThread",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({
        threadId: { type: "string", minLength: 1, maxLength: 128 },
        surfaceId: { type: "string", minLength: 1, maxLength: 160 }
      }, ["threadId"]),
      outputSchema: uiNavigationReceiptSchema
    },
    {
      name: "openSession",
      effect: "write",
      requiredGrants: [],
      inputSchema: withTarget({
        agentId: { type: "string", minLength: 1, maxLength: 256 },
        url: { type: "string", minLength: 1, maxLength: 4096 }
      }, ["agentId", "url"]),
      outputSchema: uiNavigationSessionReceiptSchema
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
  CLIENT_PREFERENCES_API,
  CLIENT_EXTERNAL_API,
  CLIENT_BROWSER_HISTORY_API,
  CLIENT_NAVIGATION_API
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
var BROWSER_HISTORY = "t3.browser/history";
var BROWSER_READ_HISTORY = "t3.browser/read-history";
var BROWSER_RECORD_HISTORY = "t3.browser/record-history";
var BROWSER_HISTORY_MAX_BYTES = MAX_PAYLOAD_BYTES - 4096;
var browserHistoryUrlInput = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: { url: { type: "string", minLength: 1, maxLength: 4096 } }
};
var browserHistoryApi = defineApi({
  id: BROWSER_HISTORY,
  version: "1.1.0",
  methods: [
    {
      name: "list",
      effect: "read",
      requiredGrants: [BROWSER_READ_HISTORY],
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "record",
      effect: "write",
      requiredGrants: [BROWSER_READ_HISTORY, BROWSER_RECORD_HISTORY],
      inputSchema: browserHistoryUrlInput,
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "setTitle",
      effect: "write",
      requiredGrants: [BROWSER_READ_HISTORY, BROWSER_RECORD_HISTORY],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url", "title"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 4096 },
          title: { type: "string", minLength: 1, maxLength: 4096 }
        }
      },
      outputSchema: browserHistoryEntriesSchema
    },
    {
      name: "remove",
      effect: "write",
      requiredGrants: [BROWSER_READ_HISTORY, BROWSER_RECORD_HISTORY],
      inputSchema: browserHistoryUrlInput,
      outputSchema: browserHistoryEntriesSchema
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
var vcsChangesListMethod = {
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
};
var vcsChangesPathsMethod = (name) => ({
  name,
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
});
var vcsChangesStageMethod = vcsChangesPathsMethod("stage");
var vcsChangesUnstageMethod = vcsChangesPathsMethod("unstage");
var vcsChangesCommitMethod = {
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
};
var vcsChangesDiscardMethod = {
  name: "discard",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["paths"],
    properties: { paths: vcsPathsInput }
  },
  outputSchema: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "restored", "removed"],
        properties: {
          status: { const: "discarded" },
          restored: { type: "array", maxItems: 100, items: vcsPath },
          removed: { type: "array", maxItems: 100, items: vcsPath }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "reason", "paths"],
        properties: {
          status: { const: "refused" },
          reason: { enum: ["conflicted", "no-working-tree-change"] },
          paths: vcsPathsInput
        }
      }
    ]
  }
};
var vcsChangesApi = defineApi({
  id: VCS_CHANGES,
  version: "1.1.0",
  methods: [
    vcsChangesListMethod,
    vcsChangesStageMethod,
    vcsChangesUnstageMethod,
    vcsChangesCommitMethod,
    vcsChangesDiscardMethod
  ]
});
var vcsChangesApiV1 = defineApi({
  id: VCS_CHANGES,
  version: "1.0.0",
  methods: [
    vcsChangesListMethod,
    vcsChangesStageMethod,
    vcsChangesUnstageMethod,
    vcsChangesCommitMethod
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
var vcsOperationsSupportSchemaV1_1 = {
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
var vcsOperationsSupportSchema = {
  type: "object",
  additionalProperties: false,
  required: [...vcsOperationsSupportSchemaV1_1.required, "changes.discard"],
  properties: {
    ...vcsOperationsSupportSchemaV1_1.properties,
    "changes.discard": { type: "boolean" }
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
var vcsCapabilitiesResultSchemaV1_1 = {
  type: "object",
  additionalProperties: false,
  required: ["detected", "kind", "detail", "driver", "operations"],
  properties: {
    detected: { type: "boolean" },
    kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
    detail: { type: ["string", "null"], maxLength: 512 },
    driver: vcsDriverCapabilitiesSchema,
    operations: vcsOperationsSupportSchemaV1_1
  }
};
var vcsCapabilitiesResultSchema = {
  ...vcsCapabilitiesResultSchemaV1_1,
  properties: {
    ...vcsCapabilitiesResultSchemaV1_1.properties,
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
var vcsRepositoryGetCapabilitiesMethodV1_1 = {
  name: "getCapabilities",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: vcsCapabilitiesResultSchemaV1_1
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
  version: "1.2.0",
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
var vcsRepositoryApiV1_1 = defineApi({
  id: VCS_REPOSITORY,
  version: "1.1.0",
  methods: [
    vcsRepositoryGetCapabilitiesMethodV1_1,
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
var VCS_CHANGES_API_V1 = vcsChangesApiV1.definition;
var VCS_DIFF_API = vcsDiffApi.definition;
var VCS_DIFF_API_V1 = vcsDiffApiV1.definition;
var VCS_REPOSITORY_API = vcsRepositoryApi.definition;
var VCS_REPOSITORY_API_V1_1 = vcsRepositoryApiV1_1.definition;
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
var BROWSER_DEVTOOLS = "t3.browser/devtools";
var BROWSER_PICTURE_IN_PICTURE = "t3.browser/picture-in-picture";
var BROWSER_SESSION_COMMANDS_V1 = [
  "back",
  "forward",
  "reload",
  "hardReload",
  "resize",
  "zoom",
  "setAppearance",
  "setAudioMuted"
];
var BROWSER_SESSION_COMMANDS_V1_1 = [
  ...BROWSER_SESSION_COMMANDS_V1,
  "openDevTools",
  "closeDevTools"
];
var BROWSER_SESSION_COMMANDS = [
  ...BROWSER_SESSION_COMMANDS_V1_1,
  "setPictureInPicture"
];
var BROWSER_SESSION_URL_MAX_LENGTH = 2048;
var BROWSER_SESSION_TITLE_MAX_LENGTH = 512;
var BROWSER_SESSION_LIMIT = 64;
var BROWSER_SESSION_FAVICON_REF_MAX_LENGTH = 64;
var BROWSER_SESSION_FAVICON_MAX_LENGTH = 8192;
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
var browserSessionFaviconRef = {
  type: "string",
  minLength: 1,
  maxLength: BROWSER_SESSION_FAVICON_REF_MAX_LENGTH
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
var browserSessionObjectV1 = {
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
var browserSessionObjectV1_1 = {
  ...browserSessionObjectV1,
  required: [...browserSessionObjectV1.required, "devToolsOpen"],
  properties: { ...browserSessionObjectV1.properties, devToolsOpen: { type: ["boolean", "null"] } }
};
var browserSessionObject = {
  ...browserSessionObjectV1_1,
  required: [...browserSessionObjectV1_1.required, "pictureInPicture"],
  properties: {
    ...browserSessionObjectV1_1.properties,
    pictureInPicture: { type: ["boolean", "null"] },
    faviconRef: browserSessionFaviconRef
  }
};
var browserSessionReceiptOf = (session) => ({
  type: "object",
  additionalProperties: false,
  required: ["commandId", "outcome", "serverEpoch", "revision", "session"],
  properties: {
    commandId: { type: "string", minLength: 1, maxLength: 64 },
    outcome: { enum: ["accepted", "rejected", "unknown"] },
    serverEpoch: browserSessionEpoch,
    revision: browserSessionRevision,
    session
  }
});
var browserSessionCommandGuard = {
  tabId: browserSessionTabId,
  serverEpoch: browserSessionEpoch,
  expectedEngineGeneration: { type: ["string", "null"], minLength: 1, maxLength: 128 }
};
var browserSessionGuardRequired = ["tabId", "serverEpoch", "expectedEngineGeneration"];
var browserSessionCommandMethod = (receipt2, name, extraProperties = {}, extraRequired = [], requiredGrants = [BROWSER_SESSIONS, BROWSER_OPERATE]) => ({
  name,
  effect: "write",
  requiredGrants: [...requiredGrants],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: [...browserSessionGuardRequired, ...extraRequired],
    properties: { ...browserSessionCommandGuard, ...extraProperties }
  },
  outputSchema: receipt2
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
var browserSessionsDefinition = (version, commands, session, extraMethods = () => [], extraReads = []) => {
  const receipt2 = browserSessionReceiptOf(session);
  return {
    id: BROWSER_SESSIONS,
    version,
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
              maxItems: commands.length,
              uniqueItems: true,
              items: { enum: [...commands] }
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
              items: session
            }
          }
        }
      },
      ...extraReads,
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
        outputSchema: receipt2
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
        outputSchema: receipt2
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
      browserSessionCommandMethod(receipt2, "back"),
      browserSessionCommandMethod(receipt2, "forward"),
      browserSessionCommandMethod(receipt2, "reload"),
      browserSessionCommandMethod(receipt2, "hardReload"),
      browserSessionCommandMethod(receipt2, "resize", { viewport: browserSessionViewport }, [
        "viewport"
      ]),
      browserSessionCommandMethod(receipt2, "zoom", { zoomFactor: { enum: [...BROWSER_SESSION_ZOOM_LEVELS] } }, ["zoomFactor"]),
      browserSessionCommandMethod(receipt2, "setAppearance", { appearance: { enum: ["system", "light", "dark"] } }, ["appearance"]),
      browserSessionCommandMethod(receipt2, "setAudioMuted", { muted: { type: "boolean" } }, [
        "muted"
      ]),
      ...extraMethods(receipt2)
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
                  items: session
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
                session
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
  };
};
var browserSessionDevToolsMethods = (receipt2) => [
  browserSessionCommandMethod(receipt2, "openDevTools", {}, [], [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_DEVTOOLS]),
  browserSessionCommandMethod(receipt2, "closeDevTools", {}, [], [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_DEVTOOLS])
];
var browserSessionGetFaviconMethod = {
  name: "getFavicon",
  effect: "read",
  requiredGrants: [BROWSER_SESSIONS],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["ref"],
    properties: { ref: browserSessionFaviconRef }
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["ref", "dataUrl"],
    properties: {
      ref: browserSessionFaviconRef,
      dataUrl: { type: "string", minLength: 1, maxLength: BROWSER_SESSION_FAVICON_MAX_LENGTH }
    }
  }
};
var browserSessionsApi = defineStreamApi(browserSessionsDefinition("1.2.0", BROWSER_SESSION_COMMANDS, browserSessionObject, (receipt2) => [
  ...browserSessionDevToolsMethods(receipt2),
  browserSessionCommandMethod(receipt2, "setPictureInPicture", { open: { type: "boolean" } }, ["open"], [BROWSER_SESSIONS, BROWSER_PICTURE_IN_PICTURE])
], [browserSessionGetFaviconMethod]));
var browserSessionsApiV1_1 = defineStreamApi(browserSessionsDefinition("1.1.0", BROWSER_SESSION_COMMANDS_V1_1, browserSessionObjectV1_1, browserSessionDevToolsMethods));
var browserSessionsApiV1 = defineStreamApi(browserSessionsDefinition("1.0.0", BROWSER_SESSION_COMMANDS_V1, browserSessionObjectV1));
var BROWSER_SESSIONS_API = browserSessionsApi.definition;
var BROWSER_SESSIONS_API_V1_1 = browserSessionsApiV1_1.definition;
var BROWSER_SESSIONS_API_V1 = browserSessionsApiV1.definition;
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
var BROWSER_CAPTURE_ARTIFACT_REF_PATTERN2 = "^pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
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
  version: "1.2.0",
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
        "insertTerminalContext",
        "insertImage"
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
    },
    {
      name: "insertImage",
      effect: "write",
      requiredGrants: [COMPOSER_WRITE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["artifactRef"],
        properties: {
          threadId: composerThreadIdInput2,
          artifactRef: {
            type: "string",
            maxLength: 128,
            pattern: BROWSER_CAPTURE_ARTIFACT_REF_PATTERN2
          },
          name: { type: "string", minLength: 1, maxLength: 128 }
        }
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["inserted", "target"],
        properties: {
          inserted: { type: "boolean" },
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
var UI_EXTERNAL = "t3.ui/external";
var UI_EXTERNAL_OPEN = "t3.ui/external.open";
var uiExternalApi = defineApi({
  id: UI_EXTERNAL,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [],
      inputSchema: composerEmptyInputSchema,
      outputSchema: uiCapabilitiesOutput(["open"])
    },
    {
      name: "open",
      effect: "write",
      requiredGrants: [UI_EXTERNAL_OPEN],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: { url: { type: "string", minLength: 1, maxLength: 2048 } }
      },
      outputSchema: uiExternalOpenReceiptSchema
    }
  ]
});
var UI_NAVIGATION = "t3.ui/navigation";
var UI_NAVIGATION_OPEN = "t3.ui/navigation.open";
var UI_NAVIGATION_OPEN_SESSION = "t3.ui/navigation.open-session";
var uiNavigationApi = defineApi({
  id: UI_NAVIGATION,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [],
      inputSchema: composerEmptyInputSchema,
      outputSchema: uiCapabilitiesOutput(["openThread", "openAgentSession"])
    },
    {
      name: "openThread",
      effect: "write",
      requiredGrants: [UI_NAVIGATION_OPEN],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["threadId"],
        properties: {
          threadId: { type: "string", minLength: 1, maxLength: 128 },
          surfaceId: { type: "string", minLength: 1, maxLength: 160 }
        }
      },
      outputSchema: uiNavigationReceiptSchema
    },
    {
      name: "openAgentSession",
      effect: "write",
      requiredGrants: [UI_NAVIGATION_OPEN_SESSION],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentId"],
        properties: { agentId: { type: "string", minLength: 1, maxLength: 256 } }
      },
      outputSchema: uiNavigationSessionReceiptSchema
    }
  ]
});
var UI_NOTIFICATIONS_API = uiNotificationsApi.definition;
var UI_PANELS_API = uiPanelsApi.definition;
var UI_PREFERENCES_API = uiPreferencesApi.definition;
var UI_EXTERNAL_API = uiExternalApi.definition;
var UI_NAVIGATION_API = uiNavigationApi.definition;
var orchestrationStatusApi = defineOrchestrationStatusApi(vcsDiffPreviewStreamEventSchema);
var ORCHESTRATION_STATUS_API = orchestrationStatusApi.definition;
var GENERIC_API_CATALOGUE = [
  orchestrationStatusApi.definition,
  orchestrationControlApi.definition,
  browserLocalServersApi.definition,
  browserHistoryApi.definition,
  browserSessionsApi.definition,
  browserSessionsApiV1_1.definition,
  browserSessionsApiV1.definition,
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
  vcsChangesApiV1.definition,
  vcsDiffApi.definition,
  vcsRepositoryApi.definition,
  vcsRepositoryApiV1_1.definition,
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
  uiPreferencesApi.definition,
  uiExternalApi.definition,
  uiNavigationApi.definition
];
var WORKSPACE_FILES_API = workspaceFilesApi.definition;
var WORKSPACE_SEARCH_API = workspaceSearchApi.definition;
var WORKSPACE_CHANGES_API = workspaceChangesApi.definition;
var FILE_PRESENTATION_API = filePresentationApi.definition;
var TERMINAL_SESSIONS_API = terminalSessionsApi.definition;
var TERMINAL_SESSIONS_API_V1 = terminalSessionsApiV1.definition;
var TERMINAL_OUTPUT_API = terminalOutputApi.definition;
var TERMINAL_OUTPUT_EVENTS_API = terminalOutputEventsApi.definition;
var TERMINAL_CONTROL_API = terminalControlApi.definition;

// node_modules/effect/dist/Pipeable.js
var pipeArguments = (self, args2) => {
  switch (args2.length) {
    case 0:
      return self;
    case 1:
      return args2[0](self);
    case 2:
      return args2[1](args2[0](self));
    case 3:
      return args2[2](args2[1](args2[0](self)));
    case 4:
      return args2[3](args2[2](args2[1](args2[0](self))));
    case 5:
      return args2[4](args2[3](args2[2](args2[1](args2[0](self)))));
    case 6:
      return args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self))))));
    case 7:
      return args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self)))))));
    case 8:
      return args2[7](args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self))))))));
    case 9:
      return args2[8](args2[7](args2[6](args2[5](args2[4](args2[3](args2[2](args2[1](args2[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args2.length; i < len; i++) {
        ret = args2[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ (function() {
  function PipeableBase() {
  }
  PipeableBase.prototype = Prototype;
  return PipeableBase;
})();

// node_modules/effect/dist/Function.js
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args2 = arguments;
        return function(self) {
          return body(self, ...args2);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constUndefined = /* @__PURE__ */ constant(void 0);
var constVoid = constUndefined;
function memoize(f) {
  const cache = /* @__PURE__ */ new WeakMap();
  return (a) => {
    const cached2 = cache.get(a);
    if (cached2 !== void 0) return cached2;
    const result2 = f(a);
    cache.set(a, result2);
    return result2;
  };
}
function memoizeIdempotent(f) {
  const cache = /* @__PURE__ */ new WeakMap();
  return (a) => {
    const cached2 = cache.get(a);
    if (cached2 !== void 0) return cached2;
    const result2 = f(a);
    cache.set(a, result2);
    cache.set(result2, result2);
    return result2;
  };
}

// node_modules/effect/dist/internal/equal.js
var getAllObjectKeys = (obj2) => {
  const keys = new Set(Reflect.ownKeys(obj2));
  if (obj2.constructor === Object) return keys;
  if (obj2 instanceof Error) {
    keys.delete("stack");
  }
  const proto = Object.getPrototypeOf(obj2);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0; i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj2.constructor === "function" && proto === obj2.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet();

// node_modules/effect/dist/Predicate.js
function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isFunction(input) {
  return typeof input === "function";
}
function isNotUndefined(input) {
  return input !== void 0;
}
function isNotNullish(input) {
  return input != null;
}
function isUnknown(_) {
  return true;
}
function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && property in self);
function isError(input) {
  return input instanceof Error;
}

// node_modules/effect/dist/Hash.js
var symbol = "~effect/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        if (hashCache.has(self)) {
          return hashCache.get(self);
        }
        const h = withVisitedTracking(self, () => {
          if (isHash(self)) {
            return self[symbol]();
          } else if (typeof self === "function") {
            return random(self);
          } else if (self instanceof DataView) {
            return array(new Uint8Array(self.buffer, self.byteOffset, self.byteLength));
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            return array(self);
          } else if (self instanceof Map) {
            return hashMap(self);
          } else if (self instanceof Set) {
            return hashSet(self);
          }
          return structure(self);
        });
        hashCache.set(self, h);
        return h;
      }
    }
    default:
      return string(String(self));
  }
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
};
var combine = /* @__PURE__ */ dual(2, (self, b) => self * 53 ^ b);
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol);
var number = (n) => {
  if (n !== n || n === Infinity || n === -Infinity) {
    return string(String(n));
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
};
var string = (str2) => {
  let h = 5381, i = str2.length;
  while (i) {
    h = h * 33 ^ str2.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var iterableWith = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = /* @__PURE__ */ iterableWith(6151, hash);
var hashMap = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var hashSet = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Set"), hash);
var randomHashCache = /* @__PURE__ */ new WeakMap();
var hashCache = /* @__PURE__ */ new WeakMap();
var visitedObjects = /* @__PURE__ */ new WeakSet();
function withVisitedTracking(obj2, fn2) {
  if (visitedObjects.has(obj2)) {
    return string("[Circular]");
  }
  visitedObjects.add(obj2);
  const result2 = fn2();
  visitedObjects.delete(obj2);
  return result2;
}

// node_modules/effect/dist/Equal.js
var symbol2 = "~effect/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that) return true;
  if (self == null || that == null) return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return withCache(self, that, compareObjects);
}
function withVisitedTracking2(self, that, fn2) {
  const hasLeft = visitedLeft.has(self);
  const hasRight = visitedRight.has(that);
  if (hasLeft && hasRight) {
    return true;
  }
  if (hasLeft || hasRight) {
    return false;
  }
  visitedLeft.add(self);
  visitedRight.add(that);
  const result2 = fn2();
  visitedLeft.delete(self);
  visitedRight.delete(that);
  return result2;
}
var visitedLeft = /* @__PURE__ */ new WeakSet();
var visitedRight = /* @__PURE__ */ new WeakSet();
function compareObjects(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date)) return false;
    const selfTime = self.getTime();
    const thatTime = that.getTime();
    return selfTime === thatTime || Number.isNaN(selfTime) && Number.isNaN(thatTime);
  } else if (self instanceof RegExp) {
    if (!(that instanceof RegExp)) return false;
    return self.toString() === that.toString();
  }
  const selfIsEqual = isEqual(self);
  const thatIsEqual = isEqual(that);
  if (selfIsEqual !== thatIsEqual) return false;
  const bothEquals = selfIsEqual && thatIsEqual;
  if (typeof self === "function" && !bothEquals) {
    return false;
  }
  return withVisitedTracking2(self, that, () => {
    if (bothEquals) {
      return self[symbol2](that);
    } else if (Array.isArray(self)) {
      if (!Array.isArray(that) || self.length !== that.length) {
        return false;
      }
      return compareArrays(self, that);
    } else if (ArrayBuffer.isView(self)) {
      const selfIsDataView = self instanceof DataView;
      if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength || selfIsDataView !== that instanceof DataView) {
        return false;
      }
      if (selfIsDataView) {
        const thatDataView = that;
        return compareTypedArrays(new Uint8Array(self.buffer, self.byteOffset, self.byteLength), new Uint8Array(thatDataView.buffer, thatDataView.byteOffset, thatDataView.byteLength));
      }
      return compareTypedArrays(self, that);
    } else if (self instanceof Map) {
      if (!(that instanceof Map) || self.size !== that.size) {
        return false;
      }
      return compareMaps(self, that);
    } else if (self instanceof Set) {
      if (!(that instanceof Set) || self.size !== that.size) {
        return false;
      }
      return compareSets(self, that);
    }
    return compareRecords(self, that);
  });
}
function withCache(self, that, f) {
  let selfMap = equalityCache.get(self);
  if (!selfMap) {
    selfMap = /* @__PURE__ */ new WeakMap();
    equalityCache.set(self, selfMap);
  } else if (selfMap.has(that)) {
    return selfMap.get(that);
  }
  const result2 = f(self, that);
  selfMap.set(that, result2);
  let thatMap = equalityCache.get(that);
  if (!thatMap) {
    thatMap = /* @__PURE__ */ new WeakMap();
    equalityCache.set(that, thatMap);
  }
  thatMap.set(self, result2);
  return result2;
}
var equalityCache = /* @__PURE__ */ new WeakMap();
function compareArrays(self, that) {
  for (let i = 0; i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0; i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function makeCompareMap(keyEquivalence, valueEquivalence) {
  return function compareMaps2(self, that) {
    const thatEntries = Array.from(that);
    for (const [selfKey, selfValue] of self) {
      let found = false;
      for (let i = 0; i < thatEntries.length; i++) {
        const [thatKey, thatValue] = thatEntries[i];
        if (keyEquivalence(selfKey, thatKey) && valueEquivalence(selfValue, thatValue)) {
          thatEntries[i] = thatEntries[thatEntries.length - 1];
          thatEntries.pop();
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareMaps = /* @__PURE__ */ makeCompareMap(compareBoth, compareBoth);
function makeCompareSet(equivalence) {
  return function compareSets2(self, that) {
    const thatValues = Array.from(that);
    for (const selfValue of self) {
      let found = false;
      for (let i = 0; i < thatValues.length; i++) {
        const thatValue = thatValues[i];
        if (equivalence(selfValue, thatValue)) {
          thatValues[i] = thatValues[thatValues.length - 1];
          thatValues.pop();
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareSets = /* @__PURE__ */ makeCompareSet(compareBoth);
var isEqual = (u) => hasProperty(u, symbol2);

// node_modules/effect/dist/internal/array.js
var isArrayNonEmpty = (self) => self.length > 0;

// node_modules/effect/dist/internal/record.js
function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    ;
    self[key] = value;
  }
}
function assignProperties(self, source) {
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}

// node_modules/effect/dist/Redactable.js
var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u)) return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyMap = /* @__PURE__ */ new Map();
var emptyContext = {
  "~effect/Context": {},
  base: emptyMap,
  depth: 0,
  mapUnsafe: emptyMap,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// node_modules/effect/dist/Formatter.js
function format(input, options) {
  const space = options?.space ?? 0;
  const ancestors = /* @__PURE__ */ new WeakSet();
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    try {
      return recurUnsafe(v, d);
    } catch {
      if (typeof v === "object" && v !== null || typeof v === "function") ancestors.delete(v);
      return "[inspection threw]";
    }
  }
  function recurUnsafe(v, d = 0) {
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol") return String(v);
    if (typeof v === "bigint") return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (ancestors.has(v)) return CIRCULAR;
      ancestors.add(v);
      let output;
      if (symbolRedactable in v) {
        output = recur(getRedacted(v), d);
      } else if (Array.isArray(v)) {
        output = !gap || v.length <= 1 ? `[${v.map((x) => recur(x, d)).join(",")}]` : `[
${ind(d + 1)}${v.map((x) => recur(x, d + 1)).join(",\n" + ind(d + 1))}
${ind(d)}]`;
      } else if (v instanceof Date) {
        output = formatDate(v);
      } else if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
        const s = safeToString(v);
        output = v instanceof Error && v.cause !== void 0 ? `${s} (cause: ${recur(v.cause, d)})` : s;
      } else if (Symbol.iterator in v) {
        output = `${v.constructor.name}(${recur(Array.from(v), d)})`;
      } else {
        const keys = ownKeys(v);
        if (!gap || keys.length <= 1) {
          const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(safeGet(v, k), d)}`).join(",")}}`;
          output = wrap(v, body);
        } else {
          const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(safeGet(v, k), d + 1)}`).join(",\n")}
${ind(d)}}`;
          output = wrap(v, body);
        }
      }
      ancestors.delete(v);
      return output;
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path3) {
  return path3.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function safeGet(input, key) {
  try {
    return input[key];
  } catch {
    return "[property access threw]";
  }
}
function formatJson(input, options) {
  const ancestors = [];
  return JSON.stringify(input, function(key, value) {
    const original = Object.getOwnPropertyDescriptor(this, key)?.value;
    const redacted = hasProperty(original, symbolRedactable) ? redact(original) : redact(value);
    if (typeof redacted === "bigint") {
      return format(redacted);
    }
    if (typeof redacted !== "object" || redacted === null) {
      return redacted;
    }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(redacted)) {
      return void 0;
    }
    ancestors.push(redacted);
    return redacted;
  }, options?.space) ?? "null";
}

// node_modules/effect/dist/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    input = redact(input);
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
    return input;
  } catch {
    return "[toJSON threw]";
  }
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};
var Class2 = class {
  /**
   * Node.js custom inspection method.
   *
   * **When to use**
   *
   * Use to expose the class JSON representation to Node.js inspection.
   *
   * @since 2.0.0
   */
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  /**
   * Returns a formatted string representation of this object.
   *
   * **When to use**
   *
   * Use to format the class JSON representation as a string.
   *
   * @since 2.0.0
   */
  toString() {
    return format(this.toJSON());
  }
};

// node_modules/effect/dist/internal/stackTraceLimit.js
var isStackTraceLimitWritable = () => {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === void 0) {
    return Object.isExtensible(Error);
  }
  return Object.hasOwn(desc, "writable") ? desc.writable === true : desc.set !== void 0;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    ;
    Error.stackTraceLimit = value;
  }
};

// node_modules/effect/dist/Utils.js
var SingleShotGen = class _SingleShotGen {
  called = false;
  self;
  constructor(self) {
    this.self = self;
  }
  /**
   * Yields the stored value once, then completes with the value sent back in.
   *
   * **When to use**
   *
   * Use to advance a `SingleShotGen` through its single yield and completion
   * step.
   *
   * @since 2.0.0
   */
  next(a) {
    return this.called ? {
      value: a,
      done: true
    } : (this.called = true, {
      value: this.self,
      done: false
    });
  }
  /**
   * Creates a fresh single-shot iterator over the stored value.
   *
   * **When to use**
   *
   * Use to iterate the wrapped value again without reusing the consumed
   * iterator state.
   *
   * @since 2.0.0
   */
  [Symbol.iterator]() {
    return new _SingleShotGen(this.self);
  }
};
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {
      }
    }
  };
  const isNotOptimizedAway = getStackTraceLimit() !== 0 && standard[InternalTypeId](() => new Error().stack)?.includes(InternalTypeId) === true;
  return isNotOptimizedAway ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

// node_modules/effect/dist/internal/core.js
var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    const thatKeys = Object.keys(that);
    if (selfKeys.length !== thatKeys.length) return false;
    for (let i = 0; i < selfKeys.length; i++) {
      if (selfKeys[i] !== thatKeys[i] || !equals(this[selfKeys[i]], that[selfKeys[i]])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : void 0
    };
  }
};
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
var CauseImpl = class {
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      failures: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
};
var annotationsMap = /* @__PURE__ */ new WeakMap();
var ReasonBase = class {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0) return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key)) return;
      newAnnotations.set(key, value);
    });
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
};
var constEmptyAnnotations = /* @__PURE__ */ new Map();
var Fail = class extends ReasonBase {
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
};
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var causeFail = (error) => new CauseImpl([new Fail(error)]);
var Die = class extends ReasonBase {
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
};
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args2) => isCause(args2[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0) return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto2 = makePrimitiveProto(options);
  const PrimitiveImpl = function(value) {
    this[args] = value;
  };
  PrimitiveImpl.prototype = Proto2;
  return function(value) {
    return new PrimitiveImpl(value);
  };
};
var makeExit = (options) => {
  const Proto2 = {
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    ...makePrimitiveProto(options),
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  const ExitPrimitive = function(value) {
    this[args] = value;
  };
  ExitPrimitive.prototype = Proto2;
  return function(value) {
    return new ExitPrimitive(value);
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber2) {
    const cont = fiber2.getCont(contA);
    return cont ? cont[contA](this[args], fiber2, this) : fiber2.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber2) {
    let cause = this[args];
    let annotated = false;
    if (fiber2.cache.stackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: /* @__PURE__ */ new Map([[StackTraceKey.key, fiber2.cache.stackFrame]])
      });
      annotated = true;
    }
    let cont = fiber2.getCont(contE);
    while (fiber2.interruptible && fiber2._interruptedCause && cont) {
      cont = fiber2.getCont(contE);
    }
    return cont ? cont[contE](cause, fiber2, annotated ? void 0 : this) : fiber2.yieldWith(annotated ? exitFailCause(cause) : this);
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber2) {
    return this[args](fiber2);
  }
});
var withFiberSucceed = /* @__PURE__ */ makePrimitive({
  op: "WithFiberSucceed",
  [evaluate](fiber2) {
    const value = this[args](fiber2);
    const cont = fiber2.getCont(contA);
    return cont ? cont[contA](value, fiber2) : fiber2.yieldWith(exitSucceed(value));
  }
});
var YieldableError = /* @__PURE__ */ (function() {
  class YieldableError2 extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError2.prototype, proto);
  return YieldableError2;
})();
var Error2 = /* @__PURE__ */ (function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args2) {
      super(args2?.message, args2?.cause ? {
        cause: args2.cause
      } : void 0);
      if (args2) {
        assignProperties(this, args2);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args2,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
})();
var TaggedError = (tag2) => {
  class Base extends Error2 {
    _tag = tag2;
  }
  ;
  Base.prototype.name = tag2;
  return Base;
};
var NoSuchElementErrorTypeId = "~effect/Cause/NoSuchElementError";
var NoSuchElementError = class extends (/* @__PURE__ */ TaggedError("NoSuchElementError")) {
  [NoSuchElementErrorTypeId] = NoSuchElementErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
};
var DoneTypeId = "~effect/Cause/Done";
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: void 0
};

// node_modules/effect/dist/internal/option.js
var TypeId = "~effect/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: void 0,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var SomeImpl = function(value) {
  this.value = value;
};
SomeImpl.prototype = SomeProto;
var some = (value) => new SomeImpl(value);

// node_modules/effect/dist/internal/result.js
var TypeId2 = "~effect/Result";
var CommonProto2 = {
  [TypeId2]: {
    /* v8 ignore next 2 */
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result2) => result2._tag === "Failure";
var isSuccess = (result2) => result2._tag === "Success";
var FailureImpl = function(failure) {
  this.failure = failure;
};
FailureImpl.prototype = FailureProto;
var fail = (failure) => new FailureImpl(failure);
var SuccessImpl = function(success) {
  this.success = success;
};
SuccessImpl.prototype = SuccessProto;
var succeed = (success) => new SuccessImpl(success);

// node_modules/effect/dist/Option.js
var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var map = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : some2(f(self.value)));
var filter = /* @__PURE__ */ dual(2, (self, predicate) => isNone2(self) ? none2() : predicate(self.value) ? some2(self.value) : none2());

// node_modules/effect/dist/Result.js
var succeed2 = succeed;
var fail2 = fail;
var isFailure2 = isFailure;
var match = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));

// node_modules/effect/dist/Array.js
var Array2 = globalThis.Array;
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
var empty2 = () => [];
var map2 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));

// node_modules/effect/dist/Effectable.js
var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

// node_modules/effect/dist/Context.js
var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  function KeyClass() {
  }
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  const init = (key, options) => {
    self.key = key;
    if (options?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = options.defaultValue;
    }
    if (options?.make) {
      ;
      self.make = options.make;
    }
    if (options?.fiberCached) {
      cacheKeys.add(key);
    }
    return self;
  };
  return arguments.length > 0 ? init(arguments[0], arguments[1]) : init;
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber2) {
      return exitSucceed(get(fiber2.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make(this, self);
  },
  use(f) {
    return withFiber((fiber2) => f(get(fiber2.context, this)));
  },
  useSync(f) {
    return withFiber((fiber2) => exitSucceed(f(get(fiber2.context, this))));
  }
};
var cacheKeys = /* @__PURE__ */ new Set();
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId3 = "~effect/Context";
var MaxDepth = 8;
var FlattenAfterBaseHits = 8;
var makeImpl = (cacheRoot, base, overlay, depth) => {
  const self = Object.create(Proto);
  self.cacheRoot = cacheRoot ?? self;
  self.base = base;
  self.overlay = overlay;
  self.depth = depth;
  self._flat = void 0;
  self.baseHits = 0;
  return self;
};
var applyOverlays = (map6, overlay) => {
  if (!overlay) return;
  applyOverlays(map6, overlay.parent);
  map6.set(overlay.key, overlay.value);
};
var flatten = (self) => {
  if (self._flat) return self._flat;
  if (!self.overlay) return self._flat = self.base;
  const map6 = new Map(self.base);
  applyOverlays(map6, self.overlay);
  return self._flat = map6;
};
var notFound = /* @__PURE__ */ Symbol();
var lookup = (self, key) => {
  const impl = self;
  for (let overlay = impl.overlay; overlay; overlay = overlay.parent) {
    if (overlay.key === key) return overlay.value;
  }
  const value = impl.base.get(key);
  if (value === void 0 && !impl.base.has(key)) return notFound;
  if (impl.overlay && ++impl.baseHits >= FlattenAfterBaseHits) {
    impl.base = flatten(impl);
    impl.overlay = void 0;
    impl.depth = 0;
  }
  return value;
};
var makeUnsafe = (mapUnsafe) => makeImpl(void 0, mapUnsafe, void 0, 0);
var Proto = {
  get mapUnsafe() {
    return flatten(this);
  },
  ...PipeInspectableProto,
  [TypeId3]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that)) return false;
    const self = this.mapUnsafe;
    const other = that.mapUnsafe;
    if (self.size !== other.size) return false;
    for (const [key, value] of self) {
      if (!other.has(key) || !equals(value, other.get(key))) return false;
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var hasSameCache = (self, that) => self.cacheRoot === that.cacheRoot;
var isContext = (u) => hasProperty(u, TypeId3);
var isReference = (u) => !!u[ReferenceTypeId];
var empty3 = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map());
var make = (key, service2) => makeUnsafe(/* @__PURE__ */ new Map([[key.key, service2]]));
var add = /* @__PURE__ */ dual(3, (self, key, service2) => addUnsafe(self, key.key, service2));
var addUnsafe = (self, key, service2) => {
  const impl = self;
  const cacheRoot = cacheKeys.has(key) ? void 0 : impl.cacheRoot;
  if (impl.depth >= MaxDepth) {
    const map6 = new Map(impl.mapUnsafe);
    map6.set(key, service2);
    return makeImpl(cacheRoot, map6, void 0, 0);
  }
  return makeImpl(cacheRoot, impl.base, {
    key,
    value: service2,
    parent: impl.overlay
  }, impl.depth + 1);
};
var getOrUndefinedUnsafe = (self, key) => {
  const value = lookup(self, key);
  return value === notFound ? void 0 : value;
};
var getUnsafe = /* @__PURE__ */ dual(2, (self, service2) => {
  const value = lookup(self, service2.key);
  if (value === notFound) {
    if (isReference(service2)) return getDefaultValue(service2);
    throw serviceNotFoundError(service2);
  }
  return value;
});
var get = getUnsafe;
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service2) => {
  const error = new Error(`Service not found${service2.key ? `: ${String(service2.key)}` : ""}`);
  if (error.stack) {
    const lines = error.stack.split("\n");
    lines.splice(1, 3);
    error.stack = lines.join("\n");
  }
  return error;
};
var Reference = Service;

// node_modules/effect/dist/Scheduler.js
var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  fiberCached: true,
  defaultValue: () => new MixedScheduler()
});
var setMicrotask = (f) => {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled) f();
  });
  return () => {
    cancelled = true;
  };
};
var setTimer = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};
var setImmediate = (f) => {
  try {
    return setTimer(f);
  } catch {
    return setMicrotask(f);
  }
};
var PriorityBuckets = class {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (; index < len; index++) {
      if (buckets[index][0] > priority) break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
};
var MixedScheduler = class {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn ?? (executionMode === "sync" ? setMicrotask : setImmediate);
  }
  /**
   * Returns whether the fiber has reached its operation budget and should yield.
   *
   * **When to use**
   *
   * Use to decide whether a fiber should yield after consuming its current
   * operation budget.
   *
   * @since 2.0.0
   */
  shouldYield(fiber2) {
    return fiber2.currentOpCount >= fiber2.cache.maxOpsBeforeYield;
  }
  /**
   * Creates a dispatcher that schedules work through this scheduler.
   *
   * **When to use**
   *
   * Use when you need a standalone dispatcher from a scheduler instance, for
   * example in tests that enqueue tasks and then flush them deterministically.
   *
   * @since 4.0.0
   */
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
};
var MixedSchedulerDispatcher = class {
  tasks = /* @__PURE__ */ new PriorityBuckets();
  running = void 0;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  /**
   * @since 2.0.0
   */
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === void 0) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  /**
   * @since 2.0.0
   */
  afterScheduled = () => {
    this.running = void 0;
    this.runTasks();
  };
  /**
   * @since 2.0.0
   */
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0; i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0; j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  /**
   * @since 2.0.0
   */
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== void 0) {
        this.running();
        this.running = void 0;
      }
      this.runTasks();
    }
  }
};
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  fiberCached: true,
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  fiberCached: true,
  defaultValue: () => false
});

// node_modules/effect/dist/Data.js
var TaggedError2 = TaggedError;

// node_modules/effect/dist/Encoding.js
var EncodingErrorTypeId = "~effect/Encoding/EncodingError";
var EncodingError = class extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  /**
   * Marks this value as an encoding or decoding error for runtime guards.
   *
   * **When to use**
   *
   * Use to identify `EncodingError` instances through `isEncodingError`.
   *
   * @since 4.0.0
   */
  [EncodingErrorTypeId] = EncodingErrorTypeId;
};
var encodeBase64 = (input) => typeof input === "string" ? base64EncodeUint8Array(encoder.encode(input)) : base64EncodeUint8Array(input);
var decodeBase64 = (str2) => {
  const stripped = stripCrlf(str2);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Found a '=' character, but it is not at the end`
    }));
  }
  try {
    const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
    const result2 = new Uint8Array(3 * (length / 4) - missingOctets);
    for (let i = 0, j = 0; i < length; i += 4, j += 3) {
      const buffer = getBase64Code(stripped.charCodeAt(i)) << 18 | getBase64Code(stripped.charCodeAt(i + 1)) << 12 | getBase64Code(stripped.charCodeAt(i + 2)) << 6 | getBase64Code(stripped.charCodeAt(i + 3));
      result2[j] = buffer >> 16;
      result2[j + 1] = buffer >> 8 & 255;
      result2[j + 2] = buffer & 255;
    }
    return succeed2(result2);
  } catch (e) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: e instanceof Error ? e.message : "Invalid input"
    }));
  }
};
var encoder = /* @__PURE__ */ new TextEncoder();
var stripCrlf = (str2) => str2.replace(/[\n\r]/g, "");
var base64EncodeUint8Array = (bytes) => {
  const length = bytes.length;
  let result2 = "";
  let i;
  for (i = 2; i < length; i += 3) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result2 += base64abc[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result2 += base64abc[bytes[i] & 63];
  }
  if (i === length + 1) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4];
    result2 += "==";
  }
  if (i === length) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result2 += base64abc[(bytes[i - 1] & 15) << 2];
    result2 += "=";
  }
  return result2;
};
function getBase64Code(charCode) {
  if (charCode >= base64codes.length) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  const code = base64codes[charCode];
  if (code === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return code;
}
var base64abc = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "/"];
var base64codes = [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 62, 255, 255, 255, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 255, 255, 255, 0, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];

// node_modules/effect/dist/Tracer.js
var ParentSpanKey = "effect/Tracer/ParentSpan";
var TracerKey = "effect/Tracer";

// node_modules/effect/dist/internal/metric.js
var FiberRuntimeMetricsKey = "effect/Metric/FiberRuntimeMetrics";

// node_modules/effect/dist/internal/references.js
var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  fiberCached: true,
  defaultValue: constUndefined
});
var TracerEnabled = /* @__PURE__ */ Reference("effect/References/TracerEnabled", {
  fiberCached: true,
  defaultValue: constTrue
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});

// node_modules/effect/dist/internal/effect.js
var Interrupt = class extends ReasonBase {
  constructor(fiberId2, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId2;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return combine(string(`${this._tag}:${this.fiberId}`))(random(this.annotations));
  }
};
var causeInterrupt = (fiberId2) => new CauseImpl([new Interrupt(fiberId2)]);
var findError = (self) => {
  for (let i = 0; i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason._tag === "Fail") {
      return succeed2(reason.error);
    }
  }
  return fail2(self);
};
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var dedupeReasons = (self, that) => {
  const buckets = /* @__PURE__ */ new Map();
  const out = [];
  for (const reason of self.concat(that)) {
    const hash2 = hash(reason);
    const bucket = buckets.get(hash2);
    if (bucket === void 0) {
      buckets.set(hash2, [reason]);
    } else if (bucket.some((previous) => equals(previous, reason))) {
      continue;
    } else {
      bucket.push(reason);
    }
    out.push(reason);
  }
  return out;
};
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(dedupeReasons(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error), failure.annotations);
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var FiberTypeId = "~effect/Fiber";
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var getCurrentFiber = () => globalThis[currentFiberTypeId];
var FiberImpl = class {
  constructor(context2, interruptible2 = true) {
    this[FiberTypeId] = fiberVariance;
    this.setContext(context2);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.interruptible = interruptible2;
    this._stack = [];
    this._observers = void 0;
    this._exit = void 0;
    this._children = void 0;
    this._interruptedCause = void 0;
    this._yielded = void 0;
    this._running = false;
    this._deferredInterrupt = false;
    this._parent = void 0;
    this.cache.runtimeMetrics?.recordFiberStart(this.context);
  }
  [FiberTypeId];
  id;
  interruptible;
  currentOpCount;
  _stack;
  _observers;
  _exit;
  _children;
  _interruptedCause;
  _yielded;
  _running;
  _deferredInterrupt;
  _parent;
  // set in setContext
  context;
  cache;
  _dispatcher = void 0;
  get currentDispatcher() {
    return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
  }
  getRef(ref) {
    return get(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    if (this._observers === void 0) {
      this._observers = [cb];
    } else {
      this._observers.push(cb);
    }
    return () => {
      if (this._exit || this._observers === void 0) return;
      const index = this._observers.indexOf(cb);
      if (index >= 0) {
        this._observers.splice(index, 1);
      }
    };
  }
  interruptUnsafe(fiberId2, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId2);
    if (this.cache.stackFrame) {
      cause = causeAnnotate(cause, make(StackTraceKey, this.cache.stackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeCombine(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      if (this._running) {
        this._deferredInterrupt = true;
      } else {
        this.evaluate(failCause(this._interruptedCause));
      }
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._yielded !== void 0) {
      const yielded = this._yielded;
      this._yielded = void 0;
      yielded();
    }
    const exit3 = this.runLoop(effect);
    if (exit3 === Yield) {
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== void 0) {
      return this.evaluate(flatMap(interruptChildren, () => exit3));
    }
    this._exit = exit3;
    this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    if (this._parent) {
      this._parent._children?.delete(this);
      this._parent = void 0;
    }
    if (this._observers !== void 0) {
      const observers = this._observers;
      this._observers = void 0;
      for (let i = 0; i < observers.length; i++) {
        observers[i](exit3);
      }
    }
    this._stack.length = 0;
    this._children = void 0;
    this.context = empty3();
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    const prevRunning = this._running;
    this._running = true;
    let yielding = false;
    let current = effect;
    this.currentOpCount = 0;
    try {
      while (true) {
        if (this._deferredInterrupt) {
          this._deferredInterrupt = false;
          current = failCause(this._interruptedCause);
        }
        this.currentOpCount++;
        const cache = this.cache;
        if (!yielding && !cache.preventYield && cache.scheduler.shouldYield(this)) {
          yielding = true;
          const prev = current;
          current = flatMap(yieldNow, () => prev);
        }
        current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this);
        if (current === Yield) {
          const yielded = this._yielded;
          if (ExitTypeId in yielded) {
            this._deferredInterrupt = false;
            this._yielded = void 0;
            return yielded;
          } else if (this._deferredInterrupt) {
            this._yielded = void 0;
            yielded();
            continue;
          }
          return Yield;
        }
      }
    } catch (error) {
      if (!hasProperty(current, evaluate)) {
        return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
      }
      return this.runLoop(exitDie(error));
    } finally {
      this._running = prevRunning;
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol4) {
    if (this._deferredInterrupt) {
      this._deferredInterrupt = false;
      return deferredInterruptCont;
    }
    while (true) {
      const op = this._stack.pop();
      if (!op) return void 0;
      const all2 = op[contAll];
      if (all2 !== void 0) {
        const cont = all2.call(op, this);
        if (cont) {
          ;
          cont[symbol4] = cont;
          return cont;
        }
      }
      if (op[symbol4]) return op;
    }
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  children() {
    return this._children ??= /* @__PURE__ */ new Set();
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context2) {
    const previous = this.context;
    this.context = context2;
    if (previous !== void 0 && hasSameCache(previous, context2)) return;
    const root = context2.cacheRoot;
    const cache = root._fiberCache ??= makeFiberContextCache(context2);
    if (this.cache !== void 0 && this.cache.scheduler !== cache.scheduler) {
      this._dispatcher = void 0;
    }
    this.cache = cache;
  }
  get currentSpanLocal() {
    const span = this.cache.span;
    return span?._tag === "Span" ? span : void 0;
  }
};
var makeFiberContextCache = (context2) => {
  const currentTracer = getOrUndefinedUnsafe(context2, TracerKey);
  return {
    scheduler: get(context2, Scheduler),
    tracer: currentTracer,
    tracerContext: currentTracer ? currentTracer["context"] : void 0,
    tracerEnabled: get(context2, TracerEnabled),
    span: getOrUndefinedUnsafe(context2, ParentSpanKey),
    logLevel: get(context2, CurrentLogLevel),
    minimumLogLevel: get(context2, MinimumLogLevel),
    stackFrame: get(context2, CurrentStackFrame),
    runtimeMetrics: getOrUndefinedUnsafe(context2, FiberRuntimeMetricsKey),
    maxOpsBeforeYield: get(context2, MaxOpsBeforeYield),
    preventYield: get(context2, PreventSchedulerYield)
  };
};
var deferredInterruptCont = {
  [contA](_value, fiber2) {
    return failCause(fiber2._interruptedCause);
  },
  [contE](_cause, fiber2) {
    return failCause(fiber2._interruptedCause);
  }
};
var fiberMiddleware = {
  interruptChildren: void 0
};
var fiberStackAnnotations = (fiber2) => {
  if (!fiber2.cache.stackFrame) return void 0;
  const annotations = /* @__PURE__ */ new Map();
  annotations.set(InterruptorStackTrace.key, fiber2.cache.stackFrame);
  return makeUnsafe(annotations);
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = void 0;
  function loop() {
    let result2 = iter.next();
    while (!result2.done) {
      if (result2.value._exit) {
        exits.push(result2.value._exit);
        result2 = iter.next();
        continue;
      }
      cancel = result2.value.addObserver((exit3) => {
        exits.push(exit3);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  let fiberArr = empty2();
  for (const fiber2 of fibers) {
    fiber2.interruptUnsafe(parent.id, annotations);
    fiberArr.push(fiber2);
  }
  return asVoid(fiberAwaitAll(fiberArr));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber2) {
    const value = this[args]();
    const cont = fiber2.getCont(contA);
    return cont ? cont[contA](value, fiber2) : fiber2.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    return this[args]();
  }
});
var fromResult = /* @__PURE__ */ match({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber2) {
    let resumed = false;
    fiber2.currentDispatcher.scheduleTask(() => {
      if (resumed) return;
      fiber2.evaluate(exitVoid);
    }, this[args] ?? 0);
    return fiber2.yieldWith(() => {
      resumed = true;
    });
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var succeedNone = /* @__PURE__ */ succeed3(/* @__PURE__ */ none2());
var failCauseSync = (evaluate2) => suspend(() => failCause(internalCall(evaluate2)));
var die = (defect) => exitDie(defect);
var failSync = (error) => suspend(() => fail3(internalCall(error)));
var void_ = /* @__PURE__ */ succeed3(void 0);
var try_ = (options) => {
  const evaluate2 = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(internalCall(evaluate2));
    } catch (err) {
      return fail3(internalCall(() => catcher(err)));
    }
  });
};
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => {
      try {
        resume(fail3(internalCall(() => catcher(cause))));
      } catch (err) {
        resume(die(err));
      }
    };
    try {
      internalCall(() => f(signal)).then((a) => resume(succeed3(a)), failWithCatch);
    } catch (err) {
      failWithCatch(err);
    }
  }, f.length !== 0);
};
var callbackOptions = /* @__PURE__ */ (function() {
  const Proto2 = /* @__PURE__ */ makePrimitiveProto({
    op: "Async",
    [evaluate](fiber2) {
      const register = internalCall(() => this.register.bind(fiber2.cache.scheduler));
      let resumed = false;
      let yielded = false;
      const controller = this.withSignal ? new AbortController() : void 0;
      const onCancel = register((effect) => {
        if (resumed) return;
        resumed = true;
        if (yielded) {
          fiber2.evaluate(effect);
        } else {
          yielded = effect;
        }
      }, controller?.signal);
      if (yielded !== false) return yielded;
      yielded = true;
      fiber2._yielded = () => {
        resumed = true;
      };
      if (controller === void 0 && onCancel === void 0) {
        return Yield;
      }
      fiber2._stack.push(asyncFinalizer(() => {
        resumed = true;
        controller?.abort();
        return onCancel ?? exitVoid;
      }));
      return Yield;
    }
  });
  const AsyncImpl = function(register, withSignal) {
    this.register = register;
    this.withSignal = withSignal;
  };
  AsyncImpl.prototype = Proto2;
  return function(register, withSignal) {
    return new AsyncImpl(register, withSignal);
  };
})();
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber2) {
    if (fiber2.interruptible) {
      fiber2.interruptible = false;
      fiber2._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap(this[args](), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var defineFunctionLength = (length, fn2) => Object.defineProperty(fn2, "length", {
  value: length,
  configurable: true
});
var fnUntracedEager = (body, ...pipeables) => defineFunctionLength(body.length, pipeables.length === 0 ? function() {
  return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
} : function() {
  let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  for (const pipeable of pipeables) {
    effect = pipeable(effect, ...arguments);
  }
  return effect;
});
var fromIteratorEagerUnsafe = (evaluate2) => {
  try {
    const iterator = evaluate2();
    let value = void 0;
    while (true) {
      const state2 = iterator.next(value);
      if (state2.done) {
        return succeed3(state2.value);
      }
      const primitive = state2.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state2.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap(state2.value, (value2) => fromIteratorUnsafe(iterator, value2));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate2()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ (function() {
  const Proto2 = /* @__PURE__ */ makePrimitiveProto({
    op: "Iterator",
    [contA](value, fiber2) {
      const iter = this.iterator;
      while (true) {
        const state2 = iter.next(value);
        if (state2.done) return succeed3(state2.value);
        if (!effectIsExit(state2.value)) {
          fiber2._stack.push(this);
          return state2.value;
        } else if (state2.value._tag === "Failure") {
          return state2.value;
        }
        value = state2.value.value;
      }
    },
    [evaluate](fiber2) {
      return this[contA](this.initial, fiber2);
    }
  });
  const IteratorImpl = function(iterator, initial) {
    this.iterator = iterator;
    this.initial = initial;
  };
  IteratorImpl.prototype = Proto2;
  return function(iterator, initial) {
    return new IteratorImpl(iterator, initial);
  };
})();
var evaluateCont = function(fiber2) {
  fiber2._stack.push(this);
  return this[args];
};
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate]: evaluateCont
});
var OnSuccessImpl = function(self, f) {
  this[args] = self;
  this[contA] = f;
};
OnSuccessImpl.prototype = OnSuccessProto;
var ContImpl = function(self, cont, payload) {
  this[args] = self;
  this[contA] = cont;
  this.payload = payload;
};
ContImpl.prototype = OnSuccessProto;
var returnPayload = function() {
  return this.payload;
};
var mapCont = function(value) {
  const f = this.payload;
  return succeed3(internalCall(() => f(value)));
};
var asVoid = (self) => new ContImpl(self, returnPayload, exitVoid);
var flatMap = /* @__PURE__ */ dual(2, (self, f) => new OnSuccessImpl(self, f.length !== 1 ? (a) => f(a) : f));
var effectIsExit = (effect) => effect[ExitTypeId] !== void 0;
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap(self, f);
});
var map4 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, mapCont, f));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map4(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError(self, f));
var exitIsSuccess = (self) => self._tag === "Success";
var exitVoid = /* @__PURE__ */ exitSucceed(void 0);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success") return self;
  const error = findError(self.cause);
  if (isFailure2(error)) return self;
  return exitFail(f(error.success));
});
var catchCause = /* @__PURE__ */ dual(2, (self, f) => new OnFailureImpl(self, f.length !== 1 ? (cause) => f(cause) : f));
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate]: evaluateCont
});
var OnFailureImpl = function(self, f) {
  this[args] = self;
  this[contE] = f;
};
OnFailureImpl.prototype = OnFailureProto;
var catchCauseFilter = /* @__PURE__ */ dual(3, (self, filter3, f) => catchCause(self, (cause) => {
  const eb = filter3(cause);
  return isFailure2(eb) ? failCause(eb.failure) : internalCall(() => f(eb.success, cause));
}));
var catch_ = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findError, (e) => f(e)));
var mapError = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => failSync(() => f(error))));
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate]: evaluateCont
});
var OnSuccessAndFailureImpl = function(self, onSuccess, onFailure) {
  this[args] = self;
  this[contA] = onSuccess;
  this[contE] = onFailure;
};
OnSuccessAndFailureImpl.prototype = OnSuccessAndFailureProto;
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber2) {
    fiber2._stack.push(this);
    return this[args];
  },
  [contA](value, _, exit3) {
    return succeed3(exit3 ?? exitSucceed(value));
  },
  [contE](cause, _, exit3) {
    return succeed3(exit3 ?? exitFailCause(cause));
  }
});
var uninterruptible = (self) => withFiber((fiber2) => {
  if (!fiber2.interruptible) return self;
  fiber2.interruptible = false;
  fiber2._stack.push(setInterruptibleTrue);
  return self;
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber2) {
    fiber2.interruptible = this[args];
    if (fiber2._interruptedCause && fiber2.interruptible) {
      return () => failCause(fiber2._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber2) {
    this[args].step(value);
    if (this[args].while()) {
      fiber2._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber2) {
    if (this[args].while()) {
      fiber2._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var resolveConcurrency = (concurrency) => concurrency === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrency ?? 1);
var iterateEager = () => (options) => {
  const onItem = options.onItem;
  const step = options.step;
  const runSequential = (state2, items, index = 0, end = items.length) => {
    for (; index < end; index++) {
      const item = items[index];
      const effect = onItem(state2, item, index);
      if (!effectIsExit(effect)) {
        return flatMap(exit(effect), (itemExit) => step(state2, item, itemExit, index) ?? runSequential(state2, items, index + 1, end) ?? void_);
      }
      const terminal = step(state2, item, effect, index);
      if (terminal) return terminal._tag === "Failure" ? terminal : void 0;
    }
  };
  return runSequential;
};
var iterateConcurrentImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state2, items, opts) => {
    let index = 0;
    const end = opts.end ?? items.length;
    const concurrency = opts.concurrency;
    let done2 = false;
    let parentFiber;
    let fibers;
    let resume;
    let interrupted = false;
    let terminal;
    let effect;
    const failDefect = (error) => {
      const defect = exitDie(error);
      terminal = defect;
      done2 = true;
      interrupted = true;
      return fibers && fibers.size > 0 ? flatMap(uninterruptible(fiberInterruptAll(Array.from(fibers))), () => defect) : defect;
    };
    const go = () => {
      let paused = false;
      for (; !terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state2, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state2, item, eff, index);
          if (terminal) break;
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            fibers = /* @__PURE__ */ new Set();
            effect = eff;
            resume = cb;
            let result2;
            try {
              result2 = go();
            } catch (error) {
              return cb(failDefect(error));
            }
            if (result2) return cb(result2);
            return suspend(() => {
              terminal = exitVoid;
              interrupted = true;
              return fibers ? fiberInterruptAll(fibers) : void_;
            });
          });
        } else {
          effect = void 0;
          const fiber2 = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber2._exit) {
            terminal = step(state2, item, fiber2._exit, index);
            if (terminal) break;
            continue;
          }
          fibers.add(fiber2);
          const currentIndex = index;
          fiber2.addObserver((exit3) => {
            fibers.delete(fiber2);
            try {
              if (terminal) {
                if (!interrupted && exit3._tag === "Failure") {
                  for (const reason of exit3.cause.reasons) {
                    if (reason._tag === "Interrupt") continue;
                    else if (terminal._tag === "Failure") {
                      ;
                      terminal.cause.reasons.push(reason);
                    } else {
                      terminal = exitFailCause(causeFromReasons([reason]));
                    }
                  }
                }
              } else {
                const result2 = step(state2, item, exit3, currentIndex);
                if (result2) {
                  terminal = result2._tag === "Failure" ? exitFailCause(causeFromReasons(result2.cause.reasons.slice())) : result2;
                  go();
                }
              }
              if (paused) {
                const eff2 = go();
                if (eff2) resume(eff2);
              } else if (done2 && fibers.size === 0) {
                resume(terminal ?? void_);
              }
            } catch (error) {
              resume(failDefect(error));
            }
          });
          if (fibers.size < concurrency) continue;
          paused = true;
          index++;
          return;
        }
      }
      done2 = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_);
        }
      }
    };
    return go();
  };
};
var iterateConcurrent = () => (options) => iterateConcurrentImpl(options);
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible2 = false) => {
  const parentRuntime = parent;
  const interruptible2 = uninterruptible2 === "inherit" ? parentRuntime.interruptible : !uninterruptible2;
  const child = new FiberImpl(parentRuntime.context, interruptible2);
  if (immediate) {
    child.evaluate(effect);
  } else {
    parentRuntime.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  if (!daemon && !child._exit) {
    parentRuntime.children().add(child);
    child._parent = parentRuntime;
  }
  return child;
};
var runForkWith = (context2) => (effect, options) => {
  const fiber2 = new FiberImpl(options?.scheduler ? add(context2, Scheduler, options.scheduler) : context2, options?.uninterruptible !== true);
  fiber2.evaluate(effect);
  if (fiber2._exit) return fiber2;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber2.interruptUnsafe();
    } else {
      const abort = () => fiber2.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber2.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber2);
  }
  return fiber2;
};
var runSyncExitWith = (context2) => {
  const runFork2 = runForkWith(context2);
  return (effect) => {
    if (effectIsExit(effect)) return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber2 = runFork2(effect, {
      scheduler
    });
    fiber2._dispatcher?.flush();
    return fiber2._exit ?? exitDie(new AsyncFiberError(fiber2));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty3());
var MAX_TIMER_MILLIS = 2 ** 31 - 1;
var TimeoutErrorTypeId = "~effect/Cause/TimeoutError";
var TimeoutError = class extends (/* @__PURE__ */ TaggedError("TimeoutError")) {
  [TimeoutErrorTypeId] = TimeoutErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
};
var IllegalArgumentErrorTypeId = "~effect/Cause/IllegalArgumentError";
var IllegalArgumentError = class extends (/* @__PURE__ */ TaggedError("IllegalArgumentError")) {
  [IllegalArgumentErrorTypeId] = IllegalArgumentErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
};
var ExceededCapacityErrorTypeId = "~effect/Cause/ExceededCapacityError";
var ExceededCapacityError = class extends (/* @__PURE__ */ TaggedError("ExceededCapacityError")) {
  [ExceededCapacityErrorTypeId] = ExceededCapacityErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
};
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
var AsyncFiberError = class extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber2) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber: fiber2
    });
  }
};
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
var UnknownError = class extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
};
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};

// node_modules/effect/dist/Cause.js
var isFailReason2 = isFailReason;
var map5 = causeMap;

// node_modules/effect/dist/Exit.js
var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail4 = exitFail;
var void_2 = exitVoid;
var isSuccess3 = exitIsSuccess;

// node_modules/effect/dist/Effect.js
var tryPromise2 = tryPromise;
var succeed5 = succeed3;
var succeedNone2 = succeedNone;
var fail5 = fail3;
var failCauseSync2 = failCauseSync;
var die2 = die;
var try_2 = try_;
var fromResult2 = fromResult;
var flatMap2 = flatMap;
var exit2 = exit;
var catchCause2 = catchCause;
var runSyncExit2 = runSyncExit;
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var flatMapEager2 = flatMapEager;
var fnUntracedEager2 = fnUntracedEager;

// node_modules/effect/dist/internal/schema/annotations.js
function resolve(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var SENTINELS_ANNOTATION_KEY = "~sentinels";
var CONSTRUCTOR_ANNOTATION_KEY = "~constructor";
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier2 = resolve(ast)?.identifier;
  if (typeof identifier2 === "string") return identifier2;
  return ast.getExpected(getExpected);
});

// node_modules/effect/dist/internal/schema/parser.js
var missing = /* @__PURE__ */ Symbol();
var succeed6 = succeed4;
var missingExit = /* @__PURE__ */ succeed6(missing);
var sameExit = /* @__PURE__ */ succeed6(missing);
var toOption = (value) => value === missing ? none2() : some2(value);
var fromOptionExit = (option2) => option2._tag === "None" ? missingExit : succeed6(option2.value);

// node_modules/effect/dist/SchemaIssue.js
var TypeId4 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId4) && u[TypeId4] === TypeId4;
}
function hasInput(issue) {
  return Object.hasOwn(issue, "input");
}
var IssueNodeImpl = class {
  [TypeId4] = TypeId4;
  constructor(input, options) {
    if (options?.reportInput === true && input !== missing) {
      this.input = input;
    }
  }
};
var Filter = class extends IssueNodeImpl {
  _tag = "Filter";
  /**
   * The filter that failed.
   */
  filter;
  /**
   * The issue that occurred.
   */
  issue;
  constructor(filter3, issue, input, options) {
    super(input, options);
    this.filter = filter3;
    this.issue = issue;
  }
};
var Encoding = class extends IssueNodeImpl {
  _tag = "Encoding";
  /**
   * The schema that caused the issue.
   */
  ast;
  /**
   * The issue that occurred.
   */
  issue;
  constructor(ast, issue, input, options) {
    super(input, options);
    this.ast = ast;
    this.issue = issue;
  }
};
var Pointer = class extends IssueNodeImpl {
  _tag = "Pointer";
  /**
   * The path to the location in the input that caused the issue.
   */
  path;
  /**
   * The issue that occurred.
   */
  issue;
  constructor(path3, issue) {
    super();
    this.path = path3;
    this.issue = issue;
  }
};
var MissingKey = class extends IssueNodeImpl {
  _tag = "MissingKey";
  /**
   * The metadata for the issue.
   */
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
};
var UnexpectedKey = class extends IssueNodeImpl {
  _tag = "UnexpectedKey";
  /**
   * The schema that caused the issue.
   */
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var Composite = class extends IssueNodeImpl {
  _tag = "Composite";
  /**
   * The schema that caused the issue.
   */
  ast;
  /**
   * The issues that occurred.
   */
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var InvalidType = class extends IssueNodeImpl {
  _tag = "InvalidType";
  /**
   * The schema that caused the issue.
   */
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var InvalidValue = class extends IssueNodeImpl {
  _tag = "InvalidValue";
  /**
   * The metadata for the issue.
   */
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var AnyOf = class extends IssueNodeImpl {
  _tag = "AnyOf";
  /**
   * The schema that caused the issue.
   */
  ast;
  /**
   * The issues that occurred.
   */
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var OneOf = class extends IssueNodeImpl {
  _tag = "OneOf";
  /**
   * The schema that caused the issue.
   */
  ast;
  /**
   * The schemas that were successful.
   */
  successes;
  constructor(ast, successes, input, options) {
    super(input, options);
    this.ast = ast;
    this.successes = successes;
  }
};
function makeFilterIssue(entry, input, options) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue({
      message: entry
    }, input, options);
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue({
    message: entry.issue
  }, input, options) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(out, input, options) {
  if (out === void 0) {
    return void 0;
  }
  if (typeof out === "boolean") {
    return out ? void 0 : new InvalidValue(void 0, input, options);
  }
  return makeFilterIssue(out, input, options);
}
function normalizeFilterOutput(ast, out, input, options) {
  if (Array.isArray(out)) {
    if (!isReadonlyArrayNonEmpty(out)) {
      return void 0;
    }
    return out.length === 1 ? makeFilterIssue(out[0], input, options) : new Composite(ast, map2(out, (entry) => makeFilterIssue(entry, input, options)), input, options);
  }
  return makeSingle(out, input, options);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== void 0) return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), issue);
    case "InvalidValue": {
      const expected = findExpected(issue);
      if (expected !== void 0) return getExpectedMessage(expected, issue);
      const input = formatInput(issue);
      return input === void 0 ? "Expected a valid value" : `Invalid data ${input}`;
    }
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey": {
      const input = formatInput(issue);
      return input === void 0 ? "Expected no excess property" : `Unexpected key with value ${input}`;
    }
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf": {
      const input = formatInput(issue);
      return input === void 0 ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${input}`;
    }
  }
};
var defaultCheckHook = (issue) => findMessage(issue.issue) ?? findMessage(issue);
function formatInput(issue) {
  return hasInput(issue) ? format(issue.input) : void 0;
}
function findExpected(issue) {
  const expected = issue.annotations?.expected;
  return typeof expected === "string" ? expected : void 0;
}
function getExpectedMessage(expected, issue) {
  const input = formatInput(issue);
  return input === void 0 ? `Expected ${expected}` : `Expected ${expected}, got ${input}`;
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string") return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check2) => formatCheck(check2)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => formatIssue(issue, "");
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatIssue(issue, path3) {
  let message;
  switch (issue._tag) {
    case "Filter": {
      const annotated = defaultCheckHook(issue);
      if (annotated !== void 0) {
        message = annotated;
      } else {
        if (issue.issue._tag !== "InvalidValue") {
          return formatIssue(issue.issue, path3);
        }
        const expected = findExpected(issue.issue);
        message = expected === void 0 ? getExpectedMessage(formatCheck(issue.filter), issue) : getExpectedMessage(expected, issue.issue);
      }
      break;
    }
    case "Encoding":
      return formatIssue(issue.issue, path3);
    case "Pointer":
      return formatIssue(issue.issue, path3 + formatPath(issue.path));
    case "Composite":
    case "AnyOf": {
      if (issue._tag === "Composite" || issue.issues.length > 0) {
        return issue.issues.map((issue2) => formatIssue(issue2, path3)).join("\n");
      }
      message = findMessage(issue) ?? getExpectedMessage(getExpected(issue.ast), issue);
      break;
    }
    default:
      message = defaultLeafHook(issue);
      break;
  }
  return path3 ? `${message}
  at ${path3}` : message;
}
function findMessage(issue) {
  if (issue._tag === "Pointer") return;
  if (issue._tag === "Encoding") return findMessage(issue.issue);
  const annotations = issue._tag === "Filter" ? issue.filter.annotations : "annotations" in issue ? issue.annotations : issue.ast.annotations;
  const message = annotations?.[issue._tag === "MissingKey" ? "messageMissingKey" : issue._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
  if (typeof message === "string") return message;
}

// node_modules/effect/dist/internal/schema/cause.js
function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return void 0;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === void 0) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

// node_modules/effect/dist/SchemaGetter.js
var Getter = class extends Class {
  run;
  constructor(run2) {
    super();
    this.run = run2;
  }
  map(f) {
    return new Getter((oe, options) => this.run(oe, options).pipe(mapEager2(map(f))));
  }
  compose(other) {
    if (isPassthrough(this)) {
      return other;
    }
    if (isPassthrough(other)) {
      return this;
    }
    return new Getter((oe, options) => this.run(oe, options).pipe(flatMapEager2((ot) => other.run(ot, options))));
  }
};
var passthrough_ = /* @__PURE__ */ new Getter(succeed5);
function isPassthrough(getter) {
  return getter.run === passthrough_.run;
}
function passthrough() {
  return passthrough_;
}
function onSome(f) {
  return new Getter((oe, options) => isNone2(oe) ? succeedNone2 : f(oe.value, options));
}
function transform(f) {
  return transformOptional(map(f));
}
function transformEffect(f) {
  return onSome((e, options) => f(e, options).pipe(mapEager2(some2)));
}
function transformOptional(f) {
  return new Getter((oe) => succeed5(f(oe)));
}
function withDefault(defaultValue) {
  return new Getter((o) => {
    const filtered = filter(o, isNotUndefined);
    return isSome2(filtered) ? succeed5(filtered) : mapEager2(defaultValue, some2);
  });
}
function String2() {
  return transform(globalThis.String);
}
function Number2() {
  return transform(globalThis.Number);
}
function encodeBase642() {
  return transform(encodeBase64);
}
function decodeBase642() {
  return transformEffect((input, options) => mapErrorEager2(fromResult2(decodeBase64(input)), () => new InvalidValue({
    expected: "a valid Base64 string"
  }, input, options)));
}

// node_modules/effect/dist/SchemaTransformation.js
var TypeId5 = "~effect/SchemaTransformation/Transformation";
var Transformation = class {
  [TypeId5] = TypeId5;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
  compose(other) {
    return new Transformation(this.decode.compose(other.decode), other.encode.compose(this.encode));
  }
};
function isTransformation(u) {
  return hasProperty(u, TypeId5) && u[TypeId5] === TypeId5;
}
var make2 = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformEffect2(options) {
  return new Transformation(transformEffect(options.decode), transformEffect(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough(), /* @__PURE__ */ passthrough());
function passthrough2() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number2(), /* @__PURE__ */ String2());
var isJsonError = (input) => isObject(input) && typeof input["message"] === "string";
var decodeJsonError = (input) => {
  const hasCause = Object.hasOwn(input, "cause");
  const err = hasCause ? new Error(input.message, {
    cause: decodeDefect(input.cause)
  }) : new Error(input.message);
  if (typeof input.name === "string" && input.name !== "Error") err.name = input.name;
  if (typeof input.stack === "string") err.stack = input.stack;
  return err;
};
var encodeUnknownAsJson = (input) => {
  try {
    const json = formatJson(input);
    return json === void 0 ? format(input) : JSON.parse(json);
  } catch {
    return format(input);
  }
};
var encodeJsonError = (input, options, encodeDefect) => {
  const encoded = {
    name: input.name,
    message: typeof input.message === "string" ? input.message : ""
  };
  if (options?.includeStack && typeof input.stack === "string") {
    encoded.stack = input.stack;
  }
  if (!options?.excludeCause && input.cause !== void 0) {
    encoded.cause = encodeDefect(input.cause);
  }
  return encoded;
};
var makeEncodeDefect = (options) => {
  const seen = /* @__PURE__ */ new WeakSet();
  const encode = (input) => {
    if (isError(input)) {
      if (seen.has(input)) {
        return "[Circular]";
      }
      seen.add(input);
      const encoded = encodeJsonError(input, options, encode);
      seen.delete(input);
      return encoded;
    }
    return encodeUnknownAsJson(input);
  };
  return encode;
};
var decodeDefect = (input) => isJsonError(input) ? decodeJsonError(input) : input;
var defectFromJson = (options) => transform2({
  decode: decodeDefect,
  encode: makeEncodeDefect(options)
});
var urlFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => URL.canParse(s) ? succeed5(new URL(s)) : fail5(new InvalidValue({
    expected: "a valid URL string"
  }, s, options)),
  encode: (url) => succeed5(url.href)
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase642(), /* @__PURE__ */ encodeBase642());

// node_modules/effect/dist/SchemaAST.js
function makeGuard(tag2) {
  return (ast) => ast._tag === tag2;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isSuspend = /* @__PURE__ */ makeGuard("Suspend");
var Link = class {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
};
var defaultParseOptions = {};
var Context = class {
  isOptional;
  isMutable;
  /** Used for constructor default values (e.g. `withConstructorDefault` API) */
  constructorDefault;
  annotations;
  constructor(isOptional2, isMutable, constructorDefault = void 0, annotations = void 0) {
    this.isOptional = isOptional2;
    this.isMutable = isMutable;
    this.constructorDefault = constructorDefault;
    this.annotations = annotations;
  }
};
var TypeId6 = "~effect/Schema";
var ASTNodeImpl = class {
  [TypeId6] = TypeId6;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = void 0, checks = void 0, encoding = void 0, context2 = void 0) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context2;
  }
  toString() {
    return `<${this._tag}>`;
  }
};
var Declaration = class extends ASTNodeImpl {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  /**
   * Parser factory {@link flip} swaps in, so a declaration can behave
   * differently when encoding. `undefined` reuses `run`.
   */
  encodingRun;
  constructor(typeParameters, run2, annotations, checks, encoding, context2, encodingChecks, encodingRun) {
    super(annotations, checks, encoding, context2);
    this.typeParameters = typeParameters;
    this.run = run2;
    this.encodingChecks = encodingChecks;
    this.encodingRun = encodingRun;
  }
  /** @internal */
  getParser() {
    let run2;
    return (input, options) => {
      if (input === missing) return missingExit;
      return (run2 ??= this.run(this.typeParameters))(input, this, options);
    };
  }
  _rebuild(recur, checks, encodingChecks, run2, encodingRun) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks && run2 === this.run && encodingRun === this.encodingRun ? this : new Declaration(tps, run2, this.annotations, checks, void 0, this.context, encodingChecks, encodingRun);
  }
  /** @internal */
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks, this.run, this.encodingRun);
  }
  /** @internal */
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
  }
  /** @internal */
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string") return expected;
    return "<Declaration>";
  }
};
var Null = class extends ASTNodeImpl {
  _tag = "Null";
  /** @internal */
  getParser() {
    return fromConst(this, null);
  }
  /** @internal */
  getExpected() {
    return "null";
  }
};
var null_ = /* @__PURE__ */ new Null();
var Undefined = class extends ASTNodeImpl {
  _tag = "Undefined";
  /** @internal */
  getParser() {
    return fromConst(this, void 0);
  }
  /** @internal */
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  /** @internal */
  getExpected() {
    return "undefined";
  }
};
var undefinedToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => void 0), /* @__PURE__ */ transform(() => null)));
var undefined_2 = /* @__PURE__ */ new Undefined();
var Unknown = class extends ASTNodeImpl {
  _tag = "Unknown";
  /** @internal */
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  /** @internal */
  getExpected() {
    return "unknown";
  }
};
var unknown = /* @__PURE__ */ new Unknown();
var Literal = class extends ASTNodeImpl {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context2) {
    super(annotations, checks, encoding, context2);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  /** @internal */
  getParser() {
    return fromConst(this, this.literal);
  }
  /** @internal */
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : void 0;
  }
  /** @internal */
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  /** @internal */
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  /** @internal */
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
};
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}
var String3 = class extends ASTNodeImpl {
  _tag = "String";
  /** @internal */
  getParser() {
    return fromRefinement(this, isString);
  }
  /** @internal */
  matchPart(s, options) {
    const checks = this.checks;
    return checks && !options.disableChecks && collectIssues(checks, s, void 0, this, options) ? void 0 : s;
  }
  /** @internal */
  getExpected() {
    return "string";
  }
};
var string2 = /* @__PURE__ */ new String3();
var Number3 = class extends ASTNodeImpl {
  _tag = "Number";
  /** @internal */
  getParser() {
    return fromRefinement(this, isNumber);
  }
  /** @internal */
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  /** @internal */
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    if (!regexp.test(s)) return void 0;
    const value = globalThis.Number(s);
    if (options.disableChecks || !this.checks) return value;
    return collectIssues(this.checks, value, void 0, this, options) ? void 0 : value;
  }
  /** @internal */
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "effect/schema/isFinite") || hasCheck(this.checks, "effect/schema/isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  /** @internal */
  toCodecStringTree() {
    if (this.toCodecJson() === this) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  /** @internal */
  getExpected() {
    return "number";
  }
};
function hasCheck(checks, id2) {
  return checks.some((check) => check.annotations?.representation?.id === id2 || check._tag === "FilterGroup" && hasCheck(check.checks, id2));
}
var number2 = /* @__PURE__ */ new Number3();
var Arrays = class extends ASTNodeImpl {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    let hasOptional = false;
    for (let i = 0; i < elements.length; i++) {
      if (isOptional(elements[i])) {
        hasOptional = true;
      } else if (hasOptional) {
        throw new Error("A required element cannot follow an optional element. ts(1257)");
      }
    }
    if (hasOptional && rest.length > 1) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    for (let i = 1; i < rest.length; i++) {
      if (isOptional(rest[i])) {
        throw new Error("An optional element cannot follow a rest element. ts(1266)");
      }
    }
  }
  /** @internal */
  getParser(compile, compileConstructorDefault2 = compile) {
    const ast = this;
    let elements;
    let rest;
    const elementLen = ast.elements.length;
    const tailLen = Math.max(0, ast.rest.length - 1);
    function getParser(tailThreshold, index) {
      if (index < elementLen) {
        return elements[index];
      } else if (index >= tailThreshold) {
        return rest[index - tailThreshold + 1];
      }
      return rest[0];
    }
    return fnUntracedEager2(function* (input, options) {
      if (input === missing) {
        return missing;
      }
      if (!Array.isArray(input)) {
        return yield* fail5(new InvalidType(ast, input, options));
      }
      if (!elements) {
        elements = ast.elements.map((ast2) => ({
          ast: ast2,
          parser: compileConstructorDefault2(ast2)
        }));
        rest = ast.rest.map((ast2) => ({
          ast: ast2,
          parser: compileConstructorDefault2(ast2)
        }));
      }
      const len = input.length;
      const state2 = {
        ast,
        getParser,
        input,
        len,
        tailThreshold: Math.max(elementLen, len - tailLen),
        output: new globalThis.Array(len),
        issues: void 0,
        options
      };
      const end = ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen);
      const concurrency = options.concurrency === void 0 ? 1 : resolveConcurrency(options.concurrency);
      const eff = concurrency === 1 ? parseArray(state2, input, 0, end) : parseArrayConcurrent(state2, input, {
        concurrency,
        end
      });
      if (eff) yield* eff;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen; i <= len - 1; i++) {
          const unexpected = new UnexpectedKey(ast, input[i], options);
          const issue = new Pointer([i], unexpected);
          if (options.errors === "all") {
            if (state2.issues) state2.issues.push(issue);
            else state2.issues = [issue];
          } else {
            return yield* fail5(new Composite(ast, [issue], input, options));
          }
        }
      }
      if (state2.issues) {
        return yield* fail5(new Composite(ast, state2.issues, input, options));
      }
      return state2.output;
    });
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, void 0, this.context, encodingChecks);
  }
  /** @internal */
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  /** @internal */
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  /** @internal */
  getExpected() {
    return "array";
  }
};
var parseArrayOptions = {
  onItem(s, item, i) {
    const value = i < s.len ? item : missing;
    return s.getParser(s.tailThreshold, i).parser(value, s.options);
  },
  step(s, item, exit3, i) {
    if (exit3._tag === "Failure") {
      return wrapPropertyKeyIssue(s, s.ast, i, exit3);
    }
    const value = exit3 === sameExit ? item : exit3[args];
    if (value !== missing) {
      s.output[i] = value;
    } else {
      const p = s.getParser(s.tailThreshold, i);
      if (isOptional(p.ast)) return;
      const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
      if (s.options.errors === "all") {
        if (s.issues) s.issues.push(issue);
        else s.issues = [issue];
      } else {
        return fail4(new Composite(s.ast, [issue], s.input, s.options));
      }
    }
  }
};
var parseArray = /* @__PURE__ */ iterateEager()(parseArrayOptions);
var parseArrayConcurrent = /* @__PURE__ */ iterateConcurrent()(parseArrayOptions);
var wrapPropertyKeyIssue = (s, ast, key, exit3) => {
  if (exit3.cause.reasons.length === 0) {
    return exit3;
  }
  const issue = getSchemaIssue(exit3.cause);
  if (issue === void 0) {
    return failCause2(map5(exit3.cause, (issue2) => new Composite(ast, [new Pointer([key], issue2)], s.input, s.options)));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues) s.issues.push(pointer);
    else s.issues = [pointer];
  } else {
    return fail4(new Composite(ast, [pointer], s.input, s.options));
  }
};
var FINITE_PATTERN = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter2) {
    switch (parameter2._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter2.matchPart(k, options) !== void 0);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter2.matchKey(k, options) !== void 0);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => parameter2.matchKey(k, options) !== void 0);
      case "Union":
        return [...new Set(parameter2.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}
var PropertySignature = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
};
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameterEncodedSide(ast) {
  const encoded = getLastEncoding(ast);
  switch (encoded._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return encoded.types.every(isIndexSignatureParameterEncodedSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterEncodedSide(ast);
}
var IndexSignature = class {
  parameter;
  type;
  constructor(parameter, type) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    if (isOptional(type) && !containsUndefined(type)) {
      throw new Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
    }
  }
};
var Objects = class extends ASTNodeImpl {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
    const seen = /* @__PURE__ */ new Set();
    const duplicates = [];
    for (const propertySignature of propertySignatures) {
      const name = propertySignature.name;
      if (seen.has(name)) {
        duplicates.push(name);
      } else {
        seen.add(name);
      }
    }
    if (duplicates.length > 0) {
      throw new Error(`Duplicate identifiers: ${JSON.stringify(duplicates)}. ts(2300)`);
    }
  }
  /** @internal */
  getParser(compile, compileConstructorDefault2 = compile) {
    const ast = this;
    const expectedKeys = [];
    for (const ps of ast.propertySignatures) {
      expectedKeys.push(typeof ps.name === "number" ? globalThis.String(ps.name) : ps.name);
    }
    const hasProperties = expectedKeys.length;
    const indexCount = ast.indexSignatures.length;
    let expectedKeysSet = hasProperties && indexCount ? new Set(expectedKeys) : void 0;
    if (!hasProperties && !indexCount) {
      return fromRefinement(ast, isNotNullish);
    }
    let properties;
    let indexes;
    const finishIndex = (s, key, k2, inputValue, exitValue) => {
      if (exitValue._tag === "Failure") {
        return wrapPropertyKeyIssue(s, ast, key, exitValue) ?? void_2;
      }
      const value = exitValue === sameExit ? inputValue : exitValue[args];
      if (k2 !== missing && value !== missing) {
        if (hasProperties && (expectedKeysSet.has(key) || expectedKeysSet.has(typeof k2 === "number" ? globalThis.String(k2) : k2))) return void_2;
        assignProperty(s.out, k2, value);
      }
      return void_2;
    };
    const parseIndex = (s, key, index, exitKey) => {
      if (!exitKey) {
        const eff = index.parserKey(key, s.options);
        if (!effectIsExit(eff)) {
          return flatMap2(exit2(eff), (exit3) => parseIndex(s, key, index, exit3));
        }
        exitKey = eff;
      }
      if (exitKey._tag === "Failure") {
        return wrapPropertyKeyIssue(s, ast, key, exitKey) ?? void_2;
      }
      const k2 = exitKey === sameExit ? key : exitKey[args];
      const inputValue = s.input[key];
      const result2 = index.parserValue(inputValue, s.options);
      return effectIsExit(result2) ? finishIndex(s, key, k2, inputValue, result2) : flatMap2(exit2(result2), (exit3) => finishIndex(s, key, k2, inputValue, exit3));
    };
    const parseStringIndex = (s, key, index) => {
      const inputValue = s.input[key];
      const result2 = index.parserValue(inputValue, s.options);
      return effectIsExit(result2) ? finishIndex(s, key, key, inputValue, result2) : flatMap2(exit2(result2), (exit3) => finishIndex(s, key, key, inputValue, exit3));
    };
    const parseIndexes = indexCount ? iterateConcurrent()({
      onItem: (s, [key, index]) => index.is.parameter === string2 ? parseStringIndex(s, key, index) : parseIndex(s, key, index),
      step: (_s, _item, exit3) => exit3._tag === "Failure" ? exit3 : void 0
    }) : void 0;
    const compileMembers = () => {
      if (!properties) {
        properties = ast.propertySignatures.map((ps) => ({
          parser: compileConstructorDefault2(ps.type),
          name: ps.name,
          type: ps.type
        }));
        indexes = indexCount ? ast.indexSignatures.map((is3) => ({
          is: is3,
          parserKey: compile(parameterFromPropertyKey(is3.parameter)),
          parserValue: compileConstructorDefault2(is3.type)
        })) : void 0;
      }
      return properties;
    };
    const fallback = fnUntracedEager2(function* (input, options) {
      if (input === missing) {
        return missing;
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return yield* fail5(new InvalidType(ast, input, options));
      }
      compileMembers();
      const record2 = input;
      const out = {};
      const state2 = {
        ast,
        input: record2,
        out,
        issues: void 0,
        options
      };
      const errorsAllOption = options.errors === "all";
      const onExcessPropertyError = options.onExcessProperty === "error";
      const concurrency = options.concurrency === void 0 ? 1 : resolveConcurrency(options.concurrency);
      const indexKeys = indexCount && onExcessPropertyError ? ast.indexSignatures.map((index) => getIndexSignatureKeys(record2, index.parameter, options)) : void 0;
      if (onExcessPropertyError) {
        expectedKeysSet ??= new Set(expectedKeys);
        const coveredKeys = indexKeys ? new Set(expectedKeysSet) : expectedKeysSet;
        if (indexKeys) {
          for (const keys of indexKeys) {
            for (const key of keys) coveredKeys.add(key);
          }
        }
        const inputKeys = Reflect.ownKeys(record2);
        for (let i = 0; i < inputKeys.length; i++) {
          const key = inputKeys[i];
          if (!coveredKeys.has(key)) {
            const unexpected = new UnexpectedKey(ast, record2[key], options);
            const issue = new Pointer([key], unexpected);
            if (errorsAllOption) {
              if (state2.issues) {
                state2.issues.push(issue);
              } else {
                state2.issues = [issue];
              }
              continue;
            } else {
              return yield* fail5(new Composite(ast, [issue], input, options));
            }
          }
        }
      }
      if (hasProperties) {
        const eff = concurrency === 1 ? parseProperties(state2, properties) : parsePropertiesConcurrent(state2, properties, {
          concurrency
        });
        if (eff) yield* eff;
      }
      if (indexCount && concurrency === 1) {
        for (let i = 0; i < indexCount; i++) {
          const index = indexes[i];
          const parse = index.is.parameter === string2 ? parseStringIndex : parseIndex;
          const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record2) : getIndexSignatureKeys(record2, index.is.parameter, options));
          for (let j = 0; j < keys.length; j++) {
            const eff = parse(state2, keys[j], index);
            if (!effectIsExit(eff)) yield* eff;
            else if (eff._tag === "Failure") return yield* eff;
          }
        }
      } else if (parseIndexes) {
        const keyPairs = empty2();
        for (let i = 0; i < indexCount; i++) {
          const index = indexes[i];
          const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record2) : getIndexSignatureKeys(record2, index.is.parameter, options));
          for (let j = 0; j < keys.length; j++) {
            keyPairs.push([keys[j], index]);
          }
        }
        const eff = parseIndexes(state2, keyPairs, {
          concurrency
        });
        if (eff) yield* eff;
      }
      if (state2.issues) {
        return yield* fail5(new Composite(ast, state2.issues, input, options));
      }
      return out;
    });
    if (indexCount) return fallback;
    const resume = (state2, index, pending) => {
      const property = properties[index];
      return flatMap2(exit2(pending), (exit3) => {
        const terminal = stepProperty(state2, property, exit3);
        if (terminal) return terminal;
        const done2 = () => succeed6(state2.out);
        const eff = parseProperties(state2, properties.slice(index + 1));
        return eff ? flatMapEager2(eff, done2) : done2();
      });
    };
    return (input, options) => {
      if (input === missing) return missingExit;
      if (options.errors === "all" || options.onExcessProperty !== void 0 || options.concurrency !== void 0 && resolveConcurrency(options.concurrency) !== 1) {
        return fallback(input, options);
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return fail5(new InvalidType(ast, input, options));
      }
      const props = compileMembers();
      const record2 = input;
      const out = {};
      const state2 = {
        ast,
        input: record2,
        out,
        issues: void 0,
        options
      };
      try {
        for (let index = 0; index < props.length; index++) {
          const property = props[index];
          const name = property.name;
          const hasKey = hasPropertySignature(record2, name);
          const value = hasKey ? record2[name] : missing;
          const exit3 = property.parser(value, options);
          if (!effectIsExit(exit3)) {
            return resume(state2, index, exit3);
          }
          if (exit3 === sameExit) {
            if (hasKey) assignProperty(out, name, value);
            continue;
          }
          const terminal = stepProperty(state2, property, exit3);
          if (terminal) return terminal;
        }
      } catch (error) {
        return die2(error);
      }
      return succeed6(out);
    };
  }
  _rebuild(recur, recurParameter, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is3) => {
      const p = recurParameter(is3.parameter);
      const t = recur(is3.type);
      return p === is3.parameter && t === is3.type ? is3 : new IndexSignature(p, t);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, void 0, this.context, encodingChecks);
  }
  /** @internal */
  flip(recur) {
    return this._rebuild(recur, recur, this.encodingChecks, this.checks);
  }
  /** @internal */
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, this.checks, this.encodingChecks);
  }
  /** @internal */
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0) return "object | array";
    return "object";
  }
};
function stepProperty(s, p, exit3) {
  if (exit3._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, p.name, exit3);
  }
  if (exit3 === sameExit) return;
  const value = exit3[args];
  if (value !== missing) {
    assignProperty(s.out, p.name, value);
    return;
  }
  delete s.out[p.name];
  if (!isOptional(p.type)) {
    const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues) s.issues.push(issue);
      else s.issues = [issue];
      return;
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parsePropertiesOptions = {
  onItem(s, p) {
    if (!hasPropertySignature(s.input, p.name)) {
      return p.parser(missing, s.options);
    }
    const value = s.input[p.name];
    assignProperty(s.out, p.name, value);
    return p.parser(value, s.options);
  },
  step: stepProperty
};
var parseProperties = /* @__PURE__ */ iterateEager()(parsePropertiesOptions);
var parsePropertiesConcurrent = /* @__PURE__ */ iterateConcurrent()(parsePropertiesOptions);
function combineChecks(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function tuple(elements, checks = void 0) {
  return new Arrays(false, elements.map((e) => e.ast), [], void 0, checks);
}
function union(members, options, checks) {
  return new Union(members.map(getAST), options, void 0, checks);
}
var toCandidate = /* @__PURE__ */ memoizeIdempotent((ast) => {
  while (true) {
    if (isSuspend(ast)) return unknown;
    const encoding = ast.encoding;
    if (!encoding) {
      return ast.recur?.(toCandidate, identity) ?? ast;
    }
    if (encoding.some((link2) => link2.transformation._tag === "Middleware" && link2.transformation.decode !== identity)) return unknown;
    ast = encoding[encoding.length - 1].to;
  }
});
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.[SENTINELS_ANNOTATION_KEY];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        if (!isOptional(e)) {
          if (isLiteral(e)) {
            return [{
              key: i,
              literal: e.literal
            }];
          }
          if (isUniqueSymbol(e)) {
            return [{
              key: i,
              literal: e.symbol
            }];
          }
        }
        return [];
      });
    case "Union": {
      if (ast.types.length === 0) return [];
      const members = ast.types.map((type) => collectSentinels(toCandidate(type)));
      return members[0].filter((s) => members.every((sentinels) => sentinels.some((o) => o.key === s.key && o.literal === s.literal)));
    }
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap();
var emptyCandidates = /* @__PURE__ */ Object.freeze([]);
var hasPropertySignature = (input, key) => key === "__proto__" ? Object.hasOwn(input, key) : key in input;
function getIndex(types) {
  let index = candidateIndexCache.get(types);
  if (index) return index;
  let bySentinel;
  let sentinelCandidateCount = 0;
  let otherwise;
  let literalCandidates;
  let onlyLiterals = true;
  for (let i = 0; i < types.length; i++) {
    const a = types[i];
    const encoded = toCandidate(a);
    if (isNever2(encoded)) continue;
    if (onlyLiterals) {
      if (isLiteral(encoded) || isUniqueSymbol(encoded)) {
        literalCandidates ??= /* @__PURE__ */ new Map();
        const literal = isLiteral(encoded) ? encoded.literal : encoded.symbol;
        let arr2 = literalCandidates.get(literal);
        if (!arr2) literalCandidates.set(literal, arr2 = []);
        arr2.push(a);
      } else {
        onlyLiterals = false;
      }
    }
    const sentinels = collectSentinels(encoded);
    if (sentinels.length) {
      bySentinel ??= /* @__PURE__ */ new Map();
      sentinelCandidateCount++;
      for (const {
        key,
        literal
      } of sentinels) {
        let entry = bySentinel.get(key);
        if (!entry) bySentinel.set(key, entry = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Set()]);
        entry[1].add(i);
        let indexes = entry[0].get(literal);
        if (!indexes) entry[0].set(literal, indexes = /* @__PURE__ */ new Set());
        indexes.add(i);
      }
    } else {
      otherwise ??= {};
      const candidateTypes = getCandidateTypes(encoded);
      for (const t of candidateTypes) (otherwise[t] ??= []).push(i);
    }
  }
  if (onlyLiterals && literalCandidates) {
    literalCandidates.forEach(Object.freeze);
    index = (input) => literalCandidates.get(input) ?? emptyCandidates;
  } else if (bySentinel?.size === 1 && !otherwise) {
    const [key, [byValue]] = bySentinel.entries().next().value;
    const candidates = byValue;
    for (const [literal, indexes] of byValue) {
      candidates.set(literal, Object.freeze(Array.from(indexes, (index2) => types[index2])));
    }
    index = (input, isConstructor) => {
      if (isObjectKeyword(input)) {
        const value = hasPropertySignature(input, key) ? input[key] : void 0;
        if (value !== void 0) return candidates.get(value) ?? emptyCandidates;
        if (isConstructor) return types;
      }
      return emptyCandidates;
    };
  } else if (bySentinel) {
    let commonSentinel;
    for (const entry of bySentinel) {
      if ((!commonSentinel || entry[1][0].size > commonSentinel[1][0].size) && entry[1][1].size === sentinelCandidateCount) {
        commonSentinel = entry;
      }
    }
    index = (input, isConstructor) => {
      const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
      const base = otherwise?.[runtimeType] ?? emptyCandidates;
      if (!isObjectKeyword(input)) return base.map((i) => types[i]);
      const selected = new Set(base);
      let directKey;
      if (commonSentinel) {
        const [key, [byValue]] = commonSentinel;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : void 0;
        if (hasKey && (!isConstructor || value !== void 0)) {
          const match4 = byValue.get(value);
          if (!match4) return base.map((i) => types[i]);
          for (const i of match4) selected.add(i);
          directKey = key;
        }
      }
      if (directKey === void 0) {
        for (const [key, [byValue, all2]] of bySentinel) {
          const hasKey = hasPropertySignature(input, key);
          const value = hasKey ? input[key] : void 0;
          if (hasKey && (!isConstructor || value !== void 0)) {
            const match4 = byValue.get(value);
            if (match4) {
              for (const i of match4) selected.add(i);
            }
          } else if (isConstructor) {
            for (const i of all2) selected.add(i);
          }
        }
      }
      for (const [key, [byValue, all2]] of bySentinel) {
        if (key === directKey) continue;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : void 0;
        if (hasKey && (!isConstructor || value !== void 0)) {
          const match4 = byValue.get(value);
          for (const i of selected) {
            if (all2.has(i) && !match4?.has(i)) selected.delete(i);
          }
        }
      }
      return Array.from(selected).sort((a, b) => a - b).map((i) => types[i]);
    };
  } else {
    index = (input) => {
      const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
      return (otherwise?.[runtimeType] ?? emptyCandidates).map((i) => types[i]).filter(filterLiterals(input));
    };
  }
  candidateIndexCache.set(types, index);
  return index;
}
function filterLiterals(input) {
  return (ast) => {
    const encoded = toCandidate(ast);
    return encoded._tag === "Literal" ? encoded.literal === input : encoded._tag === "UniqueSymbol" ? encoded.symbol === input : true;
  };
}
function getCandidates(input, types, isConstructor = false) {
  return getIndex(types)(input, isConstructor);
}
var Union = class extends ASTNodeImpl {
  _tag = "Union";
  types;
  options;
  encodingChecks;
  constructor(types, options, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.types = types;
    this.options = options;
    this.encodingChecks = encodingChecks;
  }
  /** @internal */
  getParser(compile, compileConstructorDefault2) {
    const ast = this;
    return (input, options) => {
      if (input === missing) {
        return missingExit;
      }
      const candidates = getCandidates(input, ast.types, compileConstructorDefault2 !== void 0);
      if (candidates.length === 0) {
        return fail5(new AnyOf(ast, [], input, options));
      }
      if (candidates.length === 1) {
        const result2 = compile(candidates[0])(input, options);
        if (result2._tag === "Success") return result2;
        return effectIsExit(result2) ? failSingleUnionCandidate(ast, result2.cause, input, options) : catchCause2(result2, (cause) => failSingleUnionCandidate(ast, cause, input, options));
      }
      const state2 = {
        ast,
        compile,
        input,
        out: void 0,
        successes: ast.options?.mode === "oneOf" ? [] : void 0,
        issues: void 0,
        options
      };
      const eff = parseUnion(state2, candidates);
      if (!eff) {
        if (state2.out) return state2.out;
        return fail5(new AnyOf(ast, state2.issues ?? [], input, options));
      }
      return flatMapEager2(eff, (_) => {
        if (state2.out === sameExit) return succeed5(input);
        if (state2.out) return state2.out;
        return fail5(new AnyOf(ast, state2.issues ?? [], input, options));
      });
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.options, this.annotations, checks, void 0, this.context, encodingChecks);
  }
  /** @internal */
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  /** @internal */
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  /** @internal */
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== void 0) return out;
    }
    return void 0;
  }
  /** @internal */
  getExpected(getExpected2) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string") return expected;
    if (this.types.length === 0) return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected2(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected2(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected2(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
};
function failSingleUnionCandidate(ast, cause, input, options) {
  const issue = getSchemaIssue(cause);
  if (!issue) return failCause2(cause);
  return fail4(new AnyOf(ast, [issue], input, options));
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, ast) {
    const parser = s.compile(ast);
    return parser(s.input, s.options);
  },
  step(s, candidate, exit3) {
    if (exit3._tag === "Failure") {
      const issue = getSchemaIssue(exit3.cause);
      if (issue === void 0) {
        return exit3;
      }
      if (s.issues) s.issues.push(issue);
      else s.issues = [issue];
    } else {
      if (s.out && s.successes) {
        s.successes.push(candidate);
        return fail4(new OneOf(s.ast, s.successes, s.input, s.options));
      }
      s.out = exit3;
      if (s.successes) {
        s.successes.push(candidate);
      } else {
        return void_2;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")]);
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional2) {
  return isOptional2 ? "?" : "";
}
var Filter2 = class extends Class {
  _tag = "Filter";
  run;
  annotations;
  /**
   * Whether the parsing process should be aborted after this check has failed.
   */
  aborted;
  constructor(run2, annotations = void 0, aborted = false) {
    super();
    this.run = run2;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
var FilterGroup = class extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = void 0) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
function makeFilter(filter3, annotations, aborted = false) {
  return new Filter2((input, ast, options) => normalizeFilterOutput(ast, filter3(input, ast, options), input, options), annotations, aborted);
}
function isFinite(annotations) {
  return makeFilter((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    representation: {
      id: "effect/schema/isFinite",
      payload: null
    },
    toJsonSchema: () => ({
      type: "number"
    }),
    toCode: () => ({
      runtime: "Schema.isFinite()"
    }),
    arbitraryConstraint: {
      number: "finite"
    },
    ...annotations
  });
}
var finite = /* @__PURE__ */ appendChecks(number2, [/* @__PURE__ */ isFinite()]);
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finite, nonFiniteLiterals]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number2(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function isPattern(regExp, annotations) {
  const source = regExp.source;
  const pattern = new globalThis.RegExp(source, regExp.flags);
  return makeFilter((s) => {
    pattern.lastIndex = 0;
    return pattern.test(s);
  }, {
    expected: `a string matching the RegExp ${source}`,
    representation: {
      id: "effect/schema/isPattern",
      payload: {
        source,
        flags: regExp.flags
      }
    },
    toJsonSchema: () => ({
      pattern: source
    }),
    arbitraryConstraint: {
      patterns: [{
        source: regExp.source,
        flags: regExp.flags
      }]
    },
    ...annotations
  });
}
function modifyOwnPropertyDescriptors(ast, f) {
  const d = Object.getOwnPropertyDescriptors(ast);
  f(d);
  return Object.create(Object.getPrototypeOf(ast), d);
}
var contextOwners = /* @__PURE__ */ new WeakMap();
function getContextOwner(ast) {
  return contextOwners.get(ast) ?? ast;
}
function replaceEncoding(ast, encoding) {
  if (ast.encoding === encoding) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.encoding.value = encoding;
  });
}
function replaceContext(ast, context2) {
  if (ast.context === context2) {
    return ast;
  }
  const owner = getContextOwner(ast);
  if (owner.context === context2) {
    return owner;
  }
  const out = modifyOwnPropertyDescriptors(ast, (d) => {
    d.context.value = context2;
  });
  contextOwners.set(out, owner);
  return out;
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.annotations.value = {
      ...d.annotations.value,
      ...annotations
    };
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.checks.value = checks;
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function mapLink(link2, f) {
  const to = f(link2.to);
  return to === link2.to ? link2 : new Link(to, link2.transformation);
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const out = mapLink(last, f);
  return out === last ? encoding : append(encoding.slice(0, encoding.length - 1), out);
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function applyToSelfOrLastLinkEncodingIdempotent(f, options) {
  function out(ast) {
    if (ast.encoding) {
      const last = ast.encoding[ast.encoding.length - 1];
      return options?.stopAt?.(last) ? ast : replaceEncoding(ast, updateLastLink(ast.encoding, out));
    }
    return f(ast);
  }
  return memoizeIdempotent(out);
}
function appendTransformation(from, transformation, to) {
  const link2 = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link2] : [link2]);
}
function mapOrSame(as2, f) {
  let changed = false;
  const out = new Array(as2.length);
  for (let i = 0; i < as2.length; i++) {
    const a = as2[i];
    const fa = f(a);
    if (fa !== a) {
      changed = true;
    }
    out[i] = fa;
  }
  return changed ? out : as2;
}
function annotateKey(ast, annotations) {
  const context2 = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.constructorDefault, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, void 0, annotations);
  return replaceContext(ast, context2);
}
var optionalKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context2 = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context2));
});
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
var optional = /* @__PURE__ */ memoize((ast) => optionalKey(new Union([ast, undefined_2])));
function withConstructorDefault(ast, defaultValue) {
  const transformation = new Transformation(withDefault(defaultValue), passthrough());
  const constructorDefault = new Link(unknown, transformation);
  const context2 = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, constructorDefault, ast.context.annotations) : new Context(false, false, constructorDefault);
  return replaceContext(ast, context2);
}
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isStructuralCheck(check) {
  return check.annotations?.[STRUCTURAL_ANNOTATION_KEY] === true || check._tag === "FilterGroup" && check.checks.every(isStructuralCheck);
}
function extractStructuralChecks(checks) {
  function extract(check) {
    if (isStructuralCheck(check)) return [check];
    return check._tag === "FilterGroup" ? check.checks.flatMap(extract) : [];
  }
  const out = checks.flatMap(extract);
  return isArrayNonEmpty2(out) ? out : void 0;
}
var toType = /* @__PURE__ */ memoizeIdempotent((ast) => {
  if (ast.encoding) {
    return toType(replaceEncoding(ast, void 0));
  }
  const out = ast;
  const type = out.recur?.(toType) ?? out;
  const encodingChecks = type.encodingChecks;
  if (encodingChecks) {
    const checks = type === ast ? encodingChecks : isArrays(type) || isObjects(type) || isDeclaration(type) && type.typeParameters.length > 0 ? extractStructuralChecks(encodingChecks) : void 0;
    return modifyOwnPropertyDescriptors(type, (d) => {
      d.encodingChecks.value = void 0;
      d.checks.value = combineChecks(type.checks, checks);
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoizeIdempotent((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, void 0)), links[0].transformation.flip())];
  for (let i = 1; i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const out = ast;
  return out.flip?.(flip2) ?? out.recur?.(flip2) ?? out;
});
function containsUndefined(ast) {
  switch (ast._tag) {
    case "Undefined":
      return true;
    case "Union":
      return ast.types.some(containsUndefined);
    default:
      return false;
  }
}
function fromConst(ast, value) {
  const succeed7 = value === 0 ? sameExit : succeed6(value);
  return (input, options) => {
    if (input === missing) return missingExit;
    if (input === value) return succeed7;
    return fail5(new InvalidType(ast, input, options));
  };
}
function fromRefinement(ast, refinement) {
  return (input, options) => {
    if (input === missing) return missingExit;
    if (refinement(input)) return sameExit;
    return fail5(new InvalidType(ast, input, options));
  };
}
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    representation: {
      id: "effect/schema/isStringFinite",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: isStringFiniteRegExp.source
    }),
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals]), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
var REGEXP_PATTERN = "Symbol\\(([\\s\\S]*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
function collectIssues(checks, value, issues, ast, options) {
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      issues = collectIssues(check.checks, value, issues, ast, options);
      if (issues && (options.errors !== "all" || issues[issues.length - 1].filter.aborted)) {
        return issues;
      }
    } else {
      const issue = check.run(value, ast, options);
      if (issue) {
        const filter3 = new Filter(check, issue, value, options);
        if (issues) issues.push(filter3);
        else issues = [filter3];
        if (options.errors !== "all" || check.aborted) {
          return issues;
        }
      }
    }
  }
  return issues;
}
function getConstructorDescriptor(ast) {
  if (!isDeclaration(ast)) return void 0;
  const getDescriptor = ast.annotations?.[CONSTRUCTOR_ANNOTATION_KEY];
  return isFunction(getDescriptor) ? getDescriptor(ast.typeParameters) : void 0;
}
function isJsonLeaf(u) {
  return u === null || typeof u === "string" || typeof u === "boolean" || typeof u === "number" && globalThis.Number.isFinite(u);
}
function isStringTreeLeaf(u) {
  return u === void 0 || typeof u === "string";
}
function isTree(u, isLeaf) {
  const cache = /* @__PURE__ */ new WeakMap();
  const stack = [];
  outer: while (true) {
    if (typeof u !== "object" || u === null) {
      if (!isLeaf(u)) {
        return false;
      }
    } else {
      const value = u;
      const cached2 = cache.get(value);
      if (cached2 === false) {
        return false;
      }
      if (cached2 === void 0) {
        const isArray2 = Array.isArray(value);
        if (!isArray2) {
          const prototype = Object.getPrototypeOf(value);
          if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
            return false;
          }
        }
        cache.set(value, false);
        stack.push({
          value,
          keys: isArray2 ? value.length : Object.keys(value),
          index: 0
        });
      }
    }
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const keys = frame.keys;
      if (typeof keys === "number") {
        if (frame.index < keys) {
          u = frame.value[frame.index++];
          continue outer;
        }
      } else if (frame.index < keys.length) {
        u = frame.value[keys[frame.index++]];
        continue outer;
      }
      cache.set(frame.value, true);
      stack.pop();
    }
    return true;
  }
}
function isJson(u) {
  return isTree(u, isJsonLeaf);
}
var Json = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isJson(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  representation: {
    id: "effect/schema/Json",
    payload: null
  },
  expected: "JSON value",
  toCodecJson: () => void 0,
  toCodecStringTree: () => unknownToStringTree
});
function isStringTree(u) {
  return isTree(u, isStringTreeLeaf);
}
var StringTree = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isStringTree(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  expected: "StringTree",
  toCodecStringTree: () => void 0
});
var unknownToStringTree = /* @__PURE__ */ new Link(StringTree, /* @__PURE__ */ passthrough2());

// node_modules/effect/dist/SchemaParser.js
function makeEffect(schema) {
  const ast = schema.ast;
  let parser;
  return (input, options) => {
    return (parser ??= runWithCompiler(constructorCompiler, toType(ast)))(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit3 = runSyncExit2(parser(input, options));
    if (isSuccess3(exit3)) {
      return some2(exit3.value);
    }
    getSchemaIssueOrThrow(exit3.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make3(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit3 = runSyncExit2(parser(input, options));
    if (isSuccess3(exit3)) {
      return exit3.value;
    }
    const issue = getSchemaIssueOrThrow(exit3.cause, "Constructor adapter can only throw schema issues");
    throw new Error("Schema validation failed", {
      cause: issue
    });
  };
}
function is(schema) {
  return _is(schema.ast);
}
function _is(ast) {
  const parser = asExit(run(toType(ast)));
  return (input) => {
    const exit3 = parser(input, defaultParseOptions);
    if (isSuccess3(exit3)) {
      return true;
    }
    getSchemaIssueOrThrow(exit3.cause, "Type guard adapter can only return false for schema issues");
    return false;
  };
}
var getValue = (value) => {
  if (value === missing) {
    return fail5(new InvalidValue());
  }
  return succeed5(value);
};
function run(ast) {
  return runWithCompiler(normalCompiler, ast);
}
function runWithCompiler(compiler, ast) {
  let parser;
  return (input, options) => {
    const result2 = (parser ??= compiler(ast))(input, options ?? defaultParseOptions);
    if (result2 === sameExit) {
      return succeed5(input);
    }
    if (!effectIsExit(result2)) {
      return flatMapEager2(result2, getValue);
    }
    return result2[args] === missing ? getValue(missing) : result2;
  };
}
function asExit(parser) {
  return (input, options) => runSyncExit2(parser(input, options));
}
var normalCompiler = /* @__PURE__ */ memoize((ast) => makeParser(ast, normalCompiler));
var constructorCompiler = /* @__PURE__ */ memoize((ast) => makeParser(ast, constructorCompiler, compileConstructorDefault));
var compileDefaulted = /* @__PURE__ */ memoize((ast) => makeParser(ast, constructorCompiler, compileConstructorDefault, ast.context?.constructorDefault));
function compileConstructorDefault(ast) {
  return ast.context?.constructorDefault ? compileDefaulted(ast) : constructorCompiler(ast);
}
function applyTransformation(result2, current, transformation, options) {
  let transformed;
  if (effectIsExit(result2) && result2._tag === "Success") {
    const optional3 = toOption(result2 === sameExit ? current : result2[args]);
    transformed = transformation._tag === "Transformation" ? transformation.decode.run(optional3, options) : transformation.decode(succeed6(optional3), options);
  } else if (transformation._tag === "Transformation") {
    transformed = flatMapEager2(result2, (value) => transformation.decode.run(toOption(value), options));
  } else {
    transformed = transformation.decode(mapEager2(result2, toOption), options);
  }
  return effectIsExit(transformed) && transformed._tag === "Success" ? fromOptionExit(transformed[args]) : flatMapEager2(transformed, fromOptionExit);
}
function makeConstructorParser(descriptor, compile) {
  let sourceParser;
  return (input, options) => {
    if (input === missing) return missingExit;
    if (descriptor.isConstructed(input)) return sameExit;
    const result2 = (sourceParser ??= compile(descriptor.link.to))(input, options);
    return applyTransformation(result2, input, descriptor.link.transformation, options);
  };
}
function makeParser(ast, compile, compileConstructorDefault2, constructorDefault) {
  const descriptor = compileConstructorDefault2 ? getConstructorDescriptor(ast) : void 0;
  const parser = descriptor ? makeConstructorParser(descriptor, compile) : ast.getParser(compile, compileConstructorDefault2);
  const checks = ast.checks;
  const links = constructorDefault ? ast.encoding ? [...ast.encoding, constructorDefault] : [constructorDefault] : ast.encoding;
  const encodingChecks = ast.encodingChecks;
  if (!links && !checks && !encodingChecks) {
    return parser;
  }
  let encodingParsers;
  const parseLocal = (input, options) => {
    let result2 = parser(input, options);
    if (encodingChecks && !options.disableChecks) {
      if (effectIsExit(result2)) {
        if (result2._tag === "Success") {
          const output = result2 === sameExit ? input : result2[args];
          if (input !== missing && output !== missing) {
            const issues = collectIssues(encodingChecks, input, void 0, ast, options);
            if (issues) {
              result2 = fail5(new Composite(ast, issues, input, options));
            }
          }
        }
      } else {
        result2 = flatMap2(result2, (value) => {
          if (input !== missing && value !== missing) {
            const issues = collectIssues(encodingChecks, input, void 0, ast, options);
            if (issues) {
              return fail5(new Composite(ast, issues, input, options));
            }
          }
          return succeed5(value);
        });
      }
    }
    if (checks && !options.disableChecks) {
      if (effectIsExit(result2)) {
        if (result2._tag === "Success") {
          const value = result2 === sameExit ? input : result2[args];
          if (value === missing) return result2;
          const issues = collectIssues(checks, value, void 0, ast, options);
          if (issues) {
            result2 = fail5(new Composite(ast, issues, value, options));
          }
        }
      } else {
        result2 = flatMap2(result2, (value) => {
          if (value !== missing) {
            const issues = collectIssues(checks, value, void 0, ast, options);
            if (issues) {
              return fail5(new Composite(ast, issues, value, options));
            }
          }
          return succeed5(value);
        });
      }
    }
    return result2;
  };
  if (!links) {
    return parseLocal;
  }
  return (input, options) => {
    const parsers = encodingParsers ??= links.map((link2) => compile(link2.to));
    let current = input;
    let result2 = parsers[parsers.length - 1](input, options);
    for (let i = links.length - 1; i >= 0; i--) {
      result2 = applyTransformation(result2, current, links[i].transformation, options);
      if (i !== 0) {
        const next = parsers[i - 1];
        if (result2._tag === "Success") {
          current = result2[args];
          result2 = next(current, options);
        } else {
          result2 = flatMapEager2(result2, (value) => {
            const nextResult = next(value, options);
            return nextResult === sameExit ? succeed6(value) : nextResult;
          });
        }
      }
    }
    if (result2._tag === "Success") {
      const value = result2[args];
      const local = parseLocal(value, options);
      return local === sameExit ? result2 : local;
    }
    result2 = catchCause2(result2, (cause) => failCauseSync2(() => map5(cause, (issue) => new Encoding(ast, issue, input, options))));
    return flatMapEager2(result2, (value) => {
      const local = parseLocal(value, options);
      return local === sameExit ? succeed6(value) : local;
    });
  };
}

// node_modules/effect/dist/internal/schema/make.js
var TypeId7 = "~effect/Schema/Schema";
var SchemaProto = {
  [TypeId7]: TypeId7,
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  }
};
function make4(ast, options) {
  function Schema() {
  }
  const self = Object.setPrototypeOf(Schema, SchemaProto);
  if (options && (Object.hasOwn(options, "name") || Object.hasOwn(options, "length") || Object.hasOwn(options, "__proto__"))) {
    Object.defineProperties(self, Object.getOwnPropertyDescriptors({
      ...options
    }));
  } else {
    Object.assign(self, options);
  }
  self.ast = ast;
  self.rebuild = (ast2) => make4(ast2, options);
  self.makeEffect = makeEffect(self);
  self.make = make3(self);
  self.makeOption = makeOption(self);
  return self;
}

// node_modules/effect/dist/Struct.js
var lambda = (f) => f;

// node_modules/effect/dist/internal/schemaError.js
var SchemaErrorTypeId = "~effect/Schema/SchemaError";

// node_modules/effect/dist/Schema.js
var TypeId8 = TypeId7;
function declareConstructor() {
  return (typeParameters, run2, annotations) => {
    return make5(new Declaration(typeParameters.map(getAST), (typeParameters2) => run2(typeParameters2.map((ast) => make5(ast))), annotations));
  };
}
function declare(is3, annotations) {
  return declareConstructor()([], () => (input, ast, options) => is3(input) ? succeed5(input) : fail5(new InvalidType(ast, input, options)), annotations);
}
var SchemaError = class extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    const stackTraceLimit = getStackTraceLimit();
    setStackTraceLimit(0);
    try {
      super({
        issue
      });
    } finally {
      setStackTraceLimit(stackTraceLimit);
    }
  }
  get message() {
    return defaultFormatter(this.issue);
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
};
var is2 = is;
var make5 = make4;
function isSchema(u) {
  return hasProperty(u, TypeId8) && u[TypeId8] === TypeId8;
}
var optional2 = /* @__PURE__ */ lambda((self) => {
  const schema = UndefinedOr(self);
  return make5(optional(self.ast), {
    schema
  });
});
function Literal2(literal) {
  const out = make5(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
var Unknown2 = /* @__PURE__ */ make5(unknown);
var Undefined2 = /* @__PURE__ */ make5(undefined_2);
var String4 = /* @__PURE__ */ make5(string2);
var Number4 = /* @__PURE__ */ make5(number2);
function makeStruct(ast, fields) {
  return make5(ast, {
    fields,
    mapFields(f, options) {
      const fields2 = f(this.fields);
      return makeStruct(struct(fields2, options?.unsafePreserveChecks ? this.ast.checks : void 0), fields2);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, void 0), fields);
}
function makeTuple(ast, elements) {
  return make5(ast, {
    elements,
    mapElements(f, options) {
      const elements2 = f(this.elements);
      return makeTuple(tuple(elements2, options?.unsafePreserveChecks ? this.ast.checks : void 0), elements2);
    }
  });
}
function Tuple(elements) {
  return makeTuple(tuple(elements), elements);
}
var ArraySchema = /* @__PURE__ */ lambda((schema) => make5(new Arrays(false, [], [schema.ast]), {
  value: schema
}));
function makeUnion(ast, members) {
  return make5(ast, {
    members,
    mapMembers(f, options) {
      const members2 = f(this.members);
      return makeUnion(union(members2, this.ast.options, options?.unsafePreserveChecks ? this.ast.checks : void 0), members2);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union(members, options, void 0), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make5(union(members, void 0, void 0), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals2) {
      return Literals(literals2);
    },
    transform(to) {
      return Union2(members.map((member, index) => member.transform(to[index])));
    }
  });
}
var UndefinedOr = /* @__PURE__ */ lambda((self) => Union2([self, Undefined2]));
function decodeTo2(to, transformation) {
  return (from) => {
    return make5(decodeTo(from.ast, to.ast, transformation ? make2(transformation) : passthrough2()), {
      from,
      to
    });
  };
}
function withConstructorDefault2(defaultValue) {
  return (schema) => make5(withConstructorDefault(schema.ast, defaultValue), {
    schema
  });
}
function tag(literal) {
  return Literal2(literal).pipe(withConstructorDefault2(succeed5(literal)));
}
function TaggedStruct(value, fields) {
  return Struct({
    _tag: tag(value),
    ...fields
  });
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo, transformation) => {
    return new Link(encodeTo.ast, make2(transformation));
  };
}
var makeFilter2 = makeFilter;
function isPattern2(regExp, annotations) {
  const source = regExp.source;
  const flags = regExp.flags;
  const runtimeRegExp = flags === "" ? `new RegExp(${format(source)})` : `new RegExp(${format(source)}, ${format(flags)})`;
  return isPattern(regExp, {
    toCode: () => ({
      runtime: `Schema.isPattern(${runtimeRegExp})`
    }),
    ...annotations
  });
}
function isBase64(annotations) {
  const regExp = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  return isPattern2(regExp, {
    expected: "a base64 encoded string",
    representation: {
      id: "effect/schema/isBase64",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: regExp.source
    }),
    toCode: () => ({
      runtime: "Schema.isBase64()"
    }),
    ...annotations
  });
}
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    representation: {
      id: "effect/schema/isInt",
      payload: null
    },
    toJsonSchema: () => ({
      type: "integer"
    }),
    toCode: () => ({
      runtime: "Schema.isInt()"
    }),
    arbitraryConstraint: {
      number: "integer"
    },
    ...annotations
  });
}
var Int = /* @__PURE__ */ Number4.check(/* @__PURE__ */ isInt());
var getErrorOptionsKey = (options) => (options?.includeStack === true ? 1 : 0) | (options?.excludeCause === true ? 2 : 0);
var getErrorOptions = (key) => {
  switch (key) {
    case 0:
      return void 0;
    case 1:
      return {
        includeStack: true
      };
    case 2:
      return {
        excludeCause: true
      };
    case 3:
      return {
        includeStack: true,
        excludeCause: true
      };
  }
};
var defectSchemaCache = [];
function Defect(options) {
  const key = getErrorOptionsKey(options);
  const cached2 = defectSchemaCache[key];
  if (cached2 !== void 0) {
    return cached2;
  }
  const schema = Json2.pipe(decodeTo2(Unknown2, defectFromJson(getErrorOptions(key))));
  defectSchemaCache[key] = schema;
  return schema;
}
var RegExp2 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  representation: {
    id: "effect/schema/RegExp",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  }),
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String4,
    flags: String4
  }), transformEffect2({
    decode: (e, options) => try_2({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: () => new InvalidValue({
        expected: "valid RegExp source and flags"
      }, e, options)
    }),
    encode: (regExp) => succeed5({
      source: regExp.source,
      flags: regExp.flags
    })
  }))
});
var URLString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  representation: {
    id: "effect/schema/URL",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  }),
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString)
});
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  representation: {
    id: "effect/schema/File",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.File`,
    Type: `globalThis.File`
  }),
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String4.check(isBase64()),
    type: String4,
    name: String4,
    lastModified: Int
  }), transformEffect2({
    decode: (e, options) => match(decodeBase64(e.data), {
      onFailure: () => fail5(new InvalidValue({
        expected: "a valid Base64 string"
      }, e.data, options)),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed5(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file, options) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encodeBase64(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: () => new InvalidValue({
        expected: "a readable File"
      }, file, options)
    })
  }))
});
var FormData2 = /* @__PURE__ */ instanceOf(globalThis.FormData, {
  representation: {
    id: "effect/schema/FormData",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.FormData`,
    Type: `globalThis.FormData`
  }),
  expected: "FormData",
  toCodecJson: () => link()(ArraySchema(Tuple([String4, Union2([Struct({
    _tag: tag("String"),
    value: String4
  }), Struct({
    _tag: tag("File"),
    value: File
  })])])), transformEffect2({
    decode: (e) => {
      const out = new globalThis.FormData();
      for (const [key, entry] of e) {
        out.append(key, entry.value);
      }
      return succeed5(out);
    },
    encode: (formData) => {
      return succeed5(globalThis.Array.from(formData.entries()).map(([key, value]) => {
        if (typeof value === "string") {
          return [key, {
            _tag: "String",
            value
          }];
        } else {
          return [key, {
            _tag: "File",
            value
          }];
        }
      }));
    }
  }))
});
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  representation: {
    id: "effect/schema/URLSearchParams",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  }),
  expected: "URLSearchParams",
  toCodecJson: () => link()(String4.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
var Base64String = /* @__PURE__ */ String4.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  representation: {
    id: "effect/schema/Uint8Array",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  }),
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String)
});
var arbitraryMinimumDateTimestamp = -864e13;
var arbitraryMaximumDateTimestamp = 864e13;
var arbitraryMinimumZonedDateTimeTimestamp = arbitraryMinimumDateTimestamp + 14 * 60 * 60 * 1e3;
var arbitraryMaximumZonedDateTimeTimestamp = arbitraryMaximumDateTimestamp - 14 * 60 * 60 * 1e3;
var arbitraryMinimumTimeZoneOffset = -12 * 60 * 60 * 1e3;
var arbitraryMaximumTimeZoneOffset = 14 * 60 * 60 * 1e3;
var immerable = /* @__PURE__ */ globalThis.Symbol.for("immer-draftable");
var payloadToken = {};
function makeClass(Inherited, identifier2, struct2, annotations, proto) {
  const getClassSchema = getClassSchemaFactory(struct2, identifier2, annotations);
  const ClassTypeId = getClassTypeId(identifier2);
  const out = class extends Inherited {
    constructor(...[input, options]) {
      const internalOptions = options;
      const payload = internalOptions?.["~payload"];
      const value = payload?.token === payloadToken ? payload.value : struct2.make(input ?? {}, options);
      super(value, {
        ...options,
        disableChecks: true,
        "~payload": {
          token: payloadToken,
          value
        }
      });
    }
    static [TypeId8] = TypeId8;
    get [ClassTypeId]() {
      return ClassTypeId;
    }
    static [immerable] = true;
    static identifier = identifier2;
    static fields = struct2.fields;
    static get ast() {
      return getClassSchema(this).ast;
    }
    static pipe() {
      return pipeArguments(this, arguments);
    }
    static rebuild(ast) {
      return getClassSchema(this).rebuild(ast);
    }
    static make(input, options) {
      return make3(getClassSchema(this))(input ?? {}, options);
    }
    static makeOption(input, options) {
      return makeOption(getClassSchema(this))(input ?? {}, options);
    }
    static makeEffect(input, options) {
      return getClassSchema(this).makeEffect(input ?? {}, options);
    }
    static annotate(annotations2) {
      return this.rebuild(annotate(this.ast, annotations2));
    }
    static annotateKey(annotations2) {
      return this.rebuild(annotateKey(this.ast, annotations2));
    }
    static check(...checks) {
      return this.rebuild(appendChecks(this.ast, checks));
    }
    static extend(identifier3) {
      return (schema, annotations2) => {
        const extension = isStruct(schema) ? schema : Struct(schema);
        const fields = {
          ...struct2.fields,
          ...extension.fields
        };
        const ast = struct(fields, struct2.ast.checks, {
          identifier: identifier3
        });
        return makeClass(this, identifier3, makeStruct(appendChecks(ast, extension.ast.checks), fields), annotations2, proto);
      };
    }
    static mapFields(f, options) {
      return struct2.mapFields(f, options);
    }
  };
  if (proto !== void 0) {
    Object.assign(out.prototype, proto(identifier2));
  }
  return out;
}
function getClassTransformation(self) {
  return new Transformation(transform((input) => new self(input, {
    "~payload": {
      token: payloadToken,
      value: input
    }
  })), passthrough());
}
function getClassTypeId(identifier2) {
  return `~effect/Schema/Class/${identifier2}`;
}
function getClassSchemaFactory(from, identifier2, annotations) {
  let memo;
  return (self) => {
    if (memo !== void 0) {
      return memo;
    }
    const ClassTypeId = getClassTypeId(identifier2);
    const isClassValue = (input) => input instanceof self || hasProperty(input, ClassTypeId);
    const transformation = getClassTransformation(self);
    const to = make5(new Declaration([from.ast], () => (input, ast, options) => {
      return isClassValue(input) ? succeed5(input) : fail5(new InvalidType(ast, input, options));
    }, {
      identifier: identifier2,
      [CONSTRUCTOR_ANNOTATION_KEY]: ([from2]) => ({
        isConstructed: isClassValue,
        link: new Link(from2, transformation)
      }),
      toCodec: ([from2]) => new Link(from2.ast, transformation),
      toEquivalence: ([from2]) => from2,
      toFormatter: ([from2]) => (t) => `${self.identifier}(${from2(t)})`,
      [SENTINELS_ANNOTATION_KEY]: collectSentinels(from.ast),
      ...annotations
    }));
    return memo = decodeTo2(to, transformation)(from);
  };
}
function isStruct(schema) {
  return isSchema(schema);
}
var Error3 = (identifier2) => (schema, annotations) => {
  const struct2 = isStruct(schema) ? schema : Struct(schema);
  const self = makeClass(Error2, identifier2, struct2, annotations, (identifier3) => ({
    name: identifier3
  }));
  return self;
};
var TaggedError3 = (identifier2) => {
  return (tagValue, schema, annotations) => {
    const struct2 = isStruct(schema) ? schema.mapFields((fields) => ({
      _tag: tag(tagValue),
      ...fields
    }), {
      unsafePreserveChecks: true
    }) : TaggedStruct(tagValue, schema);
    return Error3(identifier2 ?? tagValue)(struct2, annotations);
  };
};
var Json2 = /* @__PURE__ */ make5(/* @__PURE__ */ annotate(Json, {
  toCode: () => ({
    runtime: "Schema.Json",
    Type: "Schema.Json"
  })
}));

// node_modules/@t3tools/shared/src/preview.ts
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
var LSOF_LOCAL_HOST_TOKENS = /* @__PURE__ */ new Set([
  ...LOOPBACK_HOSTS,
  "*",
  "[::]",
  "[::1]"
]);
var PreviewUrlNormalizationError = class extends TaggedError3()(
  "PreviewUrlNormalizationError",
  {
    inputLength: Number4,
    reason: Literals(["empty", "parse", "unsupported-protocol"]),
    protocol: optional2(String4),
    cause: optional2(Defect())
  }
) {
  get message() {
    const protocol = this.protocol === void 0 ? "" : `: ${this.protocol}`;
    return `Invalid preview URL (${this.reason}${protocol}; input length ${this.inputLength}).`;
  }
};
var isPreviewUrlNormalizationError = is2(PreviewUrlNormalizationError);

// viewModel.ts
function isBrowserPreviewFile(path3) {
  return /\.(?:html?|pdf)$/i.test(path3.split(/[?#]/, 1)[0] ?? "");
}

// server.ts
var server_default = {
  tools: [],
  apis: [
    {
      id: filePresentationApi.definition.id,
      methods: [
        {
          name: "open",
          invoke(input, session) {
            session.signal.throwIfAborted();
            const value = input;
            if (typeof value.relativePath !== "string")
              throw new Error("Expected a workspace-relative path");
            const relativePath = value.relativePath;
            if (!isBrowserPreviewFile(relativePath))
              throw new Error(
                `Not a browser-previewable file: ${relativePath} (the browser surface accepts .html/.htm/.pdf only)`
              );
            return {
              surfaceId: "t3.browser/view",
              placement: "side-panel",
              restoreState: { relativePath }
            };
          }
        }
      ]
    }
  ]
};

// generated-entry.ts
var generated_entry_default = { tools: [], ...server_default };
export {
  generated_entry_default as default
};
