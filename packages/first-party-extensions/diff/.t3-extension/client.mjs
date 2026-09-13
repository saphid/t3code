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
      if (typeof method.name !== "string" || !/^[a-z][a-zA-Z0-9]{0,79}$/.test(method.name) || names.has(method.name))
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
  var vcsOperationsSupportSchema = {
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
  var vcsRepositoryApi = defineApi({
    id: VCS_REPOSITORY,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [VCS_READ],
        inputSchema: vcsEmptyInputSchema,
        outputSchema: {
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
        }
      },
      {
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
      },
      {
        name: "init",
        effect: "write",
        requiredGrants: [VCS_MUTATE],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { kind: { enum: ["git"] } }
        },
        outputSchema: vcsAckOutputSchema
      },
      {
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
      },
      {
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
      }
    ]
  });
  var VCS_STATUS_API = vcsStatusApi.definition;
  var VCS_REFS_API = vcsRefsApi.definition;
  var VCS_CHANGES_API = vcsChangesApi.definition;
  var VCS_DIFF_API = vcsDiffApi.definition;
  var VCS_DIFF_API_V1 = vcsDiffApiV1.definition;
  var VCS_REPOSITORY_API = vcsRepositoryApi.definition;
  var RESOURCES_LEASE = "t3.resources/lease";
  var WORKSPACE_RESOURCES = "t3.workspace/resources";
  var RESOURCE_LEASE_KIND_GRANTS = {
    "workspace-file": WORKSPACE_RESOURCES,
    "project-favicon": WORKSPACE_RESOURCES,
    attachment: null
  };
  var RESOURCE_LEASE_SUPPORTED_KINDS = Object.keys(RESOURCE_LEASE_KIND_GRANTS).filter((kind) => RESOURCE_LEASE_KIND_GRANTS[kind] !== null);
  var resourceLeaseRefSchema = {
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
  var resourcesLeaseApi = defineApi({
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
  var RESOURCES_LEASE_API = resourcesLeaseApi.definition;
  var GENERIC_API_CATALOGUE = [
    workspaceFilesApi.definition,
    workspaceTreeApi.definition,
    workspaceSearchApi.definition,
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
    vcsDiffApiV1.definition,
    resourcesLeaseApi.definition
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
  var statePreview = (state) => {
    const encoded = JSON.stringify(state);
    return encoded.length > 200 ? encoded.slice(0, 200) + "\u2026" : encoded;
  };
  var shapeText = (schema) => {
    const optional = new Set(schema.optional ?? []);
    return "{" + Object.entries(schema.fields).map(([key, type]) => key + (optional.has(key) ? "?" : "") + ": " + type).join(", ") + "}";
  };
  var restoreFix = "Fix the value passed to session.save() or the stored record. If the persisted shape changed on purpose, update the surface's stateSchema and bump stateVersion so incompatible saves are not restored.";
  function restoreStateValidator(surfaceId, stateVersion, schema) {
    return (state) => {
      if (state === null)
        return true;
      const prefix = `Invalid restore state for "${surfaceId}" (stateVersion ${stateVersion}): `;
      const expected = `expected null (nothing saved yet) or an object matching ${shapeText(schema)}`;
      if (typeof state !== "object" || Array.isArray(state))
        throw new Error(`${prefix}${expected}; received ${statePreview(state)}. ${restoreFix}`);
      const optional = new Set(schema.optional ?? []);
      for (const [key, type] of Object.entries(schema.fields)) {
        const value = state[key];
        if (value === void 0) {
          if (optional.has(key))
            continue;
          throw new Error(`${prefix}missing required field "${key}" (${type}). Expected ${shapeText(schema)}; received ${statePreview(state)}. ${restoreFix}`);
        }
        if (typeof value !== type)
          throw new Error(`${prefix}expected field "${key}" to be ${type}, received ${typeof value} (${statePreview(value)}). Expected ${shapeText(schema)}. ${restoreFix}`);
      }
      return true;
    };
  }
  function nullOnlyValidator(surfaceId) {
    return (state) => {
      if (state === null)
        return true;
      throw new Error(`Invalid restore state for "${surfaceId}": the surface received persisted state ${statePreview(state)} but declares neither stateSchema nor validateRestore, so only null is accepted. Declare a stateSchema (or a validateRestore predicate) on the surface, and bump stateVersion if the shape differs from older saves.`);
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
            const id = source.id + "/" + surface.name;
            return {
              id,
              validateRestore: surface.validateRestore ?? (surface.stateSchema ? restoreStateValidator(id, surface.stateVersion ?? 1, surface.stateSchema) : nullOnlyValidator(id)),
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

  // viewModel.ts
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
    return `t3.diff:${patch.length}:${hash.toString(36)}`;
  }
  var MAX_EXPANDED_CONTEXT_LINES = 200;
  function splitLines(text) {
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
  function lineText(lines, index) {
    return (lines[index] ?? "").replace(/\r?\n$/, "");
  }
  function fileRows(row, contents2, maxExpandedContext = MAX_EXPANDED_CONTEXT_LINES) {
    const file = row.file;
    if (file.hunks.length === 0) return [];
    const expanded = contents2 !== void 0;
    const additionLines = expanded ? splitLines(contents2.newContents) : file.additionLines;
    const deletionLines = expanded ? splitLines(contents2.oldContents) : file.deletionLines;
    const rows = [];
    const pushGap = (oldStart, newStart, count) => {
      const shown = Math.min(count, maxExpandedContext);
      for (let offset = 0; offset < shown; offset += 1) {
        rows.push({
          ordinal: rows.length,
          kind: "context",
          text: lineText(additionLines, newStart + offset),
          oldLine: oldStart + offset + 1,
          newLine: newStart + offset + 1
        });
      }
      if (count > shown) rows.push({ ordinal: rows.length, kind: "gap", count: count - shown });
    };
    let lastAdditionEnd = 0;
    let lastDeletionEnd = 0;
    for (const hunk of file.hunks) {
      if (expanded) {
        const gap = Math.max(hunk.additionStart - 1 - lastAdditionEnd, 0);
        if (gap > 0) pushGap(lastDeletionEnd, lastAdditionEnd, gap);
      } else if (hunk.collapsedBefore > 0) {
        rows.push({ ordinal: rows.length, kind: "gap", count: hunk.collapsedBefore });
      }
      let additionIndex = expanded ? Math.max(hunk.additionStart - 1, 0) : hunk.additionLineIndex;
      let deletionIndex = expanded ? Math.max(hunk.deletionStart - 1, 0) : hunk.deletionLineIndex;
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
      lastAdditionEnd = hunk.additionStart + hunk.additionCount - 1;
      lastDeletionEnd = hunk.deletionStart + hunk.deletionCount - 1;
    }
    if (expanded) {
      const tail = Math.max(additionLines.length - lastAdditionEnd, 0);
      if (tail > 0) pushGap(lastDeletionEnd, lastAdditionEnd, tail);
    }
    return rows;
  }
  function canExpandFile(row) {
    return !row.binary && !row.textless && (row.changeType === "change" || row.changeType === "rename-changed");
  }
  function fileContentsInput(source, row) {
    return {
      sourceKind: source.kind,
      changeType: row.changeType,
      baseRef: source.baseRef,
      headRef: source.headRef,
      oldPath: row.prevPath ?? row.path,
      newPath: row.path
    };
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
  function describeSource(source) {
    const hash = source.diffHash.slice(0, 12);
    return `${source.title} \xB7 ${hash}${source.truncated ? " \xB7 truncated" : ""}`;
  }
  var WORKING_TREE_KIND = "working-tree";
  function selectSource(result, wantedId) {
    const sources = result?.sources ?? [];
    if (sources.length === 0) return null;
    const wanted = wantedId !== null && wantedId !== void 0 ? wantedId : WORKING_TREE_KIND;
    return sources.find((source) => source.id === wanted) ?? sources[0] ?? null;
  }
  function retainFileSelection(files, selectedKey) {
    if (selectedKey === null) return null;
    return files.find((row) => row.key === selectedKey) ?? null;
  }
  function previewState(result, error) {
    if (error !== null) return { kind: "error", detail: error };
    if (result === null) return { kind: "loading" };
    if (result.sources.length === 0) return { kind: "empty" };
    return { kind: "ready", result };
  }
  function diffCapabilityState(capabilities, error) {
    if (error !== null) return { kind: "unavailable", detail: error };
    if (capabilities === null) return { kind: "loading" };
    if (!capabilities.detected) {
      return { kind: "no-repository", detail: capabilities.detail };
    }
    if (!capabilities.operations["diff.getPreview"]) {
      const kind = capabilities.kind ?? "unknown";
      return {
        kind: "unsupported",
        driverKind: kind,
        detail: `The detected ${kind} driver does not serve diff previews.`
      };
    }
    return { kind: "ready" };
  }
  function isEnvelopeRejection(error) {
    return error instanceof Error && /byte limit/i.test(error.message);
  }
  function previewDeliveryKey(input) {
    return `${input.baseRef ?? ""}|${input.ignoreWhitespace === true ? "w" : ""}`;
  }
  function contentsDeliveryKey(source, row) {
    return `${source.id}:${source.diffHash}:${row.key}`;
  }
  var MAX_STREAM_KEYS = 64;
  async function fetchDiffPreview(options) {
    const { input, invoke, stream, streamKeys, signal } = options;
    const key = previewDeliveryKey(input);
    if (!streamKeys.has(key)) {
      try {
        const result = await invoke(input);
        return signal.aborted ? { kind: "cancelled" } : { kind: "ready", result, via: "unary" };
      } catch (error) {
        if (signal.aborted) return { kind: "cancelled" };
        if (!isEnvelopeRejection(error)) {
          return {
            kind: "error",
            detail: error instanceof Error ? error.message : "Diff preview unavailable"
          };
        }
        if (streamKeys.size >= MAX_STREAM_KEYS) streamKeys.clear();
        streamKeys.add(key);
      }
    }
    return fetchStreamedPreview(stream(input), signal);
  }
  async function fetchStreamedPreview(stream, signal) {
    let collected;
    try {
      collected = await collectPreviewStream(stream, signal);
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled" };
      return {
        kind: "error",
        detail: error instanceof Error ? error.message : "Diff stream unavailable"
      };
    }
    return streamOutcome(collected, signal);
  }
  function streamOutcome(collected, signal) {
    switch (collected.kind) {
      case "verified":
        return signal.aborted ? { kind: "cancelled" } : { kind: "ready", result: collected.result, via: "stream" };
      case "cancelled":
        return { kind: "cancelled" };
      case "protocol":
        return { kind: "error", detail: `Diff stream protocol error: ${collected.detail}` };
      case "incomplete":
        return {
          kind: "error",
          detail: `Diff stream ended before completing \u2014 ${collected.detail}. Refresh to retry.`
        };
      case "mismatch":
        return {
          kind: "error",
          detail: `Diff verification failed: ${collected.detail}. Nothing is shown.`
        };
    }
  }
  async function fetchFileContents(options) {
    const { input, deliveryKey, invoke, stream, streamKeys, signal } = options;
    if (!streamKeys.has(deliveryKey)) {
      try {
        const result = await invoke(input);
        return signal.aborted ? { kind: "cancelled" } : { kind: "ready", result, via: "unary" };
      } catch (error) {
        if (signal.aborted) return { kind: "cancelled" };
        if (!isEnvelopeRejection(error)) {
          return {
            kind: "error",
            detail: error instanceof Error ? error.message : "File contents unavailable"
          };
        }
        if (streamKeys.size >= MAX_STREAM_KEYS) streamKeys.clear();
        streamKeys.add(deliveryKey);
      }
    }
    let collected;
    try {
      collected = await collectFileContentsStream(stream(input), signal);
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled" };
      return {
        kind: "error",
        detail: error instanceof Error ? error.message : "File contents stream unavailable"
      };
    }
    return streamOutcome(collected, signal);
  }
  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }
  function createPreviewAssembly() {
    return { manifest: null, chunks: [], complete: null };
  }
  function applyPreviewStreamEvent(assembly, event) {
    if (assembly.complete !== null) {
      return { ok: false, detail: "stream continued after the complete frame" };
    }
    if (event.kind === "manifest") {
      if (assembly.manifest !== null) return { ok: false, detail: "duplicate manifest frame" };
      return {
        ok: true,
        assembly: {
          manifest: { generatedAt: event.generatedAt, sources: event.sources },
          chunks: event.sources.map(() => []),
          complete: null
        }
      };
    }
    if (assembly.manifest === null) {
      return { ok: false, detail: `${event.kind} frame arrived before the manifest` };
    }
    if (event.kind === "chunk") {
      const source = assembly.manifest.sources[event.sourceIndex];
      if (source === void 0) {
        return { ok: false, detail: `chunk for unknown sourceIndex ${event.sourceIndex}` };
      }
      if (event.chunkIndex >= source.chunkCount) {
        return {
          ok: false,
          detail: `chunkIndex ${event.chunkIndex} exceeds declared chunkCount ${source.chunkCount} for source ${source.id}`
        };
      }
      const received = assembly.chunks[event.sourceIndex] ?? [];
      if (event.chunkIndex !== received.length) {
        return {
          ok: false,
          detail: `out-of-order chunk ${event.chunkIndex} for source ${source.id} (expected ${received.length})`
        };
      }
      const chunks = assembly.chunks.slice();
      chunks[event.sourceIndex] = [...received, event.data];
      return { ok: true, assembly: { ...assembly, chunks } };
    }
    return { ok: true, assembly: { ...assembly, complete: event.payloadSha256 } };
  }
  async function verifyPreviewAssembly(assembly) {
    if (assembly.manifest === null) {
      return { kind: "incomplete", detail: "stream ended before the manifest" };
    }
    if (assembly.complete === null) {
      return { kind: "incomplete", detail: "stream ended before the complete frame" };
    }
    const bodies = [];
    for (const [index, source] of assembly.manifest.sources.entries()) {
      const chunks = assembly.chunks[index] ?? [];
      if (chunks.length !== source.chunkCount) {
        return {
          kind: "incomplete",
          detail: `source ${source.id}: received ${chunks.length} of ${source.chunkCount} declared chunks`
        };
      }
      const body = chunks.join("");
      if (utf8Length(body) !== source.diffByteLength) {
        return {
          kind: "mismatch",
          detail: `source ${source.id}: reassembled byte length does not match the manifest`
        };
      }
      if (await sha256Hex(body) !== source.diffHash) {
        return {
          kind: "mismatch",
          detail: `source ${source.id}: reassembled bytes do not match the manifest hash`
        };
      }
      bodies.push(body);
    }
    if (await sha256Hex(bodies.join("")) !== assembly.complete) {
      return { kind: "mismatch", detail: "reassembled payload does not match the terminal checksum" };
    }
    const manifest = assembly.manifest;
    return {
      kind: "verified",
      result: {
        generatedAt: manifest.generatedAt,
        sources: manifest.sources.map((source, index) => ({
          id: source.id,
          kind: source.kind,
          title: source.title,
          baseRef: source.baseRef,
          headRef: source.headRef,
          diff: bodies[index] ?? "",
          diffHash: source.diffHash,
          truncated: source.truncated
        }))
      }
    };
  }
  async function collectPreviewStream(stream, signal) {
    let assembly = createPreviewAssembly();
    for await (const frame of stream) {
      if (signal.aborted) return { kind: "cancelled" };
      const next = applyPreviewStreamEvent(assembly, frame.value);
      if (!next.ok) return { kind: "protocol", detail: next.detail };
      assembly = next.assembly;
    }
    if (signal.aborted) return { kind: "cancelled" };
    return verifyPreviewAssembly(assembly);
  }
  function createFileContentsAssembly() {
    return { manifest: null, sides: { old: [], new: [] }, complete: null };
  }
  function applyFileContentsStreamEvent(assembly, event) {
    if (assembly.complete !== null) {
      return { ok: false, detail: "stream continued after the complete frame" };
    }
    if (event.kind === "manifest") {
      if (assembly.manifest !== null) return { ok: false, detail: "duplicate manifest frame" };
      return {
        ok: true,
        assembly: {
          manifest: {
            oldByteLength: event.oldByteLength,
            oldChunkCount: event.oldChunkCount,
            newByteLength: event.newByteLength,
            newChunkCount: event.newChunkCount
          },
          sides: { old: [], new: [] },
          complete: null
        }
      };
    }
    if (assembly.manifest === null) {
      return { ok: false, detail: `${event.kind} frame arrived before the manifest` };
    }
    if (event.kind === "chunk") {
      const declared = event.side === "old" ? assembly.manifest.oldChunkCount : assembly.manifest.newChunkCount;
      if (event.chunkIndex >= declared) {
        return {
          ok: false,
          detail: `chunkIndex ${event.chunkIndex} exceeds declared ${event.side} chunkCount ${declared}`
        };
      }
      const received = assembly.sides[event.side];
      if (event.chunkIndex !== received.length) {
        return {
          ok: false,
          detail: `out-of-order ${event.side} chunk ${event.chunkIndex} (expected ${received.length})`
        };
      }
      return {
        ok: true,
        assembly: {
          ...assembly,
          sides: { ...assembly.sides, [event.side]: [...received, event.data] }
        }
      };
    }
    return {
      ok: true,
      assembly: {
        ...assembly,
        complete: { oldSha256: event.oldSha256, newSha256: event.newSha256 }
      }
    };
  }
  async function verifyFileContentsAssembly(assembly) {
    if (assembly.manifest === null) {
      return { kind: "incomplete", detail: "stream ended before the manifest" };
    }
    if (assembly.complete === null) {
      return { kind: "incomplete", detail: "stream ended before the complete frame" };
    }
    const manifest = assembly.manifest;
    const complete = assembly.complete;
    const sides = [
      {
        name: "old",
        chunks: assembly.sides.old,
        chunkCount: manifest.oldChunkCount,
        byteLength: manifest.oldByteLength,
        sha256: complete.oldSha256
      },
      {
        name: "new",
        chunks: assembly.sides.new,
        chunkCount: manifest.newChunkCount,
        byteLength: manifest.newByteLength,
        sha256: complete.newSha256
      }
    ];
    const bodies = {};
    for (const side of sides) {
      if (side.chunks.length !== side.chunkCount) {
        return {
          kind: "incomplete",
          detail: `${side.name} side: received ${side.chunks.length} of ${side.chunkCount} declared chunks`
        };
      }
      const body = side.chunks.join("");
      if (utf8Length(body) !== side.byteLength) {
        return {
          kind: "mismatch",
          detail: `${side.name} side: reassembled byte length does not match the manifest`
        };
      }
      if (await sha256Hex(body) !== side.sha256) {
        return {
          kind: "mismatch",
          detail: `${side.name} side: reassembled bytes do not match the complete-frame hash`
        };
      }
      bodies[side.name] = body;
    }
    return {
      kind: "verified",
      result: { oldContents: bodies.old ?? "", newContents: bodies.new ?? "" }
    };
  }
  async function collectFileContentsStream(stream, signal) {
    let assembly = createFileContentsAssembly();
    for await (const frame of stream) {
      if (signal.aborted) return { kind: "cancelled" };
      const next = applyFileContentsStreamEvent(assembly, frame.value);
      if (!next.ok) return { kind: "protocol", detail: next.detail };
      assembly = next.assembly;
    }
    if (signal.aborted) return { kind: "cancelled" };
    return verifyFileContentsAssembly(assembly);
  }
  var CONNECTING_DIFF_STATUS = {
    fingerprint: null,
    revision: 0,
    stream: "connecting",
    detail: null
  };
  function localStatusFingerprint(local) {
    return [
      local.refName ?? "",
      local.hasWorkingTreeChanges ? "1" : "0",
      local.workingTree.files.length,
      local.workingTree.insertions,
      local.workingTree.deletions,
      local.workingTree.truncated ? "1" : "0"
    ].join("|");
  }
  function foldDiffStatusEvent(model, event) {
    switch (event.kind) {
      case "snapshot": {
        const fingerprint = localStatusFingerprint(event.local);
        const changed = model.fingerprint !== null && model.fingerprint !== fingerprint;
        return {
          fingerprint,
          revision: model.revision + (changed ? 1 : 0),
          stream: "live",
          detail: null
        };
      }
      case "localUpdated": {
        const fingerprint = localStatusFingerprint(event.local);
        return {
          ...model,
          fingerprint,
          revision: model.revision + (model.fingerprint !== fingerprint ? 1 : 0),
          stream: "live"
        };
      }
      case "remoteUpdated":
        return model;
      case "closed":
        return {
          ...model,
          stream: "ended",
          detail: event.reason === "overflow" ? "The status stream overflowed its event queue." : "The status stream reported a status error."
        };
    }
  }
  function remoteBranchName(ref) {
    if (ref.remoteName !== void 0 && ref.name.startsWith(`${ref.remoteName}/`)) {
      return ref.name.slice(ref.remoteName.length + 1);
    }
    return ref.name;
  }
  function buildBaseRefChoices(refs) {
    const localRefs = refs.filter((ref) => ref.isRemote !== true);
    const remoteRefs = refs.filter((ref) => ref.isRemote === true);
    const unusedRemotes = new Set(remoteRefs);
    const paired = localRefs.map((local) => {
      const matches = remoteRefs.filter(
        (remote2) => unusedRemotes.has(remote2) && remoteBranchName(remote2) === local.name
      );
      const remote = matches.find((candidate) => candidate.remoteName === "origin") ?? matches[0] ?? null;
      if (remote !== null) unusedRemotes.delete(remote);
      return {
        id: `local:${local.name}`,
        label: local.name,
        refName: local.name,
        remote: remote !== null
      };
    });
    const remoteOnly = remoteRefs.filter((remote) => unusedRemotes.has(remote)).map((remote) => ({
      id: `remote:${remote.name}`,
      label: remote.name,
      refName: remote.name,
      remote: true
    }));
    return [...paired, ...remoteOnly];
  }
  function filterBaseRefChoices(choices, query) {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) return choices;
    return choices.filter(
      (choice) => choice.label.toLocaleLowerCase().includes(normalized) || choice.refName.toLocaleLowerCase().includes(normalized)
    );
  }
  function countTreeFiles(node) {
    let count = node.files.length;
    for (const child of node.dirs.values()) count += countTreeFiles(child);
    return count;
  }
  function diffTreeRows(files, collapsedDirs) {
    const root = { dirs: /* @__PURE__ */ new Map(), files: [] };
    for (const row of files) {
      const segments = row.path.split("/");
      let node = root;
      for (const segment of segments.slice(0, -1)) {
        let child = node.dirs.get(segment);
        if (child === void 0) {
          child = { dirs: /* @__PURE__ */ new Map(), files: [] };
          node.dirs.set(segment, child);
        }
        node = child;
      }
      node.files.push(row);
    }
    const rows = [];
    const walk = (node, path3, depth) => {
      for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const dirPath = `${path3}${name}/`;
        rows.push({
          kind: "dir",
          path: dirPath,
          name,
          depth,
          collapsed: collapsedDirs.has(dirPath),
          fileCount: countTreeFiles(child)
        });
        if (!collapsedDirs.has(dirPath)) walk(child, dirPath, depth + 1);
      }
      for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
        rows.push({
          kind: "file",
          row: file,
          name: file.path.split("/").pop() ?? file.path,
          depth
        });
      }
    };
    walk(root, "", 0);
    return rows;
  }
  function areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) {
    return fileKeys.length > 0 && fileKeys.every((key) => collapsedFileKeys.has(key));
  }
  function toggleAllDiffFiles(fileKeys, collapsedFileKeys) {
    return areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) ? /* @__PURE__ */ new Set() : new Set(fileKeys);
  }
  function toggleCollapsedKey(collapsedKeys, key) {
    const next = new Set(collapsedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  }
  function presentationPath(path3) {
    if (path3.length === 0 || path3.startsWith("/") || path3.includes("\\") || path3.split("/").some((segment) => segment === "" || segment === "..")) {
      return null;
    }
    return path3;
  }
  function describePresentation(result) {
    return `opens in ${result.surfaceId} \xB7 ${result.placement}`;
  }

  // extension.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.diff";
  var patchParseCache = /* @__PURE__ */ new Map();
  function renderableFor(diffHash, diff) {
    const cached = patchParseCache.get(diffHash);
    if (cached !== void 0) return cached;
    const value = renderableFromPatch(diff);
    if (patchParseCache.size >= 16) patchParseCache.clear();
    patchParseCache.set(diffHash, value);
    return value;
  }
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value;
    return Object.keys(record).every(
      (key) => key === "sourceId" || key === "fileKey" || key === "baseRef" || key === "ignoreWhitespace"
    ) && (record.sourceId === void 0 || typeof record.sourceId === "string") && (record.fileKey === void 0 || typeof record.fileKey === "string") && (record.baseRef === void 0 || typeof record.baseRef === "string") && (record.ignoreWhitespace === void 0 || typeof record.ignoreWhitespace === "boolean");
  }
  function useCapabilities(host, session, visible, tick) {
    const [result, setResult] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(vcsRepositoryApi, host, session.context).invoke("getCapabilities", {}, signal).then(
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
  function useStatusRefresh(host, session, enabled) {
    const [model, setModel] = (0, import_react.useState)(CONNECTING_DIFF_STATUS);
    (0, import_react.useEffect)(() => {
      if (!enabled) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        let status = CONNECTING_DIFF_STATUS;
        setModel(status);
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
              status = foldDiffStatusEvent(status, frame.value);
              setModel(status);
              if (frame.value.kind === "closed") {
                closed = true;
                break;
              }
            }
          } catch (error) {
            if (!signal.aborted)
              setModel({
                ...status,
                stream: "ended",
                detail: error instanceof Error ? error.message : "Status stream unavailable"
              });
            return;
          }
          if (signal.aborted) return;
          if (!closed) {
            setModel({
              ...status,
              stream: "ended",
              detail: "Status stream ended unexpectedly."
            });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
        if (!signal.aborted)
          setModel({ ...status, stream: "ended", detail: "Status stream ended repeatedly." });
      })();
      return () => controller.abort();
    }, [host, session, enabled]);
    return model;
  }
  function useRefs(host, session, enabled, revision2) {
    const [result, setResult] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      if (!enabled) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const api = bindApi(vcsRefsApi, host, session.context);
      void Promise.all([
        api.invoke("list", { refKind: "local", limit: 200 }, signal),
        api.invoke("list", { refKind: "remote", limit: 200 }, signal)
      ]).then(
        ([local, remote]) => {
          if (!signal.aborted)
            setResult({
              key: revision2,
              refs: {
                refs: [...local.refs, ...remote.refs],
                isRepo: local.isRepo,
                hasPrimaryRemote: local.hasPrimaryRemote,
                nextCursor: null,
                totalCount: local.totalCount + remote.totalCount
              },
              error: null
            });
        },
        (error) => {
          if (!signal.aborted)
            setResult((prev) => ({
              key: revision2,
              refs: prev?.refs ?? null,
              error: error instanceof Error ? error.message : "Refs unavailable"
            }));
        }
      );
      return () => controller.abort();
    }, [host, session, enabled, revision2]);
    return result?.key === revision2 ? result : { refs: null, error: null };
  }
  function useDiffPreview(host, session, enabled, requestKey, input) {
    const [result, setResult] = (0, import_react.useState)(null);
    const streamKeys = (0, import_react.useRef)(/* @__PURE__ */ new Set());
    (0, import_react.useEffect)(() => {
      if (!enabled) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const api = bindApi(vcsDiffApi, host, session.context);
      const streams = bindStreamApi(vcsDiffApi, host, session.context);
      void fetchDiffPreview({
        input,
        invoke: (next) => api.invoke("getPreview", next, signal),
        stream: (next) => streams.subscribe("streamPreview", next, signal),
        streamKeys: streamKeys.current,
        signal
      }).then((outcome) => {
        if (signal.aborted || outcome.kind === "cancelled") return;
        setResult(
          (prev) => outcome.kind === "ready" ? { key: requestKey, preview: outcome.result, error: null, pending: false } : {
            key: requestKey,
            preview: prev?.preview ?? null,
            error: outcome.detail,
            pending: false
          }
        );
      });
      return () => controller.abort();
    }, [host, session, enabled, requestKey, input]);
    return {
      // Last-good preview stays up across refreshes and key changes.
      preview: result?.preview ?? null,
      error: result?.key === requestKey ? result.error : null,
      pending: result?.key !== requestKey || result.pending
    };
  }
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
  var rowBase = {
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
    color: "var(--muted-foreground, #667085)",
    userSelect: "none"
  };
  var iconButton = {
    ...control,
    padding: "2px 6px",
    fontSize: 11
  };
  function DiffRow({ row, wrap }) {
    if (row.kind === "gap") {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          style: {
            ...rowBase,
            justifyContent: "center",
            color: "var(--muted-foreground, #667085)",
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
          ...rowBase,
          whiteSpace: wrap ? "pre-wrap" : "pre",
          wordBreak: wrap ? "break-all" : void 0,
          background: addition ? "color-mix(in srgb, var(--success, #2da44e) 14%, transparent)" : deletion ? "color-mix(in srgb, var(--destructive, #cf222e) 12%, transparent)" : "transparent"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: gutter, children: deletion || row.kind === "context" ? row.oldLine ?? "" : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: gutter, children: addition || row.kind === "context" ? row.newLine ?? "" : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--muted-foreground, #667085)", userSelect: "none", width: 14 }, children: addition ? "+" : deletion ? "\u2212" : " " }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.text })
        ]
      }
    );
  }
  function FileSection({
    row,
    selected,
    collapsed,
    wrap,
    expansion,
    action,
    onToggleCollapsed,
    onExpand,
    onOpen,
    onCopy,
    registerSection
  }) {
    const muted = "var(--muted-foreground, #667085)";
    const expanded = expansion?.status === "loaded" ? expansion.contents : void 0;
    const rows = (0, import_react.useMemo)(
      () => collapsed || row.binary || row.textless ? [] : fileRows(row, expanded),
      [collapsed, row, expanded]
    );
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "section",
      {
        ref: registerSection,
        "aria-label": displayPath(row),
        style: {
          borderBottom: "1px solid var(--border, #dfe3e8)",
          outline: selected ? "1px solid var(--accent, #b7cff0)" : void 0,
          outlineOffset: -1
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                fontSize: 12,
                position: "sticky",
                top: 0,
                background: "var(--background, #fff)",
                zIndex: 1
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-expanded": !collapsed,
                    "aria-label": `${collapsed ? "Expand" : "Collapse"} ${displayPath(row)}`,
                    onClick: () => onToggleCollapsed(row.key),
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
                ),
                canExpandFile(row) && !collapsed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    style: iconButton,
                    disabled: expansion?.status === "loading",
                    onClick: () => onExpand(row),
                    children: expansion?.status === "loaded" ? "Context loaded" : "Full context"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: iconButton, onClick: () => onOpen(row), children: "Open" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: iconButton, onClick: () => onCopy(row), children: "Copy path" })
              ]
            }
          ),
          action !== null && action.key === row.key && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "p",
            {
              role: action.status === "error" ? "alert" : "note",
              style: { margin: 0, padding: "2px 10px", color: muted, fontSize: 11 },
              children: action.detail
            }
          ),
          !collapsed && row.binary && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "4px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            row.path,
            " is a binary file \u2014 no text diff is available."
          ] }),
          !collapsed && row.textless && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "4px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "No textual changes in the patch for ",
            displayPath(row),
            "."
          ] }),
          !collapsed && rows.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DiffRow, { row: line, wrap }, line.ordinal)),
          !collapsed && expansion?.status === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }, children: "Loading file contents\u2026" }),
          !collapsed && expansion?.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }, children: expansion.detail }),
          !collapsed && expansion?.status === "loaded" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }, children: "Full file context loaded via t3.vcs/diff." })
        ]
      }
    );
  }
  function DiffPanelView(props) {
    const { host, session } = props;
    const [visible, setVisible] = (0, import_react.useState)(session.visible);
    const [tick, setTick] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => session.onVisibility(setVisible), [session]);
    const restored = session.restoreState && typeof session.restoreState === "object" && !Array.isArray(session.restoreState) ? session.restoreState : null;
    const [sourceId, setSourceId] = (0, import_react.useState)(restored?.sourceId ?? null);
    const [fileKey, setFileKey] = (0, import_react.useState)(restored?.fileKey ?? null);
    const [baseRef, setBaseRef] = (0, import_react.useState)(restored?.baseRef ?? "");
    const [ignoreWhitespace, setIgnoreWhitespace] = (0, import_react.useState)(
      restored?.ignoreWhitespace ?? false
    );
    const [wrap, setWrap] = (0, import_react.useState)(false);
    const [collapsedFiles, setCollapsedFiles] = (0, import_react.useState)(/* @__PURE__ */ new Set());
    const [collapsedDirs, setCollapsedDirs] = (0, import_react.useState)(/* @__PURE__ */ new Set());
    const [expansions, setExpansions] = (0, import_react.useState)(/* @__PURE__ */ new Map());
    const [action, setAction] = (0, import_react.useState)(
      null
    );
    const expandControllers = (0, import_react.useRef)(/* @__PURE__ */ new Map());
    const contentStreamKeys = (0, import_react.useRef)(/* @__PURE__ */ new Set());
    const sectionRefs = (0, import_react.useRef)(/* @__PURE__ */ new Map());
    const { capabilities, error: capsError } = useCapabilities(host, session, visible, tick);
    const gate = diffCapabilityState(capabilities, capsError);
    const ready = gate.kind === "ready";
    const status = useStatusRefresh(host, session, visible && ready);
    const previewInput = (0, import_react.useMemo)(
      () => ({
        ...baseRef !== "" ? { baseRef } : {},
        ...ignoreWhitespace ? { ignoreWhitespace: true } : {}
      }),
      [baseRef, ignoreWhitespace]
    );
    const requestKey = `${tick}:${status.revision}:${previewDeliveryKey(previewInput)}`;
    const {
      preview: previewData,
      error: previewError,
      pending
    } = useDiffPreview(host, session, visible && ready, requestKey, previewInput);
    const preview = previewState(previewData, previewData === null ? previewError : null);
    const { refs } = useRefs(host, session, visible && ready, status.revision);
    const source = selectSource(preview.kind === "ready" ? preview.result : null, sourceId);
    const renderable = source === null ? null : renderableFor(source.diffHash, source.diff);
    const files = renderable?.kind === "files" ? renderable.files : [];
    const selected = retainFileSelection(files, fileKey);
    const treeRows = diffTreeRows(files, collapsedDirs);
    const fileKeys = files.map((row) => row.key);
    const allCollapsed = areAllDiffFilesCollapsed(fileKeys, collapsedFiles);
    const baseRefChoices = (0, import_react.useMemo)(() => buildBaseRefChoices(refs?.refs ?? []), [refs]);
    const sourceKey = source?.diffHash ?? null;
    (0, import_react.useEffect)(() => {
      if (sourceKey === null) return;
      const controllers = expandControllers.current;
      return () => {
        for (const controller of controllers.values()) controller.abort();
        controllers.clear();
      };
    }, [sourceKey]);
    const revealTarget = (0, import_react.useRef)(null);
    const [revealTick, setRevealTick] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => {
      if (revealTick === 0) return;
      const key = revealTarget.current;
      if (key === null || collapsedFiles.has(key)) return;
      sectionRefs.current.get(key)?.scrollIntoView({ block: "start" });
      revealTarget.current = null;
    }, [revealTick, collapsedFiles]);
    const persist = (nextSource, nextFile, nextBase, nextWhitespace) => {
      session.save({
        ...nextSource !== null ? { sourceId: nextSource } : {},
        ...nextFile !== null ? { fileKey: nextFile } : {},
        ...nextBase !== "" ? { baseRef: nextBase } : {},
        ...nextWhitespace ? { ignoreWhitespace: true } : {}
      });
    };
    const chooseSource = (id) => {
      setSourceId(id);
      setFileKey(null);
      persist(id, null, baseRef, ignoreWhitespace);
    };
    const revealFile = (row) => {
      setCollapsedFiles((current) => {
        const next = new Set(current);
        next.delete(row.key);
        return next;
      });
      setFileKey(row.key);
      revealTarget.current = row.key;
      setRevealTick((tick2) => tick2 + 1);
      persist(source?.id ?? null, row.key, baseRef, ignoreWhitespace);
    };
    const chooseBaseRef = (value) => {
      setBaseRef(value);
      persist(source?.id ?? null, fileKey, value, ignoreWhitespace);
    };
    const chooseWhitespace = (value) => {
      setIgnoreWhitespace(value);
      persist(source?.id ?? null, fileKey, baseRef, value);
    };
    const expandFile = (row) => {
      if (source === null) return;
      const key = `${source.diffHash}:${row.key}`;
      if (expansions.has(key)) return;
      const controller = new AbortController();
      expandControllers.current.set(key, controller);
      const signal = AbortSignal.any([controller.signal, session.signal]);
      setExpansions((prev) => {
        const next = new Map(prev);
        if (next.size > 64) next.clear();
        return next.set(key, { status: "loading" });
      });
      const input = fileContentsInput(source, row);
      const api = bindApi(vcsDiffApi, host, session.context);
      const streams = bindStreamApi(vcsDiffApi, host, session.context);
      void fetchFileContents({
        input,
        deliveryKey: contentsDeliveryKey(source, row),
        invoke: (next) => api.invoke("getFileContents", next, signal),
        stream: (next) => streams.subscribe("streamFileContents", next, signal),
        streamKeys: contentStreamKeys.current,
        signal
      }).then((outcome) => {
        expandControllers.current.delete(key);
        if (signal.aborted || outcome.kind === "cancelled") return;
        setExpansions(
          (prev) => new Map(prev).set(
            key,
            outcome.kind === "ready" ? { status: "loaded", contents: outcome.result } : { status: "error", detail: outcome.detail }
          )
        );
      });
    };
    const openInEditor = (row) => {
      const path3 = presentationPath(row.path);
      if (path3 === null) {
        setAction({
          key: row.key,
          status: "error",
          detail: `${displayPath(row)} cannot be opened \u2014 not a workspace-relative path.`
        });
        return;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      setAction({ key: row.key, status: "loading", detail: "Resolving presentation\u2026" });
      void bindApi(filePresentationApi, host, session.context).invoke("open", { relativePath: path3 }, signal).then(
        (result) => {
          if (!signal.aborted)
            setAction({ key: row.key, status: "resolved", detail: describePresentation(result) });
        },
        (error) => {
          if (!signal.aborted)
            setAction({
              key: row.key,
              status: "error",
              detail: error instanceof Error ? error.message : "Presentation unavailable"
            });
        }
      );
    };
    const copyPath = (row) => {
      if (typeof navigator === "undefined" || navigator.clipboard === void 0) {
        setAction({ key: row.key, status: "error", detail: "Clipboard unavailable" });
        return;
      }
      void navigator.clipboard.writeText(row.path).then(
        () => setAction({ key: row.key, status: "copied", detail: `Copied ${row.path}` }),
        (error) => setAction({
          key: row.key,
          status: "error",
          detail: error instanceof Error ? error.message : "Copy failed"
        })
      );
    };
    const muted = "var(--muted-foreground, #667085)";
    const sources = preview.kind === "ready" ? preview.result.sources : [];
    const filteredBaseChoices = filterBaseRefChoices(baseRefChoices, baseRef);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "section",
      {
        "aria-label": "Diff",
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
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                gap: 6,
                padding: 8,
                borderBottom: "1px solid var(--border, #dfe3e8)",
                flexShrink: 0,
                alignItems: "center",
                flexWrap: "wrap"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setTick((value) => value + 1), style: control, children: "Refresh" }),
                sources.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-current": source?.id === item.id ? "true" : void 0,
                    onClick: () => chooseSource(item.id),
                    style: {
                      ...control,
                      fontWeight: source?.id === item.id ? 600 : 400,
                      background: source?.id === item.id ? "var(--accent, #e8eef7)" : "transparent"
                    },
                    children: describeSource(item)
                  },
                  item.id
                )),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "text",
                    "aria-label": "Base ref",
                    placeholder: "Base ref (automatic)",
                    list: "t3-diff-base-refs",
                    value: baseRef,
                    onChange: (event) => chooseBaseRef(event.target.value),
                    style: { ...control, width: 140 }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("datalist", { id: "t3-diff-base-refs", children: filteredBaseChoices.map((choice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: choice.refName, children: choice.label }, choice.id)) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 12 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked: ignoreWhitespace,
                      onChange: (event) => chooseWhitespace(event.target.checked)
                    }
                  ),
                  "Ignore whitespace"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 12 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked: wrap,
                      onChange: (event) => setWrap(event.target.checked)
                    }
                  ),
                  "Wrap"
                ] }),
                files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    style: control,
                    onClick: () => setCollapsedFiles(toggleAllDiffFiles(fileKeys, collapsedFiles)),
                    children: allCollapsed ? "Expand all" : "Collapse all"
                  }
                ),
                status.stream === "ended" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { role: "note", style: { color: muted, fontSize: 11 }, children: [
                  status.detail ?? "Status stream ended",
                  " \u2014 refresh is manual."
                ] })
              ]
            }
          ),
          gate.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "Reading repository capabilities\u2026" }),
          gate.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "Repository status unavailable \u2014 ",
            gate.detail
          ] }),
          gate.kind === "no-repository" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "This workspace is not a repository",
            gate.detail ? ` \u2014 ${gate.detail}` : "",
            "."
          ] }),
          gate.kind === "unsupported" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "Unsupported repository driver: ",
            gate.driverKind,
            ". ",
            gate.detail
          ] }),
          ready && preview.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "Loading diff\u2026" }),
          ready && preview.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: preview.detail }),
          ready && preview.kind === "empty" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "No diff sources reported for this workspace." }),
          ready && previewData !== null && previewError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "Refresh failed \u2014 ",
            previewError
          ] }),
          ready && preview.kind === "ready" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }, children: [
            pending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { padding: "2px 10px", color: muted, fontSize: 11, margin: 0 }, children: "Refreshing\u2026" }),
            source?.truncated === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "p",
              {
                role: "note",
                style: {
                  margin: 0,
                  padding: "6px 10px",
                  fontSize: 11,
                  color: muted,
                  borderBottom: "1px solid var(--border, #dfe3e8)",
                  flexShrink: 0
                },
                children: "This diff was truncated because it exceeded the preview limit. The changes shown are incomplete."
              }
            ),
            renderable === null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "No net changes in this selection." }),
            renderable?.kind === "raw" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 8, overflow: "auto", flex: 1, minHeight: 0 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { color: muted, fontSize: 11, margin: "0 0 6px" }, children: renderable.reason }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "pre",
                {
                  style: {
                    margin: 0,
                    padding: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    border: "1px solid var(--border, #dfe3e8)",
                    borderRadius: 6,
                    overflow: "auto"
                  },
                  children: renderable.text
                }
              )
            ] }),
            renderable?.kind === "files" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "ul",
                {
                  "aria-label": "Changed files",
                  style: {
                    listStyle: "none",
                    margin: 0,
                    padding: 4,
                    overflow: "auto",
                    flexShrink: 0,
                    maxHeight: "34%",
                    borderBottom: "1px solid var(--border, #dfe3e8)"
                  },
                  children: treeRows.map(
                    (row) => row.kind === "dir" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "button",
                      {
                        type: "button",
                        "aria-expanded": !row.collapsed,
                        onClick: () => setCollapsedDirs(toggleCollapsedKey(collapsedDirs, row.path)),
                        style: {
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          font: "inherit",
                          fontSize: 12,
                          padding: "3px 6px",
                          paddingLeft: 6 + row.depth * 14,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: muted
                        },
                        children: [
                          row.collapsed ? "\u25B8" : "\u25BE",
                          " ",
                          row.name,
                          "/",
                          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                            " (",
                            row.fileCount,
                            ")"
                          ] })
                        ]
                      }
                    ) }, row.path) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "button",
                      {
                        type: "button",
                        "aria-current": selected?.key === row.row.key ? "true" : void 0,
                        onClick: () => revealFile(row.row),
                        style: {
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          font: "inherit",
                          fontSize: 12,
                          padding: "4px 6px",
                          paddingLeft: 6 + row.depth * 14 + 14,
                          border: "1px solid transparent",
                          borderRadius: 5,
                          cursor: "pointer",
                          color: "var(--foreground, #20252d)",
                          background: selected?.key === row.row.key ? "var(--accent, #e8eef7)" : "transparent",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        },
                        children: [
                          row.name,
                          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted }, children: [
                            " ",
                            "\u2014 ",
                            row.row.binary ? "binary" : changeTypeLabel(row.row.changeType),
                            fileStatLabel(row.row) !== "" ? ` ${fileStatLabel(row.row)}` : ""
                          ] })
                        ]
                      }
                    ) }, row.row.key)
                  )
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, "aria-label": "File diffs", children: [
                files.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "Select a file to inspect its changes." }),
                source !== null && files.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  FileSection,
                  {
                    row,
                    selected: selected?.key === row.key,
                    collapsed: collapsedFiles.has(row.key),
                    wrap,
                    expansion: expansions.get(`${source.diffHash}:${row.key}`),
                    action,
                    onToggleCollapsed: (key) => setCollapsedFiles(toggleCollapsedKey(collapsedFiles, key)),
                    onExpand: expandFile,
                    onOpen: openInEditor,
                    onCopy: copyPath,
                    registerSection: (el) => {
                      if (el !== null) sectionRefs.current.set(row.key, el);
                      else sectionRefs.current.delete(row.key);
                    }
                  },
                  row.key
                ))
              ] })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "output",
            {
              "aria-label": "Slice notice",
              style: {
                padding: "6px 10px",
                color: muted,
                fontSize: 11,
                borderTop: "1px solid var(--border, #dfe3e8)",
                flexShrink: 0
              },
              children: "Read-only diff on t3.vcs/diff 1.1: unary small previews, sha256-verified streams for large payloads, status-driven refresh. Split view, comments, and turn diffs are deferred slices."
            }
          )
        ]
      }
    );
  }
  var extension_default = defineExtension({
    id: manifestId,
    version: "0.2.0",
    requires: [
      requireApi(vcsDiffApi),
      requireApi(vcsRepositoryApi),
      requireApi(vcsStatusApi),
      requireApi(vcsRefsApi),
      requireApi(filePresentationApi)
    ],
    surfaces: [
      {
        name: "view",
        title: "Diff",
        scope: "thread",
        placements: ["side-panel"],
        clients: ["web", "desktop"],
        capabilities: [],
        stateVersion: 1,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DiffPanelView, { host, session }) };
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
