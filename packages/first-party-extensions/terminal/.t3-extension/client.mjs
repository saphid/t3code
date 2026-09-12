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
  var terminalSessionsApi = defineApi({
    id: TERMINAL_SESSIONS,
    version: "1.0.0",
    methods: [
      {
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
          type: ["object", "null"],
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
        }
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
  var GENERIC_API_CATALOGUE = [
    workspaceFilesApi.definition,
    workspaceTreeApi.definition,
    workspaceSearchApi.definition,
    textEditsApi.definition,
    textEditsApiV1.definition,
    filePresentationApi.definition,
    terminalSessionsApi.definition,
    terminalOutputApi.definition,
    terminalOutputEventsApi.definition
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
  var TERMINAL_OUTPUT_API = terminalOutputApi.definition;
  var TERMINAL_OUTPUT_EVENTS_API = terminalOutputEventsApi.definition;

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
  var TERMINAL_BUFFER_MAX_BYTES = 512 * 1024;
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
  function fallbackTerminalLabel(terminalId) {
    const match = /^term-(\d+)$/.exec(terminalId);
    return match ? `Terminal ${match[1]}` : "Terminal";
  }
  function describeSession(result) {
    if (result === null) return null;
    return {
      terminalId: result.terminalId,
      label: result.label || fallbackTerminalLabel(result.terminalId),
      status: result.status,
      hasRunningSubprocess: result.hasRunningSubprocess,
      exitCode: result.exitCode,
      updatedAt: result.updatedAt
    };
  }
  function missingSessionRow(terminalId) {
    return {
      terminalId,
      label: fallbackTerminalLabel(terminalId),
      status: "closed",
      hasRunningSubprocess: false,
      exitCode: null,
      updatedAt: null
    };
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
  function addTerminalId(ids, terminalId) {
    const id = terminalId.trim();
    if (id.length === 0 || id.length > 128) return [...ids];
    return ids.includes(id) ? [...ids] : [...ids, id];
  }
  function removeTerminalId(ids, terminalId) {
    return ids.filter((id) => id !== terminalId);
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

  // extension.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.terminal";
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value;
    return Object.keys(value).every((key) => key === "terminalIds" || key === "activeTerminalId") && (candidate.terminalIds === void 0 || Array.isArray(candidate.terminalIds) && candidate.terminalIds.every((id) => typeof id === "string")) && (candidate.activeTerminalId === void 0 || typeof candidate.activeTerminalId === "string" || candidate.activeTerminalId === null);
  }
  function useSessionRows(host, session, terminalIds, visible, refreshRevision) {
    const [rows, setRows] = (0, import_react.useState)(null);
    const key = JSON.stringify([terminalIds, refreshRevision]);
    (0, import_react.useEffect)(() => {
      if (!visible || terminalIds.length === 0) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void (async () => {
        const api = bindApi(terminalSessionsApi, host, session.context);
        try {
          const sessions = await Promise.all(
            terminalIds.map(async (terminalId) => {
              const result = await api.invoke("inspect", { terminalId }, signal);
              return describeSession(result) ?? missingSessionRow(terminalId);
            })
          );
          if (!signal.aborted) setRows({ key, sessions, error: null });
        } catch (error) {
          if (!signal.aborted)
            setRows({
              key,
              sessions: terminalIds.map(missingSessionRow),
              error: error instanceof Error ? error.message : "Terminal status unavailable"
            });
        }
      })();
      return () => controller.abort();
    }, [host, session, visible, key, terminalIds]);
    return rows?.key === key ? rows : null;
  }
  function useTerminalOutput(host, session, terminalId, visible) {
    const [state, setState] = (0, import_react.useState)(null);
    const pendingRef = (0, import_react.useRef)(null);
    (0, import_react.useEffect)(() => {
      pendingRef.current = null;
      if (!visible || terminalId === null) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const stateRef = { current: EMPTY_OUTPUT_BUFFER };
      void (async () => {
        try {
          const stream = bindStreamApi(terminalOutputEventsApi, host, session.context).subscribe(
            "subscribe",
            { terminalId },
            signal
          );
          for await (const frame of stream) {
            if (signal.aborted) return;
            const applied = applyOutputEvent(
              stateRef.current,
              frame,
              frame.value,
              pendingRef.current
            );
            pendingRef.current = applied.pending;
            stateRef.current = applied.buffer;
            setState({ terminalId, buffer: applied.buffer });
            if (applied.buffer.ended) return;
          }
          if (!signal.aborted && pendingRef.current !== null) {
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
            stateRef.current = buffer;
            setState({ terminalId, buffer });
          }
        }
      })();
      return () => controller.abort();
    }, [host, session, terminalId, visible]);
    return state?.terminalId === terminalId ? state.buffer : null;
  }
  function TerminalView(props) {
    const { host, session } = props;
    const restored = session.restoreState && typeof session.restoreState === "object" && !Array.isArray(session.restoreState) ? session.restoreState : null;
    const [terminalIds, setTerminalIds] = (0, import_react.useState)(
      () => normalizeTerminalIds(restored?.terminalIds ?? [])
    );
    const [activeTerminalId, setActiveTerminalId] = (0, import_react.useState)(
      restored?.activeTerminalId ?? null
    );
    const [newTerminalId, setNewTerminalId] = (0, import_react.useState)("");
    const [visible, setVisible] = (0, import_react.useState)(session.visible);
    const [refreshRevision, setRefreshRevision] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => session.onVisibility(setVisible), [session]);
    const resolvedActiveId = resolveActiveTerminalId(terminalIds, activeTerminalId);
    const sessionRows = useSessionRows(host, session, terminalIds, visible, refreshRevision);
    const output = useTerminalOutput(host, session, resolvedActiveId, visible);
    const persist = (ids, active) => {
      session.save({ terminalIds: [...ids], activeTerminalId: active });
    };
    const trackTerminal = () => {
      const id = newTerminalId.trim();
      if (!id) return;
      const ids = addTerminalId(terminalIds, id);
      setTerminalIds(ids);
      setActiveTerminalId(id);
      setNewTerminalId("");
      persist(ids, id);
    };
    const untrackTerminal = (terminalId) => {
      const ids = removeTerminalId(terminalIds, terminalId);
      const active = resolveActiveTerminalId(ids, activeTerminalId);
      setTerminalIds(ids);
      setActiveTerminalId(active);
      persist(ids, active);
    };
    const activate = (terminalId) => {
      setActiveTerminalId(terminalId);
      persist(terminalIds, terminalId);
    };
    const muted = "var(--muted-foreground, #667085)";
    const control = {
      padding: "4px 8px",
      border: "1px solid var(--border, #dfe3e8)",
      borderRadius: 5,
      background: "transparent",
      color: "inherit",
      font: "inherit",
      fontSize: 12
    };
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
                flexShrink: 0
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    "aria-label": "Terminal ID",
                    placeholder: "term-1",
                    value: newTerminalId,
                    onChange: (event) => setNewTerminalId(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === "Enter") trackTerminal();
                    },
                    style: { ...control, flex: 1, minWidth: 0 }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: trackTerminal, style: control, children: "Attach" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    onClick: () => setRefreshRevision((value) => value + 1),
                    style: control,
                    children: "Refresh"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "ul",
            {
              "aria-label": "Terminal sessions",
              style: { listStyle: "none", margin: 0, padding: 6, flexShrink: 0 },
              children: (sessionRows?.sessions ?? terminalIds.map(missingSessionRow)).map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-current": row.terminalId === resolvedActiveId ? "true" : void 0,
                    onClick: () => activate(row.terminalId),
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
                      background: row.terminalId === resolvedActiveId ? "var(--accent, #e8eef7)" : "transparent"
                    },
                    children: row.label
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: muted, fontSize: 11 }, children: [
                  row.status,
                  row.hasRunningSubprocess ? " \xB7 running" : ""
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": `Detach ${row.terminalId}`,
                    onClick: () => untrackTerminal(row.terminalId),
                    style: control,
                    children: "\xD7"
                  }
                )
              ] }, row.terminalId))
            }
          ),
          terminalIds.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "No terminals tracked. Enter the id of a terminal already open in this thread." }),
          sessionRows?.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "output",
            {
              "aria-label": "Session status",
              style: { padding: "4px 10px", color: muted, fontSize: 11 },
              children: sessionRows.error
            }
          ),
          resolvedActiveId !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                      resolvedActiveId,
                      ": ",
                      output?.statusText ?? "Connecting\u2026"
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "pre",
                  {
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
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "output",
            {
              "aria-label": "Slice notice",
              style: { padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 },
              children: "Read-only skeleton: attaches to existing sessions and renders live output text. No input, spawn, or VT rendering yet."
            }
          )
        ]
      }
    );
  }
  var extension_default = defineExtension({
    id: manifestId,
    version: "0.1.0",
    requires: [
      requireApi(terminalSessionsApi),
      requireApi(terminalOutputApi),
      requireApi(terminalOutputEventsApi)
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
