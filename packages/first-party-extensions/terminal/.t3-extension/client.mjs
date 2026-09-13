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

  // ../../shared/src/projectScripts.ts
  function projectScriptRuntimeEnv(input) {
    const env = {
      T3CODE_PROJECT_ROOT: input.project.cwd
    };
    if (input.worktreePath) {
      env.T3CODE_WORKTREE_PATH = input.worktreePath;
    }
    if (input.extraEnv) {
      return { ...env, ...input.extraEnv };
    }
    return env;
  }

  // extension.tsx
  var import_react = __toESM(require_react(), 1);

  // ../../shared/src/terminalLabels.ts
  function getTerminalLabel(terminalId) {
    const numericSuffix = /^term(?:inal)?-(\d+)$/i.exec(terminalId)?.[1];
    if (numericSuffix) {
      return `Terminal ${numericSuffix}`;
    }
    return terminalId;
  }
  function resolveTerminalSessionLabel(terminalId, summary) {
    const trimmed = summary?.label?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
    return getTerminalLabel(terminalId);
  }
  function nextTerminalId(existingTerminalIds) {
    const usedIds = new Set(existingTerminalIds.filter((id) => id.trim().length > 0));
    let nextIndex = 1;
    while (usedIds.has(`term-${nextIndex}`)) {
      nextIndex += 1;
    }
    return `term-${nextIndex}`;
  }

  // viewModel.ts
  var TERMINAL_BUFFER_MAX_BYTES = 512 * 1024;
  var OVERFLOW_RESUBSCRIBE_WINDOW_MS = 1e4;
  var OVERFLOW_RESUBSCRIBE_MAX = 3;
  var EMPTY_OVERFLOW_STREAK = { attempts: 0, lastAt: 0 };
  var noteOutputFrameForStreak = (value, streak, now) => {
    if (value.kind !== "closed") return streak;
    if (value.reason === "identity-changed") return EMPTY_OVERFLOW_STREAK;
    if (value.reason !== "overflow") return streak;
    return {
      attempts: streak.attempts > 0 && now - streak.lastAt < OVERFLOW_RESUBSCRIBE_WINDOW_MS ? streak.attempts + 1 : 1,
      lastAt: now
    };
  };
  var isResumableOutputClose = (reason, overflowAttempts) => reason === "identity-changed" || reason === "overflow" && overflowAttempts <= OVERFLOW_RESUBSCRIBE_MAX;
  var textEncoder = new TextEncoder();
  var utf8Bytes = (value) => textEncoder.encode(value).byteLength;
  function tailByBytes(value, maxBytes) {
    if (maxBytes <= 0) return "";
    const encoded = textEncoder.encode(value);
    if (encoded.byteLength <= maxBytes) return value;
    let start = encoded.byteLength - maxBytes;
    while (start < encoded.length && (encoded[start] & 192) === 128) start += 1;
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoded.subarray(start));
  }
  function normalizeTerminalIds(ids) {
    const seen = /* @__PURE__ */ new Set();
    const next = [];
    for (const raw of ids) {
      const id = raw.trim();
      if (id.length === 0 || id.length > 128 || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    return next;
  }
  function resolveActiveTerminalId(ids, activeTerminalId) {
    if (ids.length === 0) return null;
    return activeTerminalId !== null && ids.includes(activeTerminalId) ? activeTerminalId : ids[0] ?? null;
  }
  var EMPTY_OUTPUT_BUFFER = {
    contents: "",
    retainedBytes: 0,
    truncated: false,
    status: "connecting",
    statusText: "Connecting\u2026",
    exitCode: null,
    epoch: null,
    sequence: 0,
    ended: false
  };
  function applyOutputEvent(current, frame, value, pending) {
    const fail = (message) => ({
      buffer: { ...EMPTY_OUTPUT_BUFFER, status: "error", statusText: message, ended: true },
      pending: null
    });
    if (current.ended) return fail("Output arrived after the terminal lifecycle ended.");
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== current.sequence + 1)
      return fail("Output transport sequence is discontinuous.");
    const sequence = frame.sequence;
    const base = { ...current, sequence };
    if (value.kind === "snapshot") {
      if (frame.sequence < 0 || !Number.isSafeInteger(value.boundarySequence))
        return fail("Output snapshot boundary is invalid.");
      const contents3 = tailByBytes(value.contents, TERMINAL_BUFFER_MAX_BYTES);
      const ended = value.status === "exited" || value.status === "error";
      return {
        buffer: {
          contents: contents3,
          retainedBytes: utf8Bytes(contents3),
          truncated: value.truncated,
          status: ended ? "exited" : "live",
          statusText: ended ? `Terminal is ${value.status}.` : value.truncated ? "Watching live output. Older retained history was omitted." : "Watching live output.",
          exitCode: null,
          epoch: value.streamEpoch,
          sequence,
          ended
        },
        pending: null
      };
    }
    if (current.epoch === null || value.streamEpoch !== current.epoch)
      return fail("Output incarnation changed.");
    if (value.kind === "closed") {
      return {
        buffer: {
          ...base,
          contents: "",
          retainedBytes: 0,
          status: "closed",
          statusText: `Output unavailable: ${value.reason}. Subscribe again to recover.`,
          ended: true
        },
        pending: null
      };
    }
    if (!Number.isSafeInteger(value.sequence)) return fail("Output native sequence is invalid.");
    if (value.kind === "reset") {
      return {
        buffer: {
          ...base,
          contents: "",
          retainedBytes: 0,
          truncated: false,
          status: "live",
          statusText: "Terminal history cleared. Watching live output."
        },
        pending: null
      };
    }
    if (value.kind === "exit") {
      if (pending) return fail("Terminal exited with incomplete output.");
      return {
        buffer: {
          ...base,
          status: "exited",
          statusText: `Terminal exited (code ${value.exitCode ?? "unknown"}).`,
          exitCode: value.exitCode,
          ended: true
        },
        pending: null
      };
    }
    if (!Number.isSafeInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > 64 || !Number.isSafeInteger(value.chunkIndex) || value.chunkIndex < 0 || value.chunkIndex >= value.chunkCount || typeof value.data !== "string" || value.data.length > 8192)
      return fail("Output chunk exceeds the public contract.");
    const group = pending && pending.sequence === value.sequence && pending.count === value.chunkCount ? pending : value.chunkIndex === 0 ? { sequence: value.sequence, count: value.chunkCount, parts: [] } : null;
    if (group === null || group.parts.length !== value.chunkIndex)
      return fail("Output chunk group is discontinuous.");
    group.parts.push(value.data);
    if (group.parts.length < group.count) return { buffer: base, pending: group };
    const contents2 = tailByBytes(base.contents + group.parts.join(""), TERMINAL_BUFFER_MAX_BYTES);
    return {
      buffer: {
        ...base,
        contents: contents2,
        retainedBytes: utf8Bytes(contents2),
        status: "live",
        statusText: "Watching live output."
      },
      pending: null
    };
  }
  function terminalIdListsEqual(left, right) {
    if (left.length !== right.length) return false;
    if (left.length === 0) return true;
    const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
    const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
    for (let index = 0; index < sortedLeft.length; index += 1) {
      if (sortedLeft[index] !== sortedRight[index]) return false;
    }
    return true;
  }
  function serverTerminalIdsStrictSubsetOfClient(serverIds, clientIds) {
    if (serverIds.length >= clientIds.length || clientIds.length === 0) return false;
    const clientSet = new Set(clientIds);
    for (const id of serverIds) {
      if (!clientSet.has(id)) return false;
    }
    return true;
  }
  function reconcileTerminalIds(clientIds, serverIds) {
    if (terminalIdListsEqual(clientIds, serverIds)) return [...clientIds];
    if (serverTerminalIdsStrictSubsetOfClient(serverIds, clientIds)) return [...clientIds];
    return [...serverIds];
  }
  function workspaceLaunchFromRevision(workspaceRevision) {
    if (workspaceRevision === void 0) return null;
    try {
      const parsed = JSON.parse(workspaceRevision);
      if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || parsed[0].trim().length === 0 || parsed[1] !== null && (typeof parsed[1] !== "string" || parsed[1].trim().length === 0))
        return null;
      const workspaceRoot = parsed[0];
      const worktreePath = parsed[1];
      return { cwd: worktreePath ?? workspaceRoot, workspaceRoot, worktreePath };
    } catch {
      return null;
    }
  }
  var MAX_QUEUED_INPUT_BYTES = 64 * 1024;
  var MAX_QUEUED_INPUT_WRITES = 128;
  var MAX_WRITE_DATA_LENGTH = 65536;
  var newTab = () => ({
    meta: null,
    starting: false,
    queue: [],
    queueBytes: 0,
    exiting: false,
    exitBanner: null,
    confirm: null,
    error: null,
    resizeInFlight: null,
    resizePending: null,
    resizeSent: null
  });
  var clampDimension = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max ? value : null;
  var TerminalPanel = class {
    #control;
    #launch;
    #schedule;
    #onChange;
    #ids;
    #active;
    #tabs = /* @__PURE__ */ new Map();
    #stream = "connecting";
    #panelError = null;
    #disposed = false;
    constructor(options) {
      this.#control = options.control;
      this.#launch = options.launch;
      this.#schedule = options.schedule ?? ((callback) => setTimeout(callback, 0));
      this.#onChange = options.onChange;
      this.#ids = normalizeTerminalIds(options.restored?.terminalIds ?? []);
      this.#active = resolveActiveTerminalId(this.#ids, options.restored?.activeTerminalId ?? null);
      for (const id of this.#ids) this.#tabs.set(id, newTab());
    }
    get snapshot() {
      return {
        terminalIds: [...this.#ids],
        activeTerminalId: this.#active,
        tabs: this.#ids.map((id) => {
          const tab = this.#tabs.get(id);
          const meta = tab.meta;
          return {
            terminalId: id,
            label: resolveTerminalSessionLabel(id, meta),
            status: tab.starting ? "starting" : meta?.status ?? "closed",
            hasRunningSubprocess: meta?.hasRunningSubprocess ?? false,
            exitCode: meta?.exitCode ?? null,
            starting: tab.starting,
            exitBanner: tab.exitBanner,
            confirmAction: tab.confirm,
            error: tab.error,
            queuedInputCount: tab.queue.length
          };
        }),
        stream: this.#stream,
        panelError: this.#panelError
      };
    }
    /** Ids eligible for allocation: client list plus any tab we are tracking. */
    get allocatableTerminalIds() {
      return [.../* @__PURE__ */ new Set([...this.#ids, ...this.#tabs.keys()])];
    }
    #emit() {
      this.#onChange?.();
    }
    #tab(terminalId) {
      let tab = this.#tabs.get(terminalId);
      if (!tab) {
        tab = newTab();
        this.#tabs.set(terminalId, tab);
        if (!this.#ids.includes(terminalId)) this.#ids = [...this.#ids, terminalId];
      }
      return tab;
    }
    #removeTab(terminalId) {
      this.#tabs.delete(terminalId);
      this.#ids = this.#ids.filter((id) => id !== terminalId);
      this.#active = resolveActiveTerminalId(this.#ids, this.#active);
      this.#emit();
    }
    /** Banner + deferred removal on a live→exited/error transition (native #29). */
    #observeMeta(next) {
      const tab = this.#tab(next.terminalId);
      const previous = tab.meta;
      tab.meta = next;
      if (!tab.exiting && (next.status === "exited" || next.status === "error") && previous !== null && (previous.status === "starting" || previous.status === "running")) {
        tab.exiting = true;
        tab.exitBanner = next.status === "exited" ? `Process exited (code ${next.exitCode ?? "unknown"})` : "Terminal error";
        this.#schedule(() => {
          if (!this.#disposed && this.#tabs.get(next.terminalId)?.exiting) {
            this.#removeTab(next.terminalId);
          }
        });
      }
    }
    applySessionsEvent(event) {
      if (this.#disposed) return;
      switch (event.kind) {
        case "snapshot": {
          this.#stream = "live";
          const serverIds = event.terminals.map((terminal) => terminal.terminalId);
          this.#ids = reconcileTerminalIds(this.#ids, serverIds);
          for (const terminal of event.terminals) this.#observeMeta(terminal);
          for (const id of this.#tabs.keys()) {
            if (!this.#ids.includes(id)) this.#tabs.delete(id);
          }
          this.#active = resolveActiveTerminalId(this.#ids, this.#active);
          break;
        }
        case "upsert":
          this.#observeMeta(event.terminal);
          break;
        case "remove":
          this.#removeTab(event.terminalId);
          return;
        case "closed":
          this.#stream = "closed";
          break;
      }
      this.#emit();
    }
    /**
     * A (re)subscription means the last snapshot may be stale — tabs stay
     * visible, but the stream is not authoritative until the next snapshot, so
     * openTerminal's allocation gate must wait for it. It also means the view
     * is alive: React replays effect cleanup in dev, and a tombstone from that
     * fake unmount would otherwise swallow every later sessions frame.
     */
    beginListStream() {
      this.#disposed = false;
      if (this.#stream === "connecting") return;
      this.#stream = "connecting";
      this.#emit();
    }
    markStreamDisconnected(message) {
      this.#stream = "closed";
      this.#panelError = message;
      this.#emit();
    }
    /** Open a fresh terminal; the client picks the id (#15). */
    async openTerminal() {
      const launch = this.#launch;
      if (!launch) {
        this.#panelError = "Terminal requires a workspace scope.";
        this.#emit();
        return null;
      }
      if (this.#stream !== "live") {
        this.#panelError = "Session list is still connecting.";
        this.#emit();
        return null;
      }
      const terminalId = nextTerminalId(this.allocatableTerminalIds);
      const tab = this.#tab(terminalId);
      tab.starting = true;
      tab.error = null;
      this.#ids = [...this.#ids.filter((id) => id !== terminalId), terminalId];
      this.#active = terminalId;
      this.#emit();
      try {
        const meta = await this.#control.open({
          terminalId,
          cwd: launch.cwd,
          worktreePath: launch.worktreePath,
          ...launch.cols !== void 0 ? { cols: launch.cols } : {},
          ...launch.rows !== void 0 ? { rows: launch.rows } : {},
          ...launch.env !== void 0 ? { env: launch.env } : {}
        });
        tab.starting = false;
        this.#observeMeta(meta);
        await this.#drain(terminalId);
      } catch (error) {
        tab.starting = false;
        tab.queue = [];
        tab.queueBytes = 0;
        tab.error = error instanceof Error ? error.message : "Terminal open failed";
        this.#emit();
      }
      return terminalId;
    }
    /** Attach a tracked id that has no live metadata (restore/edge). */
    async startSession(terminalId) {
      const launch = this.#launch;
      const tab = this.#tabs.get(terminalId);
      if (!tab || !launch || tab.starting) return;
      if (tab.meta !== null && tab.meta.status !== "exited" && tab.meta.status !== "error") return;
      tab.starting = true;
      tab.exiting = false;
      tab.exitBanner = null;
      tab.error = null;
      this.#emit();
      try {
        const meta = await this.#control.attach({
          terminalId,
          cwd: launch.cwd,
          worktreePath: launch.worktreePath,
          restartIfNotRunning: true,
          ...launch.cols !== void 0 ? { cols: launch.cols } : {},
          ...launch.rows !== void 0 ? { rows: launch.rows } : {},
          ...launch.env !== void 0 ? { env: launch.env } : {}
        });
        tab.starting = false;
        this.#observeMeta(meta);
        await this.#drain(terminalId);
      } catch (error) {
        tab.starting = false;
        tab.error = error instanceof Error ? error.message : "Terminal attach failed";
        this.#emit();
      }
    }
    /** Flush queued input and the pending fit-resize after a start resolves. */
    async #drain(terminalId) {
      const tab = this.#tabs.get(terminalId);
      if (!tab) return;
      const queued = tab.queue;
      tab.queue = [];
      tab.queueBytes = 0;
      for (const data of queued) {
        try {
          await this.#control.write({ terminalId, data });
        } catch (error) {
          tab.error = error instanceof Error ? error.message : "Terminal write failed";
          break;
        }
      }
      const pending = tab.resizePending;
      tab.resizePending = null;
      if (pending) await this.#sendResize(terminalId, pending);
      this.#emit();
    }
    /** Type into a terminal; input sent while the session starts is queued. */
    sendInput(terminalId, data) {
      const tab = this.#tabs.get(terminalId);
      if (!tab || data.length === 0 || this.#disposed) return;
      if (data.length > MAX_WRITE_DATA_LENGTH) {
        tab.error = "Input exceeds the 64 KiB write bound.";
        this.#emit();
        return;
      }
      if (tab.starting) {
        if (tab.queue.length >= MAX_QUEUED_INPUT_WRITES || tab.queueBytes + data.length > MAX_QUEUED_INPUT_BYTES) {
          tab.error = "Input dropped: the pending-input queue is full.";
        } else {
          tab.queue.push(data);
          tab.queueBytes += data.length;
        }
        this.#emit();
        return;
      }
      this.#control.write({ terminalId, data }).catch((error) => {
        tab.error = error instanceof Error ? error.message : "Terminal write failed";
        this.#emit();
      });
    }
    /** Latest-wins resize: a new fit while one is in flight replaces the pending one. */
    resize(terminalId, cols, rows) {
      const safeCols = clampDimension(cols, 1e3);
      const safeRows = clampDimension(rows, 500);
      if (safeCols === null || safeRows === null) return;
      const tab = this.#tabs.get(terminalId);
      if (!tab || this.#disposed) return;
      const next = { cols: safeCols, rows: safeRows };
      if (tab.resizeSent?.cols === next.cols && tab.resizeSent.rows === next.rows) return;
      if (tab.starting || tab.resizeInFlight !== null) {
        tab.resizePending = next;
        return;
      }
      void this.#sendResize(terminalId, next);
    }
    async #sendResize(terminalId, size) {
      const tab = this.#tabs.get(terminalId);
      if (!tab) return;
      tab.resizeInFlight = size;
      try {
        await this.#control.resize({ terminalId, cols: size.cols, rows: size.rows });
        tab.resizeSent = size;
      } catch (error) {
        tab.error = error instanceof Error ? error.message : "Terminal resize failed";
      } finally {
        tab.resizeInFlight = null;
        const pending = tab.resizePending;
        tab.resizePending = null;
        if (pending && !tab.starting) void this.#sendResize(terminalId, pending);
        this.#emit();
      }
    }
    requestAction(terminalId, action) {
      const tab = this.#tabs.get(terminalId);
      if (!tab || this.#disposed) return;
      tab.confirm = action;
      this.#emit();
    }
    cancelAction(terminalId) {
      const tab = this.#tabs.get(terminalId);
      if (!tab) return;
      tab.confirm = null;
      this.#emit();
    }
    /** Confirmed destructive action; close falls back to a plain `exit\n` write. */
    async confirmAction(terminalId) {
      const tab = this.#tabs.get(terminalId);
      const action = tab?.confirm;
      if (!tab || !action) return;
      tab.confirm = null;
      if (action === "close") {
        try {
          await this.#control.close({ terminalId, deleteHistory: true });
        } catch {
          try {
            await this.#control.write({ terminalId, data: "exit\n" });
          } catch {
          }
        }
        this.#removeTab(terminalId);
        return;
      }
      const launch = this.#launch;
      try {
        if (action === "clear") {
          await this.#control.clear({ terminalId });
        } else {
          if (!launch) throw new Error("Terminal requires a workspace scope.");
          tab.starting = true;
          this.#emit();
          const meta = await this.#control.restart({
            terminalId,
            cwd: launch.cwd,
            worktreePath: launch.worktreePath,
            cols: launch.cols ?? 80,
            rows: launch.rows ?? 24,
            ...launch.env !== void 0 ? { env: launch.env } : {}
          });
          tab.starting = false;
          tab.exiting = false;
          tab.exitBanner = null;
          this.#observeMeta(meta);
          await this.#drain(terminalId);
          return;
        }
      } catch (error) {
        tab.starting = false;
        tab.error = error instanceof Error ? error.message : "Terminal action failed";
      }
      this.#emit();
    }
    activate(terminalId) {
      if (!this.#ids.includes(terminalId)) return;
      this.#active = terminalId;
      this.#emit();
    }
    dispose() {
      this.#disposed = true;
    }
  };

  // extension.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.terminal";
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value;
    return Object.keys(value).every((key) => key === "terminalIds" || key === "activeTerminalId") && (candidate.terminalIds === void 0 || Array.isArray(candidate.terminalIds) && candidate.terminalIds.every((id) => typeof id === "string")) && (candidate.activeTerminalId === void 0 || typeof candidate.activeTerminalId === "string" || candidate.activeTerminalId === null);
  }
  function controlOps(host, session) {
    const api = bindApi(terminalControlApi, host, session.context);
    return {
      open: (input) => api.invoke("open", input, session.signal),
      attach: (input) => api.invoke("attach", input, session.signal),
      write: (input) => api.invoke("write", input, session.signal),
      resize: (input) => api.invoke("resize", input, session.signal),
      clear: (input) => api.invoke("clear", input, session.signal),
      restart: (input) => api.invoke("restart", input, session.signal),
      close: (input) => api.invoke("close", input, session.signal)
    };
  }
  function useSessionsStream(host, session, panel, visible) {
    (0, import_react.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
          panel.beginListStream();
          let closed = false;
          try {
            const stream = bindStreamApi(terminalSessionsApi, host, session.context).subscribe(
              "list",
              {},
              signal
            );
            for await (const frame of stream) {
              if (signal.aborted) return;
              panel.applySessionsEvent(frame.value);
              if (frame.value.kind === "closed") {
                closed = true;
                break;
              }
            }
          } catch (error) {
            if (!signal.aborted)
              panel.markStreamDisconnected(
                error instanceof Error ? error.message : "Session list unavailable"
              );
            return;
          }
          if (signal.aborted) return;
          if (!closed) {
            panel.markStreamDisconnected(null);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
        if (!signal.aborted) panel.markStreamDisconnected("Session list stream ended repeatedly.");
      })();
      return () => controller.abort();
    }, [host, session, panel, visible]);
  }
  function useTerminalOutput(host, session, terminalId, visible) {
    const [state, setState] = (0, import_react.useState)(null);
    const pendingRef = (0, import_react.useRef)(null);
    (0, import_react.useEffect)(() => {
      pendingRef.current = null;
      if (!visible || terminalId === null) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        let streak = EMPTY_OVERFLOW_STREAK;
        let overflowClose = false;
        while (!signal.aborted) {
          pendingRef.current = null;
          const stateRef = { current: EMPTY_OUTPUT_BUFFER };
          let resurrect = false;
          try {
            const stream = bindStreamApi(terminalOutputEventsApi, host, session.context).subscribe(
              "subscribe",
              { terminalId },
              signal
            );
            for await (const frame of stream) {
              if (signal.aborted) return;
              const value = frame.value;
              streak = noteOutputFrameForStreak(value, streak, Date.now());
              if (value.kind === "closed") {
                overflowClose = value.reason === "overflow";
                resurrect = isResumableOutputClose(value.reason, streak.attempts);
                if (!resurrect && !stateRef.current.ended) {
                  const applied2 = applyOutputEvent(
                    stateRef.current,
                    frame,
                    value,
                    pendingRef.current
                  );
                  pendingRef.current = applied2.pending;
                  stateRef.current = applied2.buffer;
                  setState({ terminalId, buffer: applied2.buffer });
                }
                break;
              }
              if (stateRef.current.ended) continue;
              const applied = applyOutputEvent(stateRef.current, frame, value, pendingRef.current);
              pendingRef.current = applied.pending;
              stateRef.current = applied.buffer;
              setState({ terminalId, buffer: applied.buffer });
            }
            if (!signal.aborted && !resurrect && pendingRef.current !== null) {
              stateRef.current = {
                ...EMPTY_OUTPUT_BUFFER,
                status: "error",
                statusText: "Output ended with an incomplete chunk group.",
                ended: true
              };
              setState({ terminalId, buffer: stateRef.current });
            }
          } catch (error) {
            if (!signal.aborted) {
              const buffer = {
                ...EMPTY_OUTPUT_BUFFER,
                status: "error",
                statusText: error instanceof Error ? error.message : "Terminal output unavailable",
                ended: true
              };
              setState({ terminalId, buffer });
            }
            return;
          }
          if (!resurrect) return;
          if (!signal.aborted) setState({ terminalId, buffer: EMPTY_OUTPUT_BUFFER });
          if (overflowClose && streak.attempts > 1 && !signal.aborted)
            await new Promise((resolve) => setTimeout(resolve, 300 * streak.attempts));
        }
      })();
      return () => controller.abort();
    }, [host, session, terminalId, visible]);
    return state?.terminalId === terminalId ? state.buffer : null;
  }
  function useFitResize(panel, terminalId, ref) {
    (0, import_react.useEffect)(() => {
      const element = ref.current;
      if (!element || terminalId === null || typeof ResizeObserver === "undefined") return;
      const fit = () => {
        const rect = element.getBoundingClientRect();
        const cols = Math.max(1, Math.floor(rect.width / 7.5));
        const rows = Math.max(1, Math.floor(rect.height / 16));
        panel.resize(terminalId, cols, rows);
      };
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(element);
      return () => observer.disconnect();
    }, [panel, terminalId, ref]);
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
  function TerminalView(props) {
    const { host, session } = props;
    const [, bump] = (0, import_react.useReducer)((value) => value + 1, 0);
    const [panel] = (0, import_react.useState)(() => {
      const restored = session.restoreState && typeof session.restoreState === "object" && !Array.isArray(session.restoreState) ? session.restoreState : null;
      const workspace = workspaceLaunchFromRevision(session.context.workspaceRevision);
      const launch = workspace === null ? null : {
        cwd: workspace.cwd,
        worktreePath: workspace.worktreePath,
        env: projectScriptRuntimeEnv({
          project: { cwd: workspace.workspaceRoot },
          worktreePath: workspace.worktreePath
        })
      };
      let panel2;
      panel2 = new TerminalPanel({
        control: controlOps(host, session),
        launch,
        restored,
        onChange: () => {
          const snapshot2 = panel2.snapshot;
          session.save({
            terminalIds: [...snapshot2.terminalIds],
            activeTerminalId: snapshot2.activeTerminalId
          });
          bump();
        }
      });
      return panel2;
    });
    const [visible, setVisible] = (0, import_react.useState)(session.visible);
    const [input, setInput] = (0, import_react.useState)("");
    const outputRef = (0, import_react.useRef)(null);
    (0, import_react.useEffect)(() => session.onVisibility(setVisible), [session]);
    (0, import_react.useEffect)(() => () => panel.dispose(), [panel]);
    useSessionsStream(host, session, panel, visible);
    const snapshot = panel.snapshot;
    const activeId = snapshot.activeTerminalId;
    const activeTab = snapshot.tabs.find((tab) => tab.terminalId === activeId) ?? null;
    const output = useTerminalOutput(host, session, activeId, visible);
    useFitResize(panel, activeId, outputRef);
    const send = () => {
      if (activeId === null || input.length === 0) return;
      panel.sendInput(activeId, input + "\r");
      setInput("");
    };
    const muted = "var(--muted-foreground, #667085)";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "section",
      {
        "aria-label": "Terminal",
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
                alignItems: "center"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    onClick: () => void panel.openTerminal(),
                    disabled: snapshot.stream !== "live",
                    style: control,
                    children: "New terminal"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, fontSize: 11 }, children: snapshot.stream === "closed" ? "Session list disconnected" : snapshot.stream === "connecting" ? "Connecting\u2026" : "" })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "ul",
            {
              "aria-label": "Terminal sessions",
              style: {
                listStyle: "none",
                margin: 0,
                padding: 6,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 2
              },
              children: snapshot.tabs.map((tab) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-current": tab.terminalId === activeId ? "true" : void 0,
                    onClick: () => panel.activate(tab.terminalId),
                    style: {
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      padding: "4px 6px",
                      border: "1px solid transparent",
                      borderRadius: 5,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "inherit",
                      background: tab.terminalId === activeId ? "var(--accent, #e8eef7)" : "transparent"
                    },
                    children: tab.label
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted, fontSize: 11 }, children: [
                  tab.status,
                  tab.hasRunningSubprocess ? " \xB7 running" : "",
                  tab.queuedInputCount > 0 ? ` \xB7 queued ${tab.queuedInputCount}` : ""
                ] }),
                tab.confirmAction === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  (tab.status === "exited" || tab.status === "error" || tab.status === "closed") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Start ${tab.terminalId}`,
                      onClick: () => void panel.startSession(tab.terminalId),
                      style: control,
                      children: "Start"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Clear ${tab.terminalId}`,
                      onClick: () => panel.requestAction(tab.terminalId, "clear"),
                      style: control,
                      children: "Clear"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Restart ${tab.terminalId}`,
                      onClick: () => panel.requestAction(tab.terminalId, "restart"),
                      style: control,
                      children: "Restart"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Close ${tab.terminalId}`,
                      onClick: () => panel.requestAction(tab.terminalId, "close"),
                      style: control,
                      children: "\xD7"
                    }
                  )
                ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, fontSize: 11 }, children: tab.confirmAction === "close" ? "Close this terminal?" : tab.confirmAction === "restart" ? "Restart this terminal?" : "Clear history?" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Confirm ${tab.confirmAction} ${tab.terminalId}`,
                      onClick: () => void panel.confirmAction(tab.terminalId),
                      style: control,
                      children: "Confirm"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      "aria-label": `Cancel ${tab.confirmAction} ${tab.terminalId}`,
                      onClick: () => panel.cancelAction(tab.terminalId),
                      style: control,
                      children: "Cancel"
                    }
                  )
                ] })
              ] }, tab.terminalId))
            }
          ),
          snapshot.tabs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "No terminals yet. New terminal opens a shell in this workspace." }),
          snapshot.panelError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "output",
            {
              "aria-label": "Panel status",
              style: { padding: "4px 10px", color: muted, fontSize: 11 },
              children: snapshot.panelError
            }
          ),
          activeId !== null && activeTab !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                borderTop: "1px solid var(--border, #dfe3e8)"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "output",
                  {
                    "aria-label": "Output status",
                    style: { padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 },
                    children: [
                      activeId,
                      ": ",
                      activeTab.exitBanner ?? output?.statusText ?? "Connecting\u2026",
                      activeTab.error ? ` \u2014 ${activeTab.error}` : ""
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "pre",
                  {
                    ref: outputRef,
                    "aria-label": "Terminal output",
                    style: {
                      flex: 1,
                      minHeight: 0,
                      margin: 0,
                      padding: 12,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      color: "var(--terminal-foreground, inherit)",
                      background: "var(--terminal-background, transparent)",
                      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
                      fontSize: 12
                    },
                    children: output?.contents ?? ""
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: 6,
                      padding: 8,
                      borderTop: "1px solid var(--border, #dfe3e8)",
                      flexShrink: 0
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          "aria-label": "Terminal input",
                          placeholder: activeTab.starting ? "Starting\u2026 input is queued" : "Type a command",
                          value: input,
                          onChange: (event) => setInput(event.target.value),
                          onKeyDown: (event) => {
                            if (event.key === "Enter") send();
                          },
                          style: { ...control, flex: 1, minWidth: 0, cursor: "text" }
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: send, style: control, children: "Send" })
                    ]
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "output",
            {
              "aria-label": "Slice notice",
              style: { padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 },
              children: "Interactive text terminal: input, resize, and lifecycle through the public control contract. VT rendering (Ghostty) and notifications are deferred slices."
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
      requireApi(terminalSessionsApi),
      requireApi(terminalOutputApi),
      requireApi(terminalOutputEventsApi),
      requireApi(terminalControlApi)
    ],
    surfaces: [
      {
        name: "view",
        title: "Terminal",
        scope: "thread",
        placements: ["side-panel", "bottom-dock"],
        clients: ["web", "desktop"],
        capabilities: [],
        stateVersion: 1,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TerminalView, { host, session }) };
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
