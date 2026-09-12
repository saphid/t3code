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
    vcsDiffApiV1.definition
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
  function planCommit(lanes, message) {
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
    if (message.trim().length === 0) {
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

  // extension.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.version-control";
  var LANES = new Set(CHANGE_LANES);
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value;
    return Object.keys(record).every((key) => key === "selectedPath" || key === "selectedLane") && (record.selectedPath === void 0 || typeof record.selectedPath === "string") && (record.selectedLane === void 0 || typeof record.selectedLane === "string" && LANES.has(record.selectedLane));
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
  function useStatusStream(host, session, visible, tick) {
    const [model, setModel] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
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
    const [result, setResult] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
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
    const [result, setResult] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
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
  var muted = "var(--muted-foreground, #667085)";
  function VersionControlView(props) {
    const { host, session } = props;
    const [visible, setVisible] = (0, import_react.useState)(session.visible);
    const [tick, setTick] = (0, import_react.useState)(0);
    const [refreshError, setRefreshError] = (0, import_react.useState)(null);
    const [mutation, setMutation] = (0, import_react.useState)(IDLE_MUTATION);
    const [mutationSerial, setMutationSerial] = (0, import_react.useState)(0);
    const [commitMessage, setCommitMessage] = (0, import_react.useState)("");
    const [newRefName, setNewRefName] = (0, import_react.useState)("");
    const inFlight = (0, import_react.useRef)(false);
    (0, import_react.useEffect)(() => session.onVisibility(setVisible), [session]);
    const restored = session.restoreState && typeof session.restoreState === "object" && !Array.isArray(session.restoreState) ? session.restoreState : null;
    const [selection, setSelection] = (0, import_react.useState)(
      () => restored?.selectedPath && restored.selectedLane && LANES.has(restored.selectedLane) ? { path: restored.selectedPath, lane: restored.selectedLane } : null
    );
    const { capabilities, error: capsError } = useCapabilities(host, session, visible, tick);
    const repo = repositoryState(capabilities, capsError);
    const status = useStatusStream(host, session, visible && repo.kind === "ready", tick);
    const isRepo = status.local?.isRepo === true;
    const listRevision = status.localRevision === 0 ? "" : `${status.localRevision}:${mutationSerial}`;
    const changes = useChangesList(host, session, visible, isRepo, listRevision);
    const refs = useRefsList(host, session, visible, isRepo, listRevision);
    const lanes = (0, import_react.useMemo)(() => lanesFromChanges(changes.changes?.entries ?? []), [changes.changes]);
    const selected = retainSelection(selection, lanes);
    const selectedEntry = selected === null ? null : lanes[selected.lane].find((e) => e.path === selected.path) ?? null;
    const selectedStat = selected === null ? null : numstatFor(status.local, selected.path);
    const rows = (0, import_react.useMemo)(() => refRows(refs.refs), [refs.refs]);
    const ops = repo.kind === "ready" ? repo.capabilities.operations : null;
    const canStage = ops?.["changes.stage"] === true;
    const canUnstage = ops?.["changes.unstage"] === true;
    const canCommit = ops?.["changes.commit"] === true;
    const canCreateRef = ops?.["refs.create"] === true;
    const canSwitchRef = ops?.["refs.switch"] === true;
    const busy = mutation.kind === "running";
    const commit = planCommit(lanes, commitMessage);
    const create = planRefCreate(newRefName, rows);
    const currentBranch = rows.find((row) => row.current && row.remote === null)?.name ?? null;
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
      const message = commitMessage.trim();
      runMutation(
        "commit",
        "Committing",
        (signal) => bindApi(vcsChangesApi, host, session.context).invoke(
          "commit",
          plan.paths === void 0 ? { message } : { message, paths: [...plan.paths] },
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
      session.save({ selectedPath: path3, selectedLane: lane });
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                repo.kind === "ready" && repo.capabilities.operations["status.refresh"] === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: refresh, style: control, children: "Refresh" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, fontSize: 11 }, children: refreshError ?? describeStatus(status) })
              ]
            }
          ),
          repo.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "Reading repository capabilities\u2026" }),
          repo.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "Repository status unavailable \u2014 ",
            repo.detail
          ] }),
          repo.kind === "no-repository" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "This workspace is not a repository",
            repo.detail ? ` \u2014 ${repo.detail}` : "",
            ". Repository init and clone controls remain a deferred slice."
          ] }),
          repo.kind === "unsupported" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "note", style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: [
            "Unsupported repository driver: ",
            repo.driverKind,
            ". ",
            repo.detail
          ] }),
          repo.kind === "ready" && isRepo && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minHeight: 0, overflow: "auto", padding: 6 }, children: [
            describeMutation(mutation) !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "output",
              {
                "aria-label": "Mutation status",
                role: mutation.kind === "failed" ? "alert" : "status",
                style: {
                  display: "block",
                  padding: "4px 6px",
                  color: mutation.kind === "failed" ? "var(--destructive, #b42318)" : muted,
                  fontSize: 11
                },
                children: describeMutation(mutation)
              }
            ),
            changes.error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "output",
              {
                "aria-label": "Changes status",
                style: { display: "block", padding: "4px 6px", color: muted, fontSize: 11 },
                children: changes.error
              }
            ),
            changes.changes !== null && laneCount(lanes) === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "4px 6px", color: muted, fontSize: 12, margin: 0 }, children: "Working tree clean \u2014 nothing staged, modified, or untracked." }),
            CHANGE_LANES.map((lane) => {
              const bulk = laneMutation(lane);
              const rowAction = entryMutation(lane);
              const bulkAllowed = bulk !== null && (bulk.op === "stage" ? canStage : canUnstage);
              const rowAllowed = rowAction !== null && (rowAction.op === "stage" ? canStage : canUnstage);
              return lanes[lane].length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": laneTitle(lane), style: { marginBottom: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "h3",
                  {
                    style: {
                      margin: 0,
                      padding: "2px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: muted,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                        laneTitle(lane),
                        " (",
                        lanes[lane].length,
                        ")"
                      ] }),
                      bulkAllowed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runPaths(
                            bulk.op,
                            lanes[lane].map((entry) => entry.path),
                            `${bulk.op === "stage" ? "Staging" : "Unstaging"} ${lanes[lane].length} paths`
                          ),
                          style: { ...control, padding: "1px 6px", fontSize: 11 },
                          children: bulk.label
                        }
                      )
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: lanes[lane].map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted }, children: [
                          " \u2014 ",
                          describeEntry(entry)
                        ] })
                      ]
                    }
                  ),
                  rowAllowed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      disabled: busy,
                      onClick: () => runPaths(
                        rowAction.op,
                        [entry.path],
                        `${rowAction.op === "stage" ? "Staging" : "Unstaging"} ${entry.path}`
                      ),
                      style: { ...control, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                      children: rowAction.label
                    }
                  )
                ] }, entry.path)) })
              ] }, lane);
            }),
            canCommit && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Commit", style: { marginTop: 4, marginBottom: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "h3",
                {
                  style: {
                    margin: 0,
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: muted,
                    textTransform: "uppercase",
                    letterSpacing: 0.4
                  },
                  children: "Commit"
                }
              ),
              status.local?.isDefaultRef === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    disabled: busy || commit.disabled !== null,
                    onClick: runCommit,
                    style: control,
                    children: commit.label
                  }
                ),
                commit.disabled !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, fontSize: 11 }, children: commit.disabled })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Refs", style: { marginTop: 4 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "h3",
                {
                  style: {
                    margin: 0,
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: muted,
                    textTransform: "uppercase",
                    letterSpacing: 0.4
                  },
                  children: [
                    "Refs",
                    refs.refs ? ` (${refs.refs.totalCount})` : ""
                  ]
                }
              ),
              canCreateRef && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px 4px"
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        disabled: busy || create.refName === null,
                        onClick: runCreateRef,
                        style: { ...control, padding: "2px 6px", fontSize: 11, flexShrink: 0 },
                        children: "Create & switch"
                      }
                    )
                  ]
                }
              ),
              canCreateRef && create.disabled !== null && newRefName.trim() !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "output",
                {
                  "aria-label": "Branch create status",
                  style: { display: "block", padding: "0 6px 4px", color: muted, fontSize: 11 },
                  children: create.disabled
                }
              ),
              refs.error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "output",
                {
                  "aria-label": "Refs status",
                  style: { display: "block", padding: "4px 6px", color: muted, fontSize: 11 },
                  children: refs.error
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0 }, children: rows.map((row) => {
                const switchState = refSwitchState(row, currentBranch);
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                            describeRef(row) !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted }, children: [
                              " \u2014 ",
                              describeRef(row)
                            ] })
                          ]
                        }
                      ),
                      canSwitchRef && !row.current && !switchState.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: muted, fontSize: 11, flexShrink: 0 }, children: switchState.reason }),
                      canSwitchRef && switchState.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => runSwitchRef(refSwitchTarget(row)),
                          style: { ...control, padding: "1px 6px", fontSize: 11, flexShrink: 0 },
                          children: "Switch"
                        }
                      )
                    ]
                  },
                  `${row.remote ?? ""}:${row.name}`
                );
              }) })
            ] })
          ] }),
          selected !== null && selectedEntry !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "output",
            {
              "aria-label": "Selection",
              style: {
                padding: "6px 10px",
                color: muted,
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
          ),
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
              children: "Version Control on t3.vcs: status, staging lanes, stage/unstage/commit, and branch create/switch (t3.vcs/mutate). Pull/init/worktrees, pull requests, and diff rendering are deferred slices."
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
      requireApi(vcsStatusApi),
      requireApi(vcsChangesApi),
      requireApi(vcsRefsApi),
      requireApi(vcsRepositoryApi)
    ],
    surfaces: [
      {
        name: "view",
        title: "Version Control",
        scope: "project",
        placements: ["side-panel"],
        clients: ["web", "desktop"],
        capabilities: [],
        stateVersion: 1,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VersionControlView, { host, session }) };
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
