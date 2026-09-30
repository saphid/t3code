export default function (__t3Host) {
"use strict";
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
  var __export = (target, all2) => {
    for (var name in all2)
      __defProp(target, name, { get: all2[name], enumerable: true });
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
      "use strict";
      module.exports = __t3Host.React;
    }
  });

  // host-react:react/jsx-runtime
  var require_jsx_runtime = __commonJS({
    "host-react:react/jsx-runtime"(exports) {
      "use strict";
      var R = __t3Host.React;
      exports.Fragment = R.Fragment;
      var mark = (n) => {
        if (n && typeof n === "object" && n._store) n._store.validated = 1;
      };
      var el = (type, props, key, isStatic) => {
        const c = props == null ? void 0 : props.children;
        if (Array.isArray(c)) {
          if (isStatic) {
            for (const x of c) mark(x);
            Object.freeze(c);
          }
        } else mark(c);
        return R.createElement(type, key === void 0 ? props : { ...props, key });
      };
      exports.jsx = (t, p, k) => el(t, p, k, false);
      exports.jsxs = (t, p, k) => el(t, p, k, true);
      exports.jsxDEV = (t, p, k, s) => el(t, p, k, s === true);
    }
  });

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
  function validateContext(value) {
    const context2 = copyJson(value);
    assertId(context2.resource.namespace);
    for (const part of [context2.resource.id, context2.resource.environmentId, context2.client])
      if (typeof part !== "string" || !part || part.length > 1024)
        throw new Error("Invalid context identity");
    for (const part of [
      context2.resource.projectId,
      context2.resource.threadId,
      context2.workspaceRevision
    ])
      if (part !== void 0 && (typeof part !== "string" || !part || part.length > 1024))
        throw new Error("Invalid optional context identity");
    if (context2.resource.threadId && !context2.resource.projectId)
      throw new Error("Thread requires project scope");
    return context2;
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
        if (typeof descriptor.title !== "string" || !descriptor.title.trim() || descriptor.title.length > 200 || !Array.isArray(descriptor.clients) || !descriptor.clients.length || descriptor.clients.some((client2) => typeof client2 !== "string" || !client2 || client2.length > 100))
          throw new Error("Invalid text contribution metadata");
      }
    }
    return manifest;
  }

  // node_modules/@t3tools/extension-sdk/dist/semver.js
  var TRIPLE = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
  var VERSION = new RegExp(`^${TRIPLE}$`);
  var RANGE = new RegExp(`^(?:\\^|~|>=)?${TRIPLE}$`);
  var BOUNDED = new RegExp(`^>=${TRIPLE} <${TRIPLE}$`);
  function toVersion(parts) {
    const [major, minor, patch] = parts.map(Number);
    return [major, minor, patch].every(Number.isSafeInteger) ? [major, minor, patch] : null;
  }
  function parseVersion(text) {
    const match4 = VERSION.exec(text);
    return match4 ? toVersion(match4.slice(1, 4)) : null;
  }
  function compareVersions(a, b) {
    return Math.sign(a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  }
  function rangeFloor(range) {
    const match4 = RANGE.exec(range);
    if (match4)
      return toVersion(match4.slice(1, 4));
    const bounded = BOUNDED.exec(range);
    if (!bounded)
      return null;
    const floor = toVersion(bounded.slice(1, 4));
    const ceiling = toVersion(bounded.slice(4, 7));
    return floor && ceiling && compareVersions(floor, ceiling) < 0 ? floor : null;
  }

  // node_modules/@t3tools/extension-sdk/dist/capabilities.js
  var RESUMABLE_API_STREAMS = {
    "t3.terminal/output-events#subscribe": 1,
    "t3.terminal/sessions#list": 2,
    "t3.workspace/changes#subscribeChanges": 3,
    "t3.browser/sessions#events": 4
  };
  function resolveResumableStreams(host, stream) {
    const member = host.resumableStreams;
    if (!member || typeof member !== "object")
      return null;
    const required = stream === void 0 ? 1 : Object.hasOwn(RESUMABLE_API_STREAMS, stream) ? RESUMABLE_API_STREAMS[stream] : Infinity;
    const { version: version2, subscribeApi } = member;
    return typeof version2 === "number" && version2 >= required && typeof subscribeApi === "function" ? member : null;
  }
  var ApiVersionError = class extends Error {
    name = "ApiVersionError";
    code = "api-version-not-negotiated";
  };
  function hasInput(value, path3) {
    if (path3.length === 0)
      return value !== void 0;
    if (value === null || typeof value !== "object")
      return false;
    const [head2, ...rest] = path3;
    const key = head2.endsWith("[]") ? head2.slice(0, -2) : head2;
    const child = value[key];
    if (!head2.endsWith("[]"))
      return hasInput(child, rest);
    return Array.isArray(child) && child.some((item) => hasInput(item, rest));
  }
  function negotiated(definition, options) {
    if (options.baseline === void 0) {
      if (options.additions?.length)
        throw new Error("API additions need a baseline");
      return {};
    }
    const version2 = parseVersion(definition.version);
    if (!version2)
      throw new Error("An API with a baseline needs a plain X.Y.Z version: " + definition.version);
    const baseline = parseVersion(options.baseline);
    if (!baseline || baseline[0] !== version2[0] || compareVersions(baseline, version2) > 0)
      throw new Error("API baseline must be an earlier plain X.Y.Z version of the same major");
    const additions = (options.additions ?? []).map((addition) => ({ ...addition }));
    if (compareVersions(baseline, version2) < 0 && additions.length === 0)
      throw new Error("An API baseline below the current version must list its additions");
    for (const addition of additions) {
      const added = parseVersion(addition.version);
      if (!added)
        throw new Error("An API addition needs a plain X.Y.Z version: " + JSON.stringify(addition));
      const path3 = "input" in addition ? addition.input : "output" in addition ? addition.output : void 0;
      const owners = "stream" in addition ? [] : [
        ...definition.methods ?? [],
        ..."output" in addition ? definition.streams ?? [] : []
      ];
      if (compareVersions(added, baseline) <= 0 || compareVersions(added, version2) > 0 || ("stream" in addition ? !definition.streams?.some((stream) => stream.name === addition.stream) : !owners.some((owner) => owner.name === addition.method)) || "output" in addition && typeof path3 !== "string" || path3 !== void 0 && (typeof path3 !== "string" || !/^[A-Za-z_$][\w$]*(\[\])?(\.[A-Za-z_$][\w$]*(\[\])?)*$/.test(path3)))
        throw new Error("Invalid API addition: " + JSON.stringify(addition));
    }
    return { baseline: options.baseline, additions };
  }
  function defineApi(definition, options = {}) {
    const validated = validateApiDefinition(definition);
    return { definition: validated, ...negotiated(validated, options) };
  }
  function unnegotiatedAdditions(api, versionRange) {
    const floor = rangeFloor(versionRange);
    return (api.additions ?? []).filter((addition) => {
      if ("output" in addition)
        return false;
      const added = parseVersion(addition.version);
      return !floor || !added || compareVersions(floor, added) < 0;
    });
  }
  function defaultVersionRange(api) {
    return "^" + (api.baseline ?? api.definition.version);
  }
  function bindApi(api, client2, context2, versionRange = defaultVersionRange(api)) {
    const unnegotiated = unnegotiatedAdditions(api, versionRange);
    return {
      invoke(method, input, signal) {
        const addition = unnegotiated.find((item) => "method" in item && item.method === method && (item.input === void 0 || hasInput(input, item.input.split("."))));
        if (addition)
          return Promise.reject(new ApiVersionError(`${api.definition.id}#${method}${addition.input === void 0 ? "" : " " + addition.input} needs ^${addition.version}, but this binding asks for ${versionRange}; probe the host version, then bind at ^${addition.version}`));
        return client2.invokeApi({ id: api.definition.id, versionRange, method, input, context: context2 }, signal);
      }
    };
  }
  function defineStreamApi(definition, options = {}) {
    const validated = validateApiDefinition(definition);
    if (!validated.streams?.length)
      throw new Error("Expected API stream definitions");
    return { definition: validated, ...negotiated(validated, options) };
  }
  function bindStreamApi(api, client2, context2, versionRange = defaultVersionRange(api)) {
    const unnegotiated = unnegotiatedAdditions(api, versionRange);
    return {
      subscribe(name, input, signal, options) {
        const addition = unnegotiated.find((item) => "stream" in item && item.stream === name);
        if (addition)
          throw new ApiVersionError(`${api.definition.id} stream ${name} needs ^${addition.version}, but this binding asks for ${versionRange}; probe the host version, then bind at ^${addition.version}`);
        let subscribeApi = client2.subscribeApi.bind(client2);
        if (options?.resume === "fresh-snapshot") {
          const resumable = resolveResumableStreams(client2);
          if (!resumable) {
            const error = new ApiVersionError(`${api.definition.id}#${name} asked for host stream resumption, which this host does not offer`);
            return {
              [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) })
            };
          }
          const onSuspended = options.onSuspended;
          subscribeApi = onSuspended ? (request, signal2) => resumable.subscribeApi(request, signal2, { onSuspended }) : resumable.subscribeApi.bind(resumable);
        }
        return subscribeApi({
          id: api.definition.id,
          versionRange,
          name,
          input,
          context: context2,
          ...options?.cursor === void 0 ? {} : { cursor: options.cursor },
          ...options?.expectedGeneration === void 0 ? {} : { expectedGeneration: options.expectedGeneration }
        }, signal);
      }
    };
  }
  function grantDenialMessage(grant) {
    return `Needs permission ${grant}. Grant it in Settings \u2192 Extensions.`;
  }
  var CAPABILITY_DENIED = /capability denied: ([\w.\-/]*[\w\-/])/;
  function describeGrantDenial(error) {
    const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const grant = CAPABILITY_DENIED.exec(text)?.[1];
    return grant ? { grant, message: grantDenialMessage(grant) } : null;
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
  var ORCHESTRATION_LAUNCH_WORKFLOW = "t3.orchestration/launch-workflow";
  var WORKFLOW_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
  var ORCHESTRATION_LOGS = "t3.orchestration/logs";
  var ORCHESTRATION_READ_LOGS = "t3.orchestration/read-logs";
  var AGENT_LOG_TAIL_MAX_BYTES = 8192;
  var AGENT_LOG_TAIL_MAX_LINES = 1e3;
  var AGENT_LOG_TITLE_MAX_LENGTH = 200;
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
  var logSource = { enum: ["output"] };
  var orchestrationLogsApi = defineApi({
    id: ORCHESTRATION_LOGS,
    version: "1.0.0",
    methods: [
      {
        name: "listRuns",
        effect: "read",
        requiredGrants: [ORCHESTRATION_READ_LOGS],
        inputSchema: empty,
        outputSchema: obj({
          runs: arr(obj({
            runId: id,
            kind: agentProps.kind,
            title: { type: "string", maxLength: AGENT_LOG_TITLE_MAX_LENGTH },
            status: agentProps.status,
            sources: { type: "array", items: logSource, minItems: 1, maxItems: 1 }
          })),
          truncated: bool
        })
      },
      {
        name: "readTail",
        effect: "read",
        requiredGrants: [ORCHESTRATION_READ_LOGS],
        inputSchema: obj({
          runId: id,
          source: logSource,
          maxBytes: { type: "integer", minimum: 1, maximum: AGENT_LOG_TAIL_MAX_BYTES },
          maxLines: { type: "integer", minimum: 1, maximum: AGENT_LOG_TAIL_MAX_LINES }
        }, ["runId", "source"]),
        outputSchema: obj({
          runId: id,
          source: logSource,
          contents: { type: "string", maxLength: AGENT_LOG_TAIL_MAX_BYTES },
          byteLength: num,
          truncated: bool
        })
      }
    ]
  });
  var ORCHESTRATION_LOGS_API = orchestrationLogsApi.definition;

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

  // node_modules/@t3tools/extension-sdk/dist/agentSessions.js
  var AGENT_SESSIONS_API = "t3.agents/sessions";
  var AGENT_SESSIONS_SCAN = "t3.agents/scan-sessions";
  var AGENT_SESSIONS_IMPORT = "t3.agents/import-sessions";
  var AGENT_SESSIONS_SCAN_CAP = 50;
  var providerInstanceIdSchema = {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$"
  };
  var providerSessionIdSchema = {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  };
  var threadIdSchema = { type: ["string", "null"], maxLength: 256 };
  var agentSessionsApi = defineApi({
    id: AGENT_SESSIONS_API,
    version: "1.0.0",
    methods: [
      {
        name: "scan",
        effect: "read",
        requiredGrants: [AGENT_SESSIONS_SCAN],
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["scope", "sessions", "truncated", "skipped", "scannedAt"],
          properties: {
            scope: { const: "project" },
            truncated: { type: "boolean" },
            skipped: { type: "integer", minimum: 0 },
            scannedAt: { type: "string", minLength: 1, maxLength: 40 },
            sessions: {
              type: "array",
              maxItems: AGENT_SESSIONS_SCAN_CAP,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "providerInstanceId",
                  "providerSessionId",
                  "source",
                  "lastActiveAt",
                  "status",
                  "threadId"
                ],
                properties: {
                  providerInstanceId: providerInstanceIdSchema,
                  providerSessionId: providerSessionIdSchema,
                  source: { enum: ["claudeAgent", "codex"] },
                  lastActiveAt: { type: "string", minLength: 1, maxLength: 40 },
                  status: { enum: ["importable", "imported"] },
                  threadId: threadIdSchema
                }
              }
            }
          }
        }
      },
      {
        name: "import",
        effect: "write",
        requiredGrants: [AGENT_SESSIONS_SCAN, AGENT_SESSIONS_IMPORT],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["providerInstanceId", "providerSessionId"],
          properties: {
            providerInstanceId: providerInstanceIdSchema,
            providerSessionId: providerSessionIdSchema
          }
        },
        outputSchema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["status", "threadId", "sequence", "messageCount", "error"],
              properties: {
                status: { const: "imported" },
                threadId: { type: "string", minLength: 1, maxLength: 256 },
                sequence: { type: "integer", minimum: 0 },
                messageCount: { type: "integer", minimum: 0 },
                error: { const: null }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["status", "threadId", "sequence", "messageCount", "error"],
              properties: {
                status: { const: "rejected" },
                threadId: threadIdSchema,
                sequence: { const: null },
                messageCount: { const: 0 },
                error: {
                  enum: [
                    "AgentSessionOutOfScope",
                    "AgentSessionAlreadyImported",
                    "AgentSessionProjectConflict",
                    "AgentSessionImportRejected"
                  ]
                }
              }
            }
          ]
        }
      }
    ]
  });

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
      variant: { enum: ["default", "primary", "destructive"] },
      keepOpen: { type: "boolean" }
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
    version: "1.1.0",
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
              dismissible: { type: "boolean" },
              flashAction: {
                type: "object",
                additionalProperties: false,
                required: ["actionId", "label", "durationMs"],
                properties: {
                  actionId: { type: "string", minLength: 1, maxLength: 80 },
                  label: { type: "string", minLength: 1, maxLength: 80 },
                  durationMs: { type: "integer", minimum: 0, maximum: 1e4 }
                }
              }
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
      defaultKeyLogicalOnly: { type: "boolean" },
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
  var LISTED_ANNOTATION_TEXT_MAX = 160;
  var annotationTextSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["found", "text"],
        properties: { found: { const: true }, text: { type: "string", maxLength: 4096 } }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["found"],
        properties: { found: { const: false } }
      }
    ]
  };
  var listAnnotationsIncludeSchema = {
    type: "array",
    maxItems: 1,
    uniqueItems: true,
    items: { enum: ["text"] }
  };
  var CLIENT_COMPOSER_API = validateApiDefinition({
    id: "t3.client/composer",
    version: "1.3.0",
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
        inputSchema: withTarget({ ...composerThreadIdInput, include: listAnnotationsIncludeSchema }, [
          "threadId"
        ]),
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
                  sectionTitle: { type: "string", maxLength: 256 },
                  // 1.3.0, only when `include` asks for it.
                  text: { type: "string", maxLength: LISTED_ANNOTATION_TEXT_MAX },
                  textTruncated: { type: "boolean" }
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
      },
      {
        // 1.3.0: one own comment's whole text.
        name: "getAnnotation",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({
          ...composerThreadIdInput,
          annotationId: { type: "string", minLength: 1, maxLength: 256 }
        }, ["threadId", "annotationId"]),
        outputSchema: annotationTextSchema
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
      wordWrap: { type: "boolean" },
      // 1.1.0 and 1.2.0 respectively, and only when the server asks (`include`).
      renderBrowserFile: { type: "boolean" },
      fileExplorerOpen: { type: "boolean" }
    }
  };
  var preferencesIncludeProperty = {
    include: {
      type: "array",
      maxItems: 2,
      uniqueItems: true,
      items: { enum: ["renderBrowserFile", "fileExplorerOpen"] }
    }
  };
  var clientPreferencesPatchSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      wordWrap: { type: "boolean" },
      renderBrowserFile: { type: "boolean" },
      fileExplorerOpen: { type: "boolean" }
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
    version: "1.2.0",
    methods: [
      {
        name: "getPreferences",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget(preferencesIncludeProperty),
        outputSchema: clientPreferencesSchema
      },
      {
        name: "applyPreferences",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          writer: { type: "string", minLength: 1, maxLength: 160 },
          patch: clientPreferencesPatchSchema,
          ...preferencesIncludeProperty
        }, ["writer", "patch"]),
        outputSchema: clientPreferencesReceiptSchema
      }
    ],
    streams: [
      {
        name: "watchPreferences",
        inputSchema: withTarget(preferencesIncludeProperty),
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
  var uiExternalLinkReceiptSchema = {
    oneOf: [
      {
        ...uiExternalOpenReceiptSchema.oneOf[0],
        properties: {
          ...uiExternalOpenReceiptSchema.oneOf[0].properties,
          opener: { enum: ["desktop-shell", "browser-window", "in-app-browser"] }
        }
      },
      uiExternalOpenReceiptSchema.oneOf[1]
    ]
  };
  var uiExternalLinkInputProperties = {
    url: { type: "string", minLength: 1, maxLength: 2048 },
    forceSystem: { type: "boolean" }
  };
  var CLIENT_EXTERNAL_API = validateApiDefinition({
    id: "t3.client/external",
    version: "1.1.0",
    methods: [
      {
        name: "open",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({ url: { type: "string", minLength: 1, maxLength: 4096 } }, ["url"]),
        outputSchema: uiExternalOpenReceiptSchema
      },
      {
        name: "openLink",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget(uiExternalLinkInputProperties, ["url"]),
        outputSchema: uiExternalLinkReceiptSchema
      }
    ]
  });
  var uiEditorOpenReceiptSchema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "path", "editor"],
        properties: {
          status: { const: "opened" },
          path: { type: "string", minLength: 1, maxLength: 4096 },
          editor: { type: "string", minLength: 1, maxLength: 64 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "reason", "message"],
        properties: {
          status: { const: "refused" },
          reason: { enum: ["no-editor", "open-failed"] },
          message: { type: "string", maxLength: 1024 }
        }
      }
    ]
  };
  var editorPathInput = {
    path: { type: "string", minLength: 1, maxLength: 4096 },
    cwd: { type: "string", minLength: 1, maxLength: 4096 }
  };
  var CLIENT_EDITOR_API = validateApiDefinition({
    id: "t3.client/editor",
    version: "1.0.0",
    methods: [
      {
        name: "openPath",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget(editorPathInput, ["path", "cwd"]),
        outputSchema: uiEditorOpenReceiptSchema
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
  var uiNavigationFileReceipt = (reasons) => ({
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "relativePath"],
        properties: {
          status: { const: "opened" },
          relativePath: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "reason"],
        properties: {
          status: { const: "refused" },
          reason: { enum: reasons }
        }
      }
    ]
  });
  var uiNavigationFileReceiptSchemaV1_1 = uiNavigationFileReceipt([
    "unknown-thread",
    "out-of-scope",
    "invalid-path"
  ]);
  var uiNavigationFileReceiptSchema = uiNavigationFileReceipt([
    "unknown-thread",
    "out-of-scope",
    "invalid-path",
    // 1.2.0, only for `openIn: "browser"`.
    "not-previewable",
    "browser-unavailable",
    "open-failed"
  ]);
  var uiNavigationFileInputPropertiesV1_1 = {
    relativePath: { type: "string", minLength: 1, maxLength: 512 },
    line: { type: "integer", minimum: 1, maximum: 1e7 }
  };
  var uiNavigationFileInputProperties = {
    ...uiNavigationFileInputPropertiesV1_1,
    openIn: { enum: ["panel", "browser"] }
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
    version: "1.2.0",
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
      },
      {
        name: "openFile",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget(uiNavigationFileInputProperties, ["relativePath"]),
        outputSchema: uiNavigationFileReceiptSchema
      },
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: withTarget({}),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["openFileInBrowser"],
          properties: { openFileInBrowser: { type: "boolean" } }
        }
      }
    ]
  });
  var CLIENT_PR_HANDOFF_TASKS = ["checkout", "resolve-conflicts"];
  var CLIENT_PR_HANDOFF_MODES = ["worktree", "local"];
  var prHandoffResultSchema = {
    oneOf: [
      {
        // The task is in the caller's own thread's composer, for the reader to send.
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { const: "drafted" } }
      },
      {
        // Checked out, into its own worktree or this repository (`worktreePath`
        // null), with a thread open on it; a task other than checkout is in that
        // thread's composer.
        type: "object",
        additionalProperties: false,
        required: ["status", "branch", "worktreePath", "isOnPullRequestHead"],
        properties: {
          status: { const: "ready" },
          branch: { type: "string", minLength: 1, maxLength: 4096 },
          worktreePath: { type: ["string", "null"], minLength: 1, maxLength: 32768 },
          isOnPullRequestHead: { type: "boolean" }
        }
      },
      {
        // `thread`: no thread could be opened, so nothing was checked out.
        // `checkout`: the checkout failed; `detail` is the host's own sentence.
        // `thread-move`: checked out on `branch`, but the thread stayed put.
        type: "object",
        additionalProperties: false,
        required: ["status", "stage"],
        properties: {
          status: { const: "failed" },
          stage: { enum: ["thread", "checkout", "thread-move"] },
          branch: { type: "string", minLength: 1, maxLength: 4096 },
          detail: { type: "string", minLength: 1, maxLength: 2048 }
        }
      }
    ]
  };
  var CLIENT_PR_HANDOFF_API = validateApiDefinition({
    id: "t3.client/pr-handoff",
    version: "1.0.0",
    methods: [
      {
        name: "start",
        effect: "write",
        requiredGrants: [],
        inputSchema: withTarget({
          task: { enum: [...CLIENT_PR_HANDOFF_TASKS] },
          mode: { enum: [...CLIENT_PR_HANDOFF_MODES] },
          pullRequest: {
            type: "object",
            additionalProperties: false,
            required: ["number", "url", "headBranch", "baseBranch"],
            properties: {
              number: { type: "integer", minimum: 1 },
              url: { type: "string", minLength: 1, maxLength: 4096 },
              headBranch: { type: "string", minLength: 1, maxLength: 4096 },
              baseBranch: { type: "string", minLength: 1, maxLength: 4096 }
            }
          }
        }, ["task", "mode", "pullRequest"]),
        outputSchema: prHandoffResultSchema
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
    CLIENT_EDITOR_API,
    CLIENT_BROWSER_HISTORY_API,
    CLIENT_NAVIGATION_API,
    CLIENT_PR_HANDOFF_API
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
  var filePresentationOutputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["surfaceId", "placement", "restoreState"],
    properties: {
      surfaceId: { type: "string", minLength: 1, maxLength: 160 },
      placement: { enum: ["side-panel", "bottom-dock", "full-page", "compact-detail"] },
      restoreState: { type: "object" }
    }
  };
  var filePresentationApi = defineApi({
    id: FILE_PRESENTATION,
    version: "1.1.0",
    methods: [
      {
        name: "open",
        effect: "read",
        requiredGrants: [FILE_PRESENTATION_OPEN],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: {
            relativePath: path2,
            line: { type: "integer", minimum: 1, maximum: 1e7 }
          }
        },
        outputSchema: filePresentationOutputSchema
      }
    ]
  }, { baseline: "1.0.0", additions: [{ version: "1.1.0", method: "open", input: "line" }] });
  var filePresentationApiV1 = defineApi({
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
        outputSchema: filePresentationOutputSchema
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
  var prsListEntrySchemaV1 = {
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
  var prsObservedAtField = { type: "number", minimum: 0 };
  var prsListEntrySchema = {
    ...prsListEntrySchemaV1,
    properties: { ...prsListEntrySchemaV1.properties, observedAt: prsObservedAtField }
  };
  var prsListResultSchemaV1 = {
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
      entries: { type: "array", maxItems: 100, items: prsListEntrySchemaV1 },
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
  var prsListResultSchema = {
    ...prsListResultSchemaV1,
    properties: {
      ...prsListResultSchemaV1.properties,
      entries: { type: "array", maxItems: 100, items: prsListEntrySchema }
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
  var prsDetailSchemaV1 = {
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
  var prsDetailSchema = {
    ...prsDetailSchemaV1,
    properties: {
      ...prsDetailSchemaV1.properties,
      preferredMergeMethod: { enum: ["merge", "squash", "rebase"] },
      observedAt: prsObservedAtField
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
  function prsReadDefinition(version2, listResult, detail) {
    return {
      id: PRS_READ,
      version: version2,
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
          outputSchema: listResult
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
          outputSchema: detail
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
    };
  }
  var prsReadApi = defineStreamApi(prsReadDefinition("1.1.0", prsListResultSchema, prsDetailSchema), {
    baseline: "1.0.0",
    additions: [
      { version: "1.1.0", method: "detail", output: "preferredMergeMethod" },
      { version: "1.1.0", method: "detail", output: "observedAt" },
      { version: "1.1.0", method: "list", output: "entries[].observedAt" }
    ]
  });
  var prsReadApiV1 = defineStreamApi(prsReadDefinition("1.0.0", prsListResultSchemaV1, prsDetailSchemaV1));
  var PRS_READ_API = prsReadApi.definition;
  var PRS_READ_API_V1 = prsReadApiV1.definition;
  var VCS_ACTIONS = "t3.vcs/actions";
  var VCS_HANDOFF = "t3.vcs/handoff";
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
      "actions.actionProgress": { type: "boolean" },
      "actions.handoffPullRequest": { type: "boolean" }
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
  var vcsActionsApi = defineStreamApi(
    {
      id: VCS_ACTIONS,
      version: "1.1.0",
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
        },
        {
          // Native's pull-request handoff, run by the host: it resolves the pull
          // request, opens a thread, checks the pull request out (running the
          // project's setup script for that thread), points the thread at the
          // checkout, and leaves any task in the composer as a draft for the
          // reader to send. `checkout` lands in its own worktree, or with
          // `mode: "local"` in this repository; `resolve-conflicts` always takes
          // a worktree and refuses a mode, and from a view beside a thread
          // drafts into that thread instead, as native does. The pack names a
          // task, never text. The host reports every outcome in native's toasts,
          // which survive the move to the new thread, so the pack adds none.
          name: "handoffPullRequest",
          effect: "write",
          requiredGrants: [VCS_MUTATE, VCS_HANDOFF],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["reference", "task"],
            properties: {
              reference: { type: "string", minLength: 1, maxLength: 2048 },
              task: { enum: [...CLIENT_PR_HANDOFF_TASKS] },
              mode: { enum: [...CLIENT_PR_HANDOFF_MODES] }
            }
          },
          outputSchema: prHandoffResultSchema
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
    },
    // Existing consumers keep loading on a 1.0.0 host; probe
    // `actions.handoffPullRequest`, then bind at ^1.1.0 to call it.
    { baseline: "1.0.0", additions: [{ version: "1.1.0", method: "handoffPullRequest" }] }
  );
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
  var browserSessionsDefinition = (version2, commands, session, extraMethods = () => [], extraReads = []) => {
    const receipt2 = browserSessionReceiptOf(session);
    return {
      id: BROWSER_SESSIONS,
      version: version2,
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
  var BROWSER_PROFILES = "t3.browser/profiles";
  var BROWSER_CLEAR_COOKIES = "t3.browser/clear-cookies";
  var BROWSER_CLEAR_CACHE = "t3.browser/clear-cache";
  var BROWSER_IMPORT_COOKIES = "t3.browser/import-cookies";
  var BROWSER_IMPORT_UNAVAILABLE_REASONS = [
    "notInstalled",
    "needsKeychainApproval",
    "keychainItemMissing",
    "needsFullDiskAccess",
    "browserRunning",
    "unsupportedPlatform"
  ];
  var browserProfileId = { type: "string", minLength: 1, maxLength: 64 };
  var browserProfileTargetInput = {
    type: "object",
    additionalProperties: false,
    required: ["profileId"],
    properties: { profileId: browserProfileId }
  };
  var browserProfileClearResult = {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "profileId"],
    properties: { outcome: { enum: ["cleared", "unknown"] }, profileId: browserProfileId }
  };
  var browserImportLabel = { type: "string", minLength: 1, maxLength: 128 };
  var browserImportHandle = { type: "string", minLength: 1, maxLength: 16 };
  var browserProfileListSchema = {
    type: "object",
    additionalProperties: false,
    required: ["profiles", "defaultProfileId"],
    properties: {
      profiles: {
        type: "array",
        maxItems: 26,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name"],
          properties: {
            id: browserProfileId,
            name: { type: "string", minLength: 1, maxLength: 48 }
          }
        }
      },
      defaultProfileId: browserProfileId
    }
  };
  var browserProfilesMethods = [
    {
      name: "list",
      effect: "read",
      requiredGrants: [BROWSER_PROFILES],
      inputSchema: browserSessionEmptyInput,
      outputSchema: browserProfileListSchema
    },
    {
      name: "open",
      effect: "write",
      requiredGrants: [BROWSER_SESSIONS, BROWSER_OPERATE, BROWSER_PROFILES],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["profileId"],
        properties: {
          profileId: browserProfileId,
          url: browserSessionUrl,
          viewport: browserSessionViewport
        }
      },
      outputSchema: browserSessionReceiptOf(browserSessionObject)
    },
    {
      name: "clearCookies",
      effect: "write",
      requiredGrants: [BROWSER_CLEAR_COOKIES],
      inputSchema: browserProfileTargetInput,
      outputSchema: browserProfileClearResult
    },
    {
      name: "clearCache",
      effect: "write",
      requiredGrants: [BROWSER_CLEAR_CACHE],
      inputSchema: browserProfileTargetInput,
      outputSchema: browserProfileClearResult
    },
    {
      name: "listImportSources",
      effect: "read",
      requiredGrants: [BROWSER_IMPORT_COOKIES],
      inputSchema: browserSessionEmptyInput,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["sources"],
        properties: {
          sources: {
            type: "array",
            maxItems: 16,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "profiles"],
              properties: {
                id: browserImportLabel,
                name: browserImportLabel,
                unavailable: { enum: [...BROWSER_IMPORT_UNAVAILABLE_REASONS] },
                profiles: {
                  type: "array",
                  maxItems: 32,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["handle", "name"],
                    properties: {
                      handle: browserImportHandle,
                      name: browserImportLabel,
                      cookieCount: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      name: "importCookies",
      effect: "write",
      requiredGrants: [BROWSER_IMPORT_COOKIES],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["profileId", "sourceId", "sourceProfile"],
        properties: {
          profileId: browserProfileId,
          sourceId: browserImportLabel,
          sourceProfile: browserImportHandle
        }
      },
      outputSchema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "profileId", "imported", "skipped"],
            properties: {
              outcome: { const: "imported" },
              profileId: browserProfileId,
              imported: { type: "integer", minimum: 0 },
              skipped: { type: "integer", minimum: 0 }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "profileId"],
            properties: { outcome: { enum: ["declined", "unknown"] }, profileId: browserProfileId }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "profileId", "reason"],
            properties: {
              outcome: { const: "failed" },
              profileId: browserProfileId,
              reason: {
                enum: [
                  ...BROWSER_IMPORT_UNAVAILABLE_REASONS,
                  "keychainUnavailable",
                  "unknownSource",
                  "unknownSourceProfile",
                  "sessionUnavailable",
                  "readFailed"
                ]
              }
            }
          }
        ]
      }
    }
  ];
  var browserProfilesApi = defineApi(
    {
      id: BROWSER_PROFILES,
      version: "1.1.0",
      methods: browserProfilesMethods,
      streams: [
        {
          name: "changes",
          requiredGrants: [BROWSER_PROFILES],
          inputSchema: browserSessionEmptyInput,
          eventSchema: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["list"],
                properties: { list: browserProfileListSchema }
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["list"],
                properties: { list: { type: "null" }, pending: { const: true } }
              }
            ]
          }
        }
      ]
    },
    // Consumers keep loading on a 1.0.0 host; probe before subscribing.
    { baseline: "1.0.0", additions: [{ version: "1.1.0", stream: "changes" }] }
  );
  var browserProfilesApiV1 = defineApi({
    id: BROWSER_PROFILES,
    version: "1.0.0",
    methods: browserProfilesMethods
  });
  var BROWSER_PROFILES_API = browserProfilesApi.definition;
  var BROWSER_PROFILES_API_V1 = browserProfilesApiV1.definition;
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
  var BROWSER_SURFACE = "t3.browser/surface";
  var BROWSER_SURFACE_Z_INDEX = 30;
  var BROWSER_SURFACE_OVERLAY_ATTRIBUTE = "data-browser-surface-overlay";
  var BROWSER_CAPTURE = "t3.browser/capture";
  var BROWSER_CAPTURE_ARTIFACT_ACTIONS = "t3.browser/artifact-actions";
  var BROWSER_RECORDING = "t3.browser/recording";
  var BROWSER_RECORDING_MIN_VERSION = "1.2.0";
  var HOST_CAPABILITY_GRANT_DESCRIPTIONS = {
    [BROWSER_RECORDING]: "Record the browser panel as video",
    [BROWSER_CAPTURE_ARTIFACT_ACTIONS]: "Reveal saved recordings and copy their file paths"
  };
  var BROWSER_CAPTURE_REQUIRED_GRANTS = [BROWSER_SESSIONS, BROWSER_CAPTURE];
  var BROWSER_RECORDING_REQUIRED_GRANTS = [
    ...BROWSER_CAPTURE_REQUIRED_GRANTS,
    BROWSER_RECORDING
  ];
  var BROWSER_CAPTURE_ARTIFACT_REF_PATTERN2 = "^pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  function resolveBrowserRecording(capture) {
    const version2 = capture && parseVersion(capture.version);
    const minimum = parseVersion(BROWSER_RECORDING_MIN_VERSION);
    return capture && version2 && minimum && version2[0] === minimum[0] && compareVersions(version2, minimum) >= 0 && capture.startRecording && capture.stopRecording && capture.subscribeRecording && capture.recordingSupport ? capture : null;
  }
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
  var messagesEnrichmentDefinition = (withText) => ({
    id: MESSAGES_ENRICHMENT,
    version: withText ? "1.2.0" : "1.1.0",
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
          properties: {
            threadId: composerThreadIdInput2,
            ...withText ? { include: listAnnotationsIncludeSchema } : {}
          }
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
                  sectionTitle: { type: "string", minLength: 1, maxLength: 256 },
                  ...withText ? {
                    text: { type: "string", maxLength: LISTED_ANNOTATION_TEXT_MAX },
                    textTruncated: { type: "boolean" }
                  } : {}
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
      },
      ...withText ? [
        {
          name: "getAnnotation",
          effect: "read",
          // The user's unsent words, like listAnnotations.
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
          outputSchema: annotationTextSchema
        }
      ] : []
    ]
  });
  var messagesEnrichmentApi = defineApi(
    messagesEnrichmentDefinition(true),
    // Consumers keep loading on a 1.1.0 host; probe before asking for text.
    {
      baseline: "1.1.0",
      additions: [
        { version: "1.2.0", method: "listAnnotations", input: "include" },
        { version: "1.2.0", method: "getAnnotation" }
      ]
    }
  );
  var messagesEnrichmentApiV1_1 = defineApi(messagesEnrichmentDefinition(false));
  var COMPOSER_CONTEXT_API = composerContextApi.definition;
  var MESSAGES_ENRICHMENT_API = messagesEnrichmentApi.definition;
  var UI_THEME = "t3.ui/theme";
  var UI_THEME_READ = "t3.ui/theme.read";
  var UI_THEME_WRITE = "t3.ui/theme.write";
  var UI_KEYBINDINGS = "t3.ui/keybindings";
  var UI_KEYBINDINGS_GLOBAL = "t3.ui/keybindings.global";
  var UI_KEYBINDINGS_VERSION = "1.2.0";
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
  var uiKeybindingsApi = defineApi(
    {
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
    },
    // Consumers keep loading on a 1.1.0 host; probe before sending the 1.2.0 field.
    {
      baseline: "1.1.0",
      additions: [
        { version: "1.2.0", method: "registerCommands", input: "commands[].defaultKeyLogicalOnly" }
      ]
    }
  );
  var uiNotificationActionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 80 },
      label: { type: "string", minLength: 1, maxLength: 80 },
      variant: { enum: ["default", "primary", "destructive"] },
      keepOpen: { type: "boolean" }
    }
  };
  var UI_NOTIFICATION_FLASH_MAX_MS = 1e4;
  var uiNotificationFlashSchema = {
    type: "object",
    additionalProperties: false,
    required: ["actionId", "label", "durationMs"],
    properties: {
      actionId: { type: "string", minLength: 1, maxLength: 80 },
      label: { type: "string", minLength: 1, maxLength: 80 },
      durationMs: { type: "integer", minimum: 0, maximum: UI_NOTIFICATION_FLASH_MAX_MS }
    }
  };
  var uiNotificationsApi = defineApi(
    {
      id: "t3.ui/notifications",
      version: "1.1.0",
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
              dismissible: { type: "boolean" },
              flashAction: uiNotificationFlashSchema
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
    },
    // Consumers keep loading on a 1.0.0 host; probe before using the 1.1.0 fields.
    {
      baseline: "1.0.0",
      additions: [
        { version: "1.1.0", method: "notify", input: "actions[].keepOpen" },
        { version: "1.1.0", method: "update", input: "flashAction" }
      ]
    }
  );
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
  var uiPreferencesDefinition = (version2, preferences, patch) => ({
    id: UI_PREFERENCES,
    version: version2,
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
        outputSchema: preferences
      },
      {
        name: "setPreferences",
        effect: "write",
        requiredGrants: [UI_PREFERENCES_WRITE],
        inputSchema: patch,
        outputSchema: {
          ...clientPreferencesReceiptSchema,
          properties: { ...clientPreferencesReceiptSchema.properties, preferences }
        }
      }
    ],
    streams: [
      {
        name: "subscribePreferences",
        inputSchema: composerEmptyInputSchema,
        eventSchema: preferences,
        requiredGrants: [UI_PREFERENCES_READ]
      }
    ]
  });
  var uiPreferencesApi = defineApi(
    uiPreferencesDefinition("1.2.0", clientPreferencesSchema, clientPreferencesPatchSchema),
    // Consumers keep loading on a 1.0.0 host; probe before writing a later key.
    {
      baseline: "1.0.0",
      additions: [
        { version: "1.1.0", method: "setPreferences", input: "renderBrowserFile" },
        { version: "1.2.0", method: "setPreferences", input: "fileExplorerOpen" }
      ]
    }
  );
  var uiPreferencesV1_1Schema = {
    type: "object",
    additionalProperties: false,
    required: ["wordWrap"],
    properties: { wordWrap: { type: "boolean" }, renderBrowserFile: { type: "boolean" } }
  };
  var uiPreferencesApiV1_1 = defineApi(
    uiPreferencesDefinition("1.1.0", uiPreferencesV1_1Schema, {
      type: "object",
      additionalProperties: false,
      properties: uiPreferencesV1_1Schema.properties
    }),
    // As published: consumers keep loading on a 1.0.0 host.
    {
      baseline: "1.0.0",
      additions: [{ version: "1.1.0", method: "setPreferences", input: "renderBrowserFile" }]
    }
  );
  var uiPreferencesV1Schema = {
    type: "object",
    additionalProperties: false,
    required: ["wordWrap"],
    properties: { wordWrap: { type: "boolean" } }
  };
  var uiPreferencesApiV1 = defineApi({
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
        outputSchema: uiPreferencesV1Schema
      },
      {
        name: "setPreferences",
        effect: "write",
        requiredGrants: [UI_PREFERENCES_WRITE],
        inputSchema: {
          ...clientPreferencesPatchSchema,
          properties: { wordWrap: { type: "boolean" } }
        },
        outputSchema: {
          ...clientPreferencesReceiptSchema,
          properties: {
            ...clientPreferencesReceiptSchema.properties,
            preferences: uiPreferencesV1Schema
          }
        }
      }
    ],
    streams: [
      {
        name: "subscribePreferences",
        inputSchema: composerEmptyInputSchema,
        eventSchema: uiPreferencesV1Schema,
        requiredGrants: [UI_PREFERENCES_READ]
      }
    ]
  });
  var UI_THEME_API = uiThemeApi.definition;
  var UI_KEYBINDINGS_API = uiKeybindingsApi.definition;
  var UI_EXTERNAL = "t3.ui/external";
  var UI_EXTERNAL_OPEN = "t3.ui/external.open";
  var UI_EXTERNAL_SCHEMES = ["http:", "https:"];
  function checkExternalUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return { ok: false, reason: "invalid-url" };
    }
    return UI_EXTERNAL_SCHEMES.includes(parsed.protocol) ? { ok: true, url: parsed.href } : { ok: false, reason: "scheme-not-allowed" };
  }
  var uiExternalGetCapabilitiesMethod = {
    name: "getCapabilities",
    effect: "read",
    requiredGrants: [],
    inputSchema: composerEmptyInputSchema,
    outputSchema: uiCapabilitiesOutput(["open"])
  };
  var uiExternalOpenMethod = {
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
  };
  var uiExternalApi = defineApi(
    {
      id: UI_EXTERNAL,
      version: "1.1.0",
      methods: [
        {
          ...uiExternalGetCapabilitiesMethod,
          outputSchema: uiCapabilitiesOutput(["open", "openLink"])
        },
        uiExternalOpenMethod,
        {
          name: "openLink",
          effect: "write",
          requiredGrants: [UI_EXTERNAL_OPEN],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: uiExternalLinkInputProperties
          },
          outputSchema: uiExternalLinkReceiptSchema
        }
      ]
    },
    // Consumers keep loading on a 1.0.0 host; probe before calling openLink.
    { baseline: "1.0.0", additions: [{ version: "1.1.0", method: "openLink" }] }
  );
  var uiExternalApiV1 = defineApi({
    id: UI_EXTERNAL,
    version: "1.0.0",
    methods: [uiExternalGetCapabilitiesMethod, uiExternalOpenMethod]
  });
  var UI_EDITOR = "t3.ui/editor";
  var UI_EDITOR_OPEN = "t3.ui/editor.open";
  var uiEditorApi = defineApi({
    id: UI_EDITOR,
    version: "1.0.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput(["openPath"])
      },
      {
        name: "openPath",
        effect: "write",
        requiredGrants: [UI_EDITOR_OPEN],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "cwd"],
          properties: {
            path: { type: "string", minLength: 1, maxLength: 4096 },
            cwd: { type: "string", minLength: 1, maxLength: 4096 }
          }
        },
        outputSchema: uiEditorOpenReceiptSchema
      }
    ]
  });
  var UI_NAVIGATION = "t3.ui/navigation";
  var UI_NAVIGATION_OPEN = "t3.ui/navigation.open";
  var UI_NAVIGATION_OPEN_SESSION = "t3.ui/navigation.open-session";
  var uiNavigationOpenThreadMethod = {
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
  };
  var uiNavigationOpenAgentSessionMethod = {
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
  };
  var uiNavigationApi = defineApi(
    {
      id: UI_NAVIGATION,
      version: "1.2.0",
      methods: [
        {
          name: "getCapabilities",
          effect: "read",
          requiredGrants: [],
          inputSchema: composerEmptyInputSchema,
          // `openFileInBrowser` (1.2.0) is the invoking client's own answer:
          // whether it has a preview browser for `openIn: "browser"`.
          outputSchema: uiCapabilitiesOutput([
            "openThread",
            "openAgentSession",
            "openFile",
            "openFileInBrowser"
          ])
        },
        uiNavigationOpenThreadMethod,
        uiNavigationOpenAgentSessionMethod,
        {
          name: "openFile",
          effect: "write",
          requiredGrants: [UI_NAVIGATION_OPEN],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["relativePath"],
            properties: uiNavigationFileInputProperties
          },
          outputSchema: uiNavigationFileReceiptSchema
        }
      ]
    },
    // Consumers keep loading on a 1.0.0 host; probe before calling openFile.
    {
      baseline: "1.0.0",
      additions: [
        { version: "1.1.0", method: "openFile" },
        { version: "1.2.0", method: "openFile", input: "openIn" }
      ]
    }
  );
  var uiNavigationApiV1_1 = defineApi({
    id: UI_NAVIGATION,
    version: "1.1.0",
    methods: [
      {
        name: "getCapabilities",
        effect: "read",
        requiredGrants: [],
        inputSchema: composerEmptyInputSchema,
        outputSchema: uiCapabilitiesOutput(["openThread", "openAgentSession", "openFile"])
      },
      uiNavigationOpenThreadMethod,
      uiNavigationOpenAgentSessionMethod,
      {
        name: "openFile",
        effect: "write",
        requiredGrants: [UI_NAVIGATION_OPEN],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: uiNavigationFileInputPropertiesV1_1
        },
        outputSchema: uiNavigationFileReceiptSchemaV1_1
      }
    ]
  }, { baseline: "1.0.0", additions: [{ version: "1.1.0", method: "openFile" }] });
  var uiNavigationApiV1 = defineApi({
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
      uiNavigationOpenThreadMethod,
      uiNavigationOpenAgentSessionMethod
    ]
  });
  var UI_NOTIFICATIONS_API = uiNotificationsApi.definition;
  var UI_PANELS_API = uiPanelsApi.definition;
  var UI_PREFERENCES_API = uiPreferencesApi.definition;
  var UI_EXTERNAL_API = uiExternalApi.definition;
  var UI_EDITOR_API = uiEditorApi.definition;
  var UI_NAVIGATION_API = uiNavigationApi.definition;
  var orchestrationStatusApi = defineOrchestrationStatusApi(vcsDiffPreviewStreamEventSchema);
  var ORCHESTRATION_STATUS_API = orchestrationStatusApi.definition;
  var GENERIC_API_CATALOGUE = [
    orchestrationStatusApi.definition,
    orchestrationControlApi.definition,
    orchestrationLogsApi.definition,
    browserLocalServersApi.definition,
    browserHistoryApi.definition,
    browserSessionsApi.definition,
    browserSessionsApiV1_1.definition,
    browserSessionsApiV1.definition,
    browserProfilesApi.definition,
    browserProfilesApiV1.definition,
    browserFramesApi.definition,
    workspaceFilesApi.definition,
    workspaceTreeApi.definition,
    workspaceSearchApi.definition,
    workspaceChangesApi.definition,
    textEditsApi.definition,
    textEditsApiV1.definition,
    filePresentationApi.definition,
    filePresentationApiV1.definition,
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
    prsReadApiV1.definition,
    prsWriteApi.definition,
    composerContextApi.definition,
    messagesEnrichmentApi.definition,
    messagesEnrichmentApiV1_1.definition,
    uiThemeApi.definition,
    uiKeybindingsApi.definition,
    uiNotificationsApi.definition,
    uiPanelsApi.definition,
    uiPreferencesApi.definition,
    uiPreferencesApiV1_1.definition,
    uiPreferencesApiV1.definition,
    uiExternalApi.definition,
    uiExternalApiV1.definition,
    uiEditorApi.definition,
    uiNavigationApi.definition,
    uiNavigationApiV1_1.definition,
    uiNavigationApiV1.definition,
    agentSessionsApi.definition
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
  var API_CALL_TIME_GRANTS = {
    [BROWSER_SESSIONS]: [BROWSER_SURFACE, BROWSER_CAPTURE],
    [RESOURCES_LEASE]: [
      ...new Set(Object.values(RESOURCE_LEASE_KIND_GRANTS).filter((grant) => grant !== null))
    ],
    [UI_KEYBINDINGS]: [UI_KEYBINDINGS_GLOBAL, UI_PANELS],
    [VCS_ACTIONS]: [PRS_WRITE]
  };

  // node_modules/@t3tools/extension-sdk/dist/environment.js
  var ENVIRONMENT_MANIFEST_FILE = "t3-extension.json";
  var ENVIRONMENT_ASSET_MEDIA_TYPES = [
    "application/wasm",
    "application/octet-stream",
    "font/woff2"
  ];
  var REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo");
  var REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref");
  function isComponentType(value, depth = 0) {
    if (typeof value === "function")
      return true;
    if (typeof value !== "object" || value === null || depth > 4)
      return false;
    const wrapper = value;
    if (wrapper.$$typeof === REACT_MEMO_TYPE)
      return isComponentType(wrapper.type, depth + 1);
    if (wrapper.$$typeof === REACT_FORWARD_REF_TYPE)
      return typeof wrapper.render === "function";
    return false;
  }
  function resolveTooltip(host) {
    const member = host.tooltip;
    if (!member || typeof member !== "object")
      return null;
    const { version: version2, Tooltip: Tooltip2 } = member;
    return Number.isInteger(version2) && version2 >= 1 && isComponentType(Tooltip2) ? member : null;
  }
  function isComponent(value) {
    return typeof value === "function" || typeof value === "object" && value !== null && "$$typeof" in value;
  }
  function resolveFloatingLayer(host) {
    const member = host.floatingLayer;
    if (!member || typeof member !== "object")
      return null;
    const { version: version2, Popover } = member;
    return typeof version2 === "number" && version2 >= 1 && isComponent(Popover) ? member : null;
  }
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
      for (const array2 of [pkg.dependencies, pkg.provides, pkg.requires])
        if (!Array.isArray(array2) || array2.length > 32)
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
    const optional3 = new Set(schema.optional ?? []);
    return "{" + Object.entries(schema.fields).map(([key, type]) => key + (optional3.has(key) ? "?" : "") + ": " + type).join(", ") + "}";
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
      const optional3 = new Set(schema.optional ?? []);
      for (const [key, type] of Object.entries(schema.fields)) {
        const value = state2[key];
        if (value === void 0) {
          if (optional3.has(key))
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
      surfaces: surfaces.map(({ name, title, scope: scope2, placements, clients, capabilities, claimsTerminalFocus, stateVersion }) => ({
        id: source.id + "/" + name,
        title,
        scope: scope2,
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
  function requireApi(api, versionRange = defaultVersionRange(api)) {
    return { id: api.definition.id, versionRange };
  }
  function Tooltip(props) {
    const { host, ...rest } = props;
    const tooltip = resolveTooltip(host);
    return tooltip === null ? rest.children : host.React.createElement(tooltip.Tooltip, rest);
  }
  var OVERFLOW_CLIP_PATTERN = /(auto|scroll|hidden|clip)/;
  var OCCLUSION_POLL_MS = 400;
  function clippedSlotRect(element) {
    const bounds = element.getBoundingClientRect();
    let x1 = bounds.x;
    let y1 = bounds.y;
    let x2 = bounds.x + bounds.width;
    let y2 = bounds.y + bounds.height;
    let node = element.parentElement;
    while (node && node !== element.ownerDocument.documentElement) {
      const style = getComputedStyle(node);
      if (OVERFLOW_CLIP_PATTERN.test(style.overflowX) || OVERFLOW_CLIP_PATTERN.test(style.overflowY)) {
        const clip = node.getBoundingClientRect();
        const scaleX = node.offsetWidth > 0 ? clip.width / node.offsetWidth : 1;
        const scaleY = node.offsetHeight > 0 ? clip.height / node.offsetHeight : 1;
        const cx = clip.x + node.clientLeft * scaleX;
        const cy = clip.y + node.clientTop * scaleY;
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
        x2 = Math.min(x2, cx + node.clientWidth * scaleX);
        y2 = Math.min(y2, cy + node.clientHeight * scaleY);
      }
      node = node.parentElement;
    }
    const viewport = element.ownerDocument.defaultView;
    x1 = Math.max(x1, 0);
    y1 = Math.max(y1, 0);
    x2 = Math.min(x2, viewport?.innerWidth ?? x2);
    y2 = Math.min(y2, viewport?.innerHeight ?? y2);
    if (x2 <= x1 || y2 <= y1)
      return null;
    return {
      x: Math.round(x1),
      y: Math.round(y1),
      width: Math.round(x2 - x1),
      height: Math.round(y2 - y1)
    };
  }
  function slotOccluded(element, clip) {
    const stack = element.ownerDocument.elementsFromPoint(clip.x + clip.width / 2, clip.y + clip.height / 2);
    const index = stack.indexOf(element);
    const covering = index === -1 ? stack : stack.slice(0, index);
    return covering.some((node) => !element.contains(node) && !(typeof node.closest === "function" && (node.closest("[data-preview-viewport]") !== null || node.closest(`[${BROWSER_SURFACE_OVERLAY_ATTRIBUTE}]`) !== null)));
  }
  function useBrowserSurfaceSlot(host, session, options) {
    const { useCallback: useCallback2, useLayoutEffect, useRef: useRef5, useState: useState9 } = host.React;
    const [element, setElement] = useState9(null);
    const [result2, setResult] = useState9(null);
    const [shown, setShown] = useState9(false);
    const [, setLeaseVersion] = useState9(0);
    const targetKey = options.session ? `${options.session.serverEpoch}${options.session.tabId}` : "";
    const presentationRef = useRef5({
      visible: options.visible,
      cornerRadius: options.cornerRadius ?? 0,
      zIndex: options.zIndex ?? BROWSER_SURFACE_Z_INDEX
    });
    const updateRef = useRef5(null);
    const ref = useCallback2((node) => setElement(node), []);
    useLayoutEffect(() => {
      presentationRef.current = {
        visible: options.visible,
        cornerRadius: options.cornerRadius ?? 0,
        zIndex: options.zIndex ?? BROWSER_SURFACE_Z_INDEX
      };
      updateRef.current?.();
    }, [options.visible, options.cornerRadius, options.zIndex]);
    useLayoutEffect(() => {
      setResult(null);
      setShown(false);
      if (!element || !options.session)
        return;
      const surface = host.browserSurface;
      const major = Number.parseInt(surface?.version.split(".")[0] ?? "", 10);
      if (!surface || surface.id !== BROWSER_SURFACE || major !== 2) {
        setResult({
          ok: false,
          denial: {
            reason: "host-unavailable",
            detail: `This host does not implement ${BROWSER_SURFACE}@2.x.`
          }
        });
        return;
      }
      const surfaceSession = options.session;
      let detach = () => {
      };
      const acquisition = new AbortController();
      let disposed = false;
      const attach = (held) => {
        let poll = null;
        const unsubscribe = held.onDidChangeState((next) => {
          setLeaseVersion((value) => value + 1);
          if (next.kind !== "ended")
            return;
          setShown(false);
          if (poll !== null) {
            clearInterval(poll);
            poll = null;
          }
        });
        if (!surface.presentation.supported) {
          detach = () => {
            unsubscribe();
            held.release();
          };
          return;
        }
        let hidden = !presentationRef.current.visible;
        let lastRect = { x: 0, y: 0, width: 1, height: 1 };
        const update = () => {
          if (held.state.kind === "ended")
            return;
          const prefs = presentationRef.current;
          if (!prefs.visible) {
            if (poll !== null) {
              clearInterval(poll);
              poll = null;
            }
            if (!hidden) {
              hidden = true;
              held.present(lastRect, false, prefs.cornerRadius, prefs.zIndex);
              setShown(false);
            }
            return;
          }
          hidden = false;
          if (poll === null)
            poll = setInterval(update, OCCLUSION_POLL_MS);
          const clip = clippedSlotRect(element);
          const occluded = clip !== null && slotOccluded(element, clip);
          const rect = clip ?? (() => {
            const bounds = element.getBoundingClientRect();
            return {
              x: Math.round(bounds.x),
              y: Math.round(bounds.y),
              width: Math.max(1, Math.round(bounds.width)),
              height: Math.max(1, Math.round(bounds.height))
            };
          })();
          lastRect = rect;
          const visible = clip !== null && !occluded;
          setShown(held.present(rect, visible, prefs.cornerRadius, prefs.zIndex) === "accepted" && visible);
        };
        updateRef.current = update;
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        detach = () => {
          if (poll !== null)
            clearInterval(poll);
          observer.disconnect();
          window.removeEventListener("resize", update);
          window.removeEventListener("scroll", update, true);
          if (updateRef.current === update)
            updateRef.current = null;
          unsubscribe();
          held.release();
          setShown(false);
        };
      };
      const accept = (acquired2) => {
        if (disposed) {
          if (acquired2.ok)
            acquired2.lease.release();
          return;
        }
        setResult(acquired2);
        if (acquired2.ok)
          attach(acquired2.lease);
      };
      const acquired = surface.acquire({
        context: session.context,
        session: surfaceSession,
        signal: AbortSignal.any([session.signal, acquisition.signal])
      });
      if ("then" in acquired)
        acquired.then(accept, () => accept({
          ok: false,
          denial: { reason: "host-unavailable", detail: "The browser host is not connected." }
        }));
      else
        accept(acquired);
      return () => {
        disposed = true;
        detach();
        acquisition.abort();
      };
    }, [element, targetKey, host, session]);
    return {
      ref,
      lease: result2?.ok ? result2.lease : null,
      denial: result2 && !result2.ok ? result2.denial : null,
      shown: result2?.ok === true && shown,
      overlayZIndex: (options.zIndex ?? BROWSER_SURFACE_Z_INDEX) + 1
    };
  }
  function useRemoteBrowserFrames(host, session, options) {
    const { useCallback: useCallback2, useEffect: useEffect8, useRef: useRef5, useState: useState9 } = host.React;
    const [element, setElement] = useState9(null);
    const [status, setStatus] = useState9({ kind: "idle" });
    const [view, setView] = useState9({
      status: "connecting",
      inputConnected: false,
      droppedFrames: 0,
      rejectedInput: 0
    });
    const sessionRef = useRef5(options.session);
    sessionRef.current = options.session;
    const targetKey = options.session ? `${options.session.serverEpoch} ${options.session.tabId}` : "";
    const ref = useCallback2((node) => setElement(node), []);
    useEffect8(() => {
      setStatus({ kind: "idle" });
      setView({ status: "connecting", inputConnected: false, droppedFrames: 0, rejectedInput: 0 });
      if (!element || !options.enabled || !options.session)
        return;
      const target = options.session;
      const frames = host.browserFrames;
      const major = Number.parseInt(frames?.version.split(".")[0] ?? "", 10);
      if (!frames || frames.id !== BROWSER_FRAMES || major !== 1) {
        setStatus({
          kind: "unsupported",
          detail: `This host does not implement ${BROWSER_FRAMES}@1.x presentation.`
        });
        return;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const api = bindApi(browserFramesApi, host, session.context);
      const leases = bindApi(resourcesLeaseApi, host, session.context);
      let surfaceLease = null;
      const surfaceLeaseUrls = /* @__PURE__ */ new Set();
      const pendingOps = /* @__PURE__ */ new Set();
      const track = (op) => {
        pendingOps.add(op);
        void op.then(() => pendingOps.delete(op), () => pendingOps.delete(op));
        return op;
      };
      let minting = null;
      const mintSurfaceLease = () => {
        if (surfaceLease !== null && surfaceLease.expiresAt - Date.now() > 3e4) {
          return Promise.resolve(surfaceLease.url);
        }
        minting ??= track((async () => {
          try {
            const context2 = validateContext(session.context);
            const threadId = context2.resource.threadId;
            if (!threadId)
              return null;
            const mint = await leases.invoke("createPresentationUrl", {
              resource: {
                _tag: "browser-surface",
                threadId,
                tabId: target.tabId,
                serverEpoch: target.serverEpoch,
                allowedCommands: ["attach", "present", "release"]
              }
            }, signal);
            surfaceLease = { url: mint.url, expiresAt: mint.expiresAt };
            surfaceLeaseUrls.add(mint.url);
            return mint.url;
          } catch {
            return null;
          } finally {
            minting = null;
          }
        })());
        return minting;
      };
      let detach = () => {
      };
      let inputLeaseId = null;
      let inputLeaseSurfaceUrl = null;
      void (async () => {
        try {
          const capabilities = await api.invoke("getCapabilities", {}, signal);
          if (signal.aborted)
            return;
          if (!capabilities.stream.supported) {
            setStatus({
              kind: "unsupported",
              detail: "No engine host serves remote frames for this environment."
            });
            return;
          }
        } catch (error) {
          if (signal.aborted)
            return;
          setStatus({
            kind: "error",
            detail: error instanceof Error ? error.message : "Browser frames are unavailable."
          });
          return;
        }
        const presented = frames.present({
          context: session.context,
          session: { tabId: target.tabId, serverEpoch: target.serverEpoch },
          slot: element,
          signal,
          openStream: async () => {
            try {
              const surfaceLease2 = await mintSurfaceLease();
              if (surfaceLease2 === null)
                return null;
              const descriptor = await api.invoke("openStream", {
                tabId: target.tabId,
                serverEpoch: target.serverEpoch,
                surfaceLease: surfaceLease2,
                expectedEngineGeneration: sessionRef.current?.engineGeneration ?? null
              }, signal);
              return { ticket: descriptor.ticket, expiresAt: descriptor.expiresAt };
            } catch {
              return null;
            }
          },
          openInput: () => track((async () => {
            try {
              const surfaceLease2 = await mintSurfaceLease();
              if (surfaceLease2 === null)
                return null;
              const lease = await api.invoke("openInput", {
                tabId: target.tabId,
                serverEpoch: target.serverEpoch,
                surfaceLease: surfaceLease2,
                expectedEngineGeneration: sessionRef.current?.engineGeneration ?? null
              }, signal);
              inputLeaseId = lease.leaseId;
              inputLeaseSurfaceUrl = surfaceLease2;
              return {
                leaseId: lease.leaseId,
                inputTicket: lease.inputTicket,
                expiresAt: lease.expiresAt
              };
            } catch {
              return null;
            }
          })())
        });
        if (signal.aborted) {
          if (presented.ok)
            presented.view.detach();
          return;
        }
        if (!presented.ok) {
          setStatus(presented.denial.reason === "frames-unsupported" ? { kind: "unsupported", detail: presented.denial.detail } : { kind: "error", detail: presented.denial.detail });
          return;
        }
        const unsubscribe = presented.view.onDidChangeState(setView);
        setView(presented.view.state);
        setStatus({ kind: "connecting" });
        detach = () => {
          unsubscribe();
          presented.view.detach();
        };
      })();
      return () => {
        controller.abort();
        detach();
        void (async () => {
          await Promise.allSettled(pendingOps);
          const cleanupSignal = AbortSignal.timeout(5e3);
          if (inputLeaseId !== null) {
            void api.invoke("closeInput", {
              leaseId: inputLeaseId,
              ...inputLeaseSurfaceUrl !== null ? { surfaceLease: inputLeaseSurfaceUrl } : {}
            }, cleanupSignal).catch(() => {
            });
          }
          for (const presentationUrl of surfaceLeaseUrls) {
            void leases.invoke("releasePresentation", { presentationUrl }, cleanupSignal).catch(() => {
            });
          }
        })();
      };
    }, [element, targetKey, options.enabled, host, session]);
    const statusWithView = status.kind !== "connecting" ? status : view.status === "streaming" ? { kind: "streaming" } : view.status === "error" ? { kind: "error", detail: view.detail ?? "Remote frame transport failed." } : { kind: "connecting" };
    return {
      ref,
      status: statusWithView,
      inputConnected: view.inputConnected,
      droppedFrames: view.droppedFrames,
      rejectedInput: view.rejectedInput
    };
  }

  // extension.tsx
  var import_react9 = __toESM(require_react(), 1);

  // addressInput.tsx
  var import_react = __toESM(require_react(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  function committedAddress(input) {
    return input.fileSource ?? input.pageUrl ?? input.target ?? "";
  }
  function AddressInput(props) {
    const { value, committed, onValueChange, onSubmit, inputRef, style } = props;
    const [focused, setFocused] = (0, import_react.useState)(false);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "text",
        "aria-label": "Address",
        placeholder: "Search or enter URL",
        ref: inputRef,
        value: focused ? value : committed,
        onChange: (event) => onValueChange(event.target.value),
        onFocus: (event) => {
          onValueChange(committed);
          setFocused(true);
          const input = event.currentTarget;
          queueMicrotask(() => input.select());
        },
        onBlur: () => setFocused(false),
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const next = value.trim();
            if (next.length === 0) return;
            onSubmit(next);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onValueChange(committed);
            event.currentTarget.blur();
          }
        },
        style
      }
    );
  }

  // node_modules/@t3tools/shared/src/semver.ts
  var satisfiesSemverRange = function satisfiesSemverRange2(rawVersion, range) {
    const normalizedVersion = String(rawVersion).trim().replace(/^v/, "");
    const versionMatch = normalizedVersion.match(
      /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/
    );
    if (!versionMatch) {
      return false;
    }
    const version2 = {
      major: Number(versionMatch[1]),
      minor: Number(versionMatch[2] || 0),
      patch: Number(versionMatch[3] || 0)
    };
    return range.split("||").some((group) => {
      const comparators = group.trim().split(/\s+/).filter(Boolean);
      if (comparators.length === 0) {
        return false;
      }
      return comparators.every((comparator) => {
        const match4 = comparator.trim().match(/^(\^|>=|>|<=|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/);
        if (!match4) {
          return false;
        }
        const targetVersion = match4[2];
        if (targetVersion === void 0) {
          return false;
        }
        const targetMatch = targetVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
        if (!targetMatch) {
          return false;
        }
        const target = {
          major: Number(targetMatch[1]),
          minor: Number(targetMatch[2] || 0),
          patch: Number(targetMatch[3] || 0)
        };
        const compared = version2.major !== target.major ? version2.major > target.major ? 1 : -1 : version2.minor !== target.minor ? version2.minor > target.minor ? 1 : -1 : version2.patch !== target.patch ? version2.patch > target.patch ? 1 : -1 : 0;
        const operator = match4[1] || "=";
        switch (operator) {
          case "^":
            if (compared < 0) {
              return false;
            }
            if (target.major > 0) {
              return version2.major === target.major;
            }
            if (target.minor > 0) {
              return version2.major === 0 && version2.minor === target.minor;
            }
            return version2.major === 0 && version2.minor === 0 && version2.patch === target.patch;
          case ">=":
            return compared >= 0;
          case ">":
            return compared > 0;
          case "<=":
            return compared <= 0;
          case "<":
            return compared < 0;
          case "=":
            return compared === 0;
          default:
            return false;
        }
      });
    });
  };

  // capture.ts
  var import_react2 = __toESM(require_react(), 1);
  function capturePageView(lease, presentedVisible, navigation) {
    if (lease?.state.kind !== "active" || !lease.state.presentation.supported || !presentedVisible)
      return "hidden";
    return navigation === "failed" ? "failed" : "shown";
  }
  function captureUnavailableReason(host, held, threadId, page = "shown") {
    if (threadId === void 0) return "This panel has no thread, so there is no chat to add to.";
    if (!host.browserCapture) return "This host cannot capture browser sessions.";
    if (!host.browserCapture.support.supported)
      return "Capturing needs the T3 Code desktop app, where the page renders.";
    if (held === null) return "Open a page to capture it.";
    if (page === "hidden") return "The page is not shown here yet \u2014 capture once it renders.";
    if (page === "failed") return "Page didn't load \u2014 pick unavailable until the page renders";
    return null;
  }
  function annotationControl(input) {
    const picking = input.capturing === "element";
    const disabled = !picking && (input.blockReason !== null || input.capturing !== null);
    return {
      disabled,
      picking,
      ariaLabel: picking ? "Cancel annotation" : "Annotate preview",
      tooltip: disabled && input.pageFailed && input.blockReason !== null ? input.blockReason : picking ? "Cancel annotation (Esc)" : "Annotate elements, regions, and drawings",
      hoverWhileDisabled: input.pageFailed
    };
  }
  var IMAGE_LOST_REASONS = /* @__PURE__ */ new Set([
    "capture-failed",
    "too-large",
    "upload-failed"
  ]);
  async function captureToChat(host, context2, held, target, signal) {
    const threadId = context2.resource.threadId;
    if (!host.browserCapture || threadId === void 0)
      return {
        kind: "failed",
        stage: "request",
        message: "This host cannot capture browser sessions."
      };
    let captured;
    try {
      captured = await host.browserCapture.capture({ context: context2, session: held, target, signal });
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled" };
      return {
        kind: "failed",
        stage: "request",
        message: `Capture failed: ${error instanceof Error ? error.message : "the host threw"}`
      };
    }
    if (signal.aborted) return { kind: "cancelled" };
    if (!captured.ok) {
      if (captured.failure.reason === "cancelled") return { kind: "cancelled" };
      return {
        kind: "failed",
        stage: IMAGE_LOST_REASONS.has(captured.failure.reason) ? "image" : "request",
        message: captured.failure.grant ? `Capture failed \u2014 ${grantDenialMessage(captured.failure.grant)}` : `Capture failed \u2014 ${captured.failure.reason}: ${captured.failure.detail}`
      };
    }
    try {
      const result2 = await bindApi(composerContextApi, host, context2).invoke(
        "insertImage",
        { threadId, artifactRef: captured.artifact.artifactRef },
        signal
      );
      return { kind: "added", artifact: captured.artifact, inserted: result2.inserted };
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled" };
      return {
        kind: "failed",
        stage: "insert",
        message: `Captured, but it could not be added to chat: ${error instanceof Error ? error.message : "the composer refused it"}`
      };
    }
  }
  function isInlineOnlyFailure(target, stage) {
    return target === "element" && stage === "request";
  }
  function captureOutcomeMessage(target, outcome) {
    switch (outcome.kind) {
      case "cancelled":
        return null;
      case "failed":
        return outcome.message;
      case "added": {
        const what = outcome.artifact.target === "page" ? "Page screenshot" : "Element capture";
        return outcome.inserted ? `${what} added to chat.` : `${what} is already in chat.`;
      }
    }
  }
  var CAPTURE_TOAST_DURATION_MS = 5e3;
  var CAPTURE_COPIED_FLASH_MS = 2e3;
  function captureToastActions(capture) {
    const support = capture?.artifactActions;
    if (!capture || !support) return [];
    const actions = [];
    if (support.copyPath.supported && capture.copyArtifactPath)
      actions.push({ id: "copy-path", label: "Copy path", keepOpen: true });
    if (support.reveal.supported && capture.revealArtifact)
      actions.push({ id: "reveal", label: support.revealLabel, keepOpen: true });
    if (support.copyImage.supported && capture.copyArtifactToClipboard)
      actions.push({ id: "copy-image", label: "Copy image", variant: "primary", keepOpen: true });
    return actions;
  }
  function captureOutcomeToast(target, outcome, actions = []) {
    switch (outcome.kind) {
      case "cancelled":
        return null;
      case "failed":
        if (isInlineOnlyFailure(target, outcome.stage)) return null;
        return {
          severity: "error",
          title: target === "page" ? "Unable to capture screenshot" : "Could not capture the picked element",
          body: outcome.message,
          durationMs: CAPTURE_TOAST_DURATION_MS
        };
      case "added":
        if (target !== "page") return null;
        return {
          severity: "success",
          title: "Screenshot saved",
          durationMs: CAPTURE_TOAST_DURATION_MS,
          ...actions.length > 0 ? { actions } : {}
        };
    }
  }
  function copyFailureBody(reason, kind) {
    switch (reason) {
      case "artifact-not-found":
        return kind === "recording" ? "This recording is no longer available to copy." : "This screenshot is no longer available to copy.";
      case "desktop-required":
        return kind === "recording" ? "Saved recordings live in the T3 Code desktop app." : "Saved screenshots live in the T3 Code desktop app.";
      case "grant-denied":
      case "scope-invalid":
      case "host-unavailable":
        return kind === "recording" ? "This panel can no longer reach the saved recording." : "This panel can no longer reach the saved screenshot.";
      case "action-failed":
        return kind === "recording" ? "The saved recording could not be copied." : "The saved screenshot could not be copied.";
    }
  }
  async function runCaptureToastAction(notifications, capture, request, notificationId, actionId, signal, kind = "screenshot") {
    if (actionId === "reveal") {
      await capture.revealArtifact?.(request);
      return;
    }
    const copy = actionId === "copy-image" ? { run: capture.copyArtifactToClipboard, failTitle: "Unable to copy screenshot" } : actionId === "copy-path" ? {
      run: capture.copyArtifactPath,
      failTitle: kind === "recording" ? "Unable to copy recording path" : "Unable to copy screenshot path"
    } : null;
    if (!copy?.run) return;
    const result2 = await copy.run(request);
    if (signal.aborted) return;
    await notifications.invoke(
      "update",
      result2.ok ? {
        notificationId,
        severity: "success",
        title: kind === "recording" ? "Recording saved" : "Screenshot saved",
        body: "",
        flashAction: { actionId, label: "Copied!", durationMs: CAPTURE_COPIED_FLASH_MS }
      } : {
        notificationId,
        severity: "error",
        title: copy.failTitle,
        body: copyFailureBody(result2.failure.reason, kind)
      },
      signal
    );
  }
  async function serveCaptureToastActions(notifications, capture, request, notificationId, signal, kind = "screenshot") {
    while (!signal.aborted) {
      let outcome;
      try {
        outcome = await notifications.invoke("awaitAction", { notificationId }, signal);
      } catch {
        return;
      }
      if (!("actionId" in outcome)) return;
      void runCaptureToastAction(
        notifications,
        capture,
        request,
        notificationId,
        outcome.actionId,
        signal,
        kind
      ).catch(() => {
      });
    }
  }
  var NOTIFY_ACK_TIMEOUT_MS = 5e3;
  var NOTIFICATIONS_KEEP_OPEN_RANGE = "^1.1.0";
  async function hostTakesKeepOpen(actionHost, signal) {
    try {
      const selected = (await actionHost.discoverApis(actionHost.context, signal)).find(
        (api) => api.id === uiNotificationsApi.definition.id && api.selected
      );
      return selected !== void 0 && satisfiesSemverRange(selected.version, NOTIFICATIONS_KEEP_OPEN_RANGE);
    } catch {
      return false;
    }
  }
  function reportCaptureOutcome(notifications, threadId, target, outcome, signal, ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS, actionHost = null) {
    const message = captureOutcomeMessage(target, outcome);
    const saved = outcome.kind === "added" && outcome.artifact.saved === true;
    const toast = captureOutcomeToast(
      target,
      outcome,
      saved ? captureToastActions(actionHost?.capture ?? null) : []
    );
    if (toast === null) return { inline: message, fallback: Promise.resolve(null) };
    const ack = AbortSignal.timeout(ackTimeoutMs);
    const delivery = AbortSignal.any([signal, ack]);
    const notify = (input, via = notifications) => via.invoke("notify", { ...input, threadId, anchor: "thread" }, delivery);
    const { actions, ...plain } = toast;
    const fallback = Promise.resolve().then(async () => {
      if (actions === void 0 || actionHost === null || !await hostTakesKeepOpen(actionHost, delivery))
        return notify(plain);
      const probed = bindApi(
        uiNotificationsApi,
        actionHost,
        actionHost.context,
        NOTIFICATIONS_KEEP_OPEN_RANGE
      );
      return notify(toast, probed).then(
        ({ notificationId }) => {
          if (outcome.kind === "added")
            void serveCaptureToastActions(
              probed,
              actionHost.capture,
              { context: actionHost.context, artifactRef: outcome.artifact.artifactRef },
              notificationId,
              signal
            );
        },
        // A 1.1.0 host with a 1.0.0 client rejects keepOpen actions;
        // native's toast without them still beats a status line.
        (error) => {
          if (signal.aborted || ack.aborted) throw error;
          return notify(plain);
        }
      );
    }).then(
      () => null,
      () => signal.aborted || ack.aborted ? null : message
    );
    return { inline: null, fallback };
  }
  async function runBrowserCapture(host, session, held, target, isCurrent, onState, ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS, cancel) {
    const context2 = session.context;
    const signal = cancel ? AbortSignal.any([session.signal, cancel]) : session.signal;
    onState({ kind: "capturing", target });
    const outcome = await captureToChat(host, context2, held, target, signal);
    if (session.signal.aborted) return;
    const report = reportCaptureOutcome(
      bindApi(uiNotificationsApi, host, context2),
      context2.resource.threadId ?? "",
      target,
      outcome,
      session.signal,
      ackTimeoutMs,
      host.browserCapture ? {
        capture: host.browserCapture,
        context: context2,
        discoverApis: (probeContext, signal2) => host.discoverApis(probeContext, signal2),
        invokeApi: (request, signal2) => host.invokeApi(request, signal2)
      } : null
    );
    onState({ kind: "done", message: report.inline });
    const message = await report.fallback;
    if (message !== null && isCurrent() && !session.signal.aborted)
      onState({ kind: "done", message });
  }
  function captureStatusText(state2) {
    switch (state2.kind) {
      case "idle":
        return null;
      case "capturing":
        return state2.target === "element" ? "Pick an element in the page \u2014 Esc cancels." : "Capturing the page\u2026";
      case "done":
        return state2.message;
    }
  }
  function useBrowserCapture(host, session, held, page = "shown", onStatus) {
    const [state2, setState] = (0, import_react2.useState)({ kind: "idle" });
    const latestRun = (0, import_react2.useRef)(0);
    const cancelRun = (0, import_react2.useRef)(null);
    const blockReason = captureUnavailableReason(host, held, session.context.resource.threadId, page);
    const picking = state2.kind === "capturing" && state2.target === "element";
    const capture = (target) => {
      if (picking && target === "element") {
        cancelRun.current?.abort();
        return;
      }
      if (blockReason !== null || held === null || state2.kind === "capturing") return;
      const run2 = ++latestRun.current;
      const cancel = new AbortController();
      cancelRun.current = cancel;
      void runBrowserCapture(
        host,
        session,
        held,
        target,
        () => run2 === latestRun.current,
        (next) => {
          onStatus?.(captureStatusText(next));
          setState(next);
        },
        NOTIFY_ACK_TIMEOUT_MS,
        cancel.signal
      );
    };
    return { blockReason, state: state2, picking, capture };
  }

  // recording.ts
  var import_react3 = __toESM(require_react(), 1);
  function recordingUnavailableReason(host, held, page) {
    const capture = resolveBrowserRecording(host.browserCapture);
    if (!capture) return "This host cannot record browser sessions.";
    if (!capture.recordingSupport.supported)
      return capture.recordingSupport.reason === "grant-denied" ? grantDenialMessage(capture.recordingSupport.grant) : "Record from the T3 Code desktop app.";
    if (!held) return "Open a page before recording.";
    if (page !== "shown") return "The page must be shown here before recording.";
    return null;
  }
  function recordingToastActions(capture) {
    const support = capture.recordingArtifactActions ?? capture.artifactActions;
    if (!support) return [];
    const actions = [];
    if (support.reveal.supported && capture.revealArtifact)
      actions.push({ id: "reveal", label: support.revealLabel, variant: "primary", keepOpen: true });
    if (support.copyPath.supported && capture.copyArtifactPath)
      actions.push({ id: "copy-path", label: "Copy path", keepOpen: true });
    return actions;
  }
  async function runBrowserRecording(host, session, held, stopping) {
    const capture = resolveBrowserRecording(host.browserCapture);
    if (!capture) return "This host cannot record browser sessions.";
    let toast;
    let artifactRef = null;
    try {
      const request = { context: session.context, session: held, signal: session.signal };
      const result2 = stopping ? await capture.stopRecording(request) : await capture.startRecording(request);
      if (session.signal.aborted) return null;
      if (!result2.ok) {
        if (result2.failure.reason === "cancelled") return null;
        toast = {
          severity: "error",
          title: stopping ? "Unable to stop recording" : "Unable to start recording",
          body: result2.failure.grant ? grantDenialMessage(result2.failure.grant) : result2.failure.detail,
          durationMs: CAPTURE_TOAST_DURATION_MS
        };
      } else {
        if (!("artifact" in result2) || !result2.artifact) return null;
        artifactRef = result2.artifact.artifactRef;
        toast = {
          severity: "success",
          title: "Recording saved",
          durationMs: CAPTURE_TOAST_DURATION_MS,
          ...result2.artifact.saved ? { actions: recordingToastActions(capture) } : {}
        };
      }
    } catch {
      if (session.signal.aborted) return null;
      toast = {
        severity: "error",
        title: stopping ? "Unable to stop recording" : "Unable to start recording",
        body: "The desktop recording operation failed.",
        durationMs: CAPTURE_TOAST_DURATION_MS
      };
    }
    const signal = AbortSignal.any([session.signal, AbortSignal.timeout(NOTIFY_ACK_TIMEOUT_MS)]);
    const { actions, ...plain } = toast;
    const input = {
      ...plain,
      threadId: session.context.resource.threadId,
      anchor: "thread"
    };
    let notifications = bindApi(uiNotificationsApi, host, session.context);
    try {
      let withActions = false;
      if (actions?.length) {
        try {
          const selected = (await host.discoverApis(session.context, signal)).find(
            (api) => api.id === uiNotificationsApi.definition.id && api.selected
          );
          withActions = selected !== void 0 && satisfiesSemverRange(selected.version, "^1.1.0");
        } catch {
        }
      }
      if (withActions) notifications = bindApi(uiNotificationsApi, host, session.context, "^1.1.0");
      const notify = (offeredActions) => notifications.invoke(
        "notify",
        { ...input, ...offeredActions ? { actions: offeredActions } : {} },
        signal
      );
      const { notificationId } = await (withActions ? notify(actions).catch(() => {
        if (signal.aborted) throw new Error("Notification delivery ended.");
        withActions = false;
        return notify();
      }) : notify());
      if (withActions && artifactRef)
        void serveCaptureToastActions(
          notifications,
          capture,
          { context: session.context, artifactRef },
          notificationId,
          session.signal,
          "recording"
        );
      return null;
    } catch {
      return signal.aborted ? null : toast.body ?? toast.title;
    }
  }
  function useBrowserRecording(host, session, held, page, onStatus) {
    const [state2, setState] = (0, import_react3.useState)(null);
    const current = (0, import_react3.useRef)(null);
    const operation = (0, import_react3.useRef)(null);
    const capture = resolveBrowserRecording(host.browserCapture);
    const tabId = held?.tabId;
    const serverEpoch = held?.serverEpoch;
    const context2 = session.context;
    const phase = state2?.context === context2 && state2.tabId === tabId && state2.serverEpoch === serverEpoch ? state2.phase : "idle";
    (0, import_react3.useEffect)(() => {
      operation.current = null;
      const controller = new AbortController();
      current.current = controller;
      if (!capture || !tabId || !serverEpoch) return () => controller.abort();
      const signal = AbortSignal.any([session.signal, controller.signal]);
      const unsubscribe = capture.subscribeRecording(
        { context: context2, session: { tabId, serverEpoch }, signal },
        (state3) => {
          if (!signal.aborted && state3.ok)
            setState({ context: context2, tabId, serverEpoch, phase: state3.phase });
        }
      );
      return () => {
        controller.abort();
        unsubscribe();
      };
    }, [capture, tabId, serverEpoch, context2, session.signal]);
    const blockReason = recordingUnavailableReason(host, held, page);
    const toggle = async () => {
      const stopping = phase !== "idle";
      if (!held || !capture || operation.current === "stop" || !stopping && operation.current)
        return;
      if (!stopping && blockReason) {
        onStatus?.(blockReason);
        return;
      }
      const controller = current.current;
      if (!controller || controller.signal.aborted) return;
      const action = stopping ? "stop" : "start";
      operation.current = action;
      onStatus?.(null);
      const message = await runBrowserRecording(
        host,
        { context: session.context, signal: AbortSignal.any([session.signal, controller.signal]) },
        held,
        stopping
      );
      if (current.current !== controller || controller.signal.aborted) return;
      if (operation.current === action) operation.current = null;
      if (message) onStatus?.(message);
    };
    return { phase, blockReason, available: capture?.recordingSupport.supported === true, toggle };
  }

  // annotateButton.tsx
  var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
  function BrowserCaptureButtons(props) {
    const { host, session, held, page, onStatus, style } = props;
    const capture = useBrowserCapture(host, session, held, page, onStatus);
    const recording = useBrowserRecording(host, session, held, page, onStatus);
    const capturing = capture.state.kind === "capturing" ? capture.state.target : null;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        ScreenshotButton,
        {
          host,
          blockReason: capture.blockReason,
          capturing,
          pageFailed: page === "failed",
          recording: recording.phase !== "idle",
          recordingAvailable: recording.available,
          onCapture: (record2) => {
            if (record2 || recording.phase !== "idle") void recording.toggle();
            else capture.capture("page");
          },
          style
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        AnnotateButton,
        {
          host,
          blockReason: capture.blockReason,
          capturing,
          pageFailed: page === "failed",
          onPick: () => capture.capture("element"),
          style
        }
      )
    ] });
  }
  function AnnotateButton(props) {
    const { host, blockReason, onPick, style } = props;
    const annotate2 = annotationControl(props);
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: annotate2.tooltip, showWhenDisabled: annotate2.hoverWhileDisabled, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        "aria-label": annotate2.ariaLabel,
        "aria-description": annotate2.picking ? void 0 : blockReason ?? void 0,
        "aria-pressed": annotate2.picking,
        disabled: annotate2.disabled,
        onClick: onPick,
        style,
        children: "\u2316"
      }
    ) });
  }
  function ScreenshotButton(props) {
    const {
      host,
      blockReason,
      capturing,
      pageFailed,
      onCapture,
      style,
      recording = false,
      recordingAvailable = false
    } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Tooltip,
      {
        host,
        label: recording ? "Stop recording" : recordingAvailable ? "Screenshot \xB7 Shift-click to record" : "Screenshot",
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            "aria-label": recording ? "Stop recording" : "Capture screenshot",
            "aria-description": pageFailed ? void 0 : blockReason ?? void 0,
            disabled: !recording && blockReason !== null || capturing !== null,
            onClick: (event) => onCapture(event.shiftKey),
            style: {
              ...style,
              position: "relative",
              ...recording ? { color: "var(--destructive, #dc2626)", background: "var(--secondary, #f1f1f1)" } : {}
            },
            children: [
              "\u25A3",
              recording && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "span",
                {
                  "aria-hidden": true,
                  className: "animate-status-pulse",
                  style: {
                    position: "absolute",
                    right: 2,
                    top: 2,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--destructive, #dc2626)"
                  }
                }
              )
            ]
          }
        )
      }
    );
  }

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
    const cache2 = /* @__PURE__ */ new WeakMap();
    return (a) => {
      const cached2 = cache2.get(a);
      if (cached2 !== void 0) return cached2;
      const result2 = f(a);
      cache2.set(a, result2);
      return result2;
    };
  }
  function memoizeIdempotent(f) {
    const cache2 = /* @__PURE__ */ new WeakMap();
    return (a) => {
      const cached2 = cache2.get(a);
      if (cached2 !== void 0) return cached2;
      const result2 = f(a);
      cache2.set(a, result2);
      cache2.set(result2, result2);
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
          const cache2 = this.cache;
          if (!yielding && !cache2.preventYield && cache2.scheduler.shouldYield(this)) {
            yielding = true;
            const prev = current;
            current = flatMap(yieldNow, () => prev);
          }
          current = cache2.tracerContext ? cache2.tracerContext(current, this) : current[evaluate](this);
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
      const cache2 = root._fiberCache ??= makeFiberContextCache(context2);
      if (this.cache !== void 0 && this.cache.scheduler !== cache2.scheduler) {
        this._dispatcher = void 0;
      }
      this.cache = cache2;
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
  function hasInput2(issue) {
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
    return hasInput2(issue) ? format(issue.input) : void 0;
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
    const cache2 = /* @__PURE__ */ new WeakMap();
    const stack = [];
    outer: while (true) {
      if (typeof u !== "object" || u === null) {
        if (!isLeaf(u)) {
          return false;
        }
      } else {
        const value = u;
        const cached2 = cache2.get(value);
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
          cache2.set(value, false);
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
        cache2.set(frame.value, true);
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
  var LOOPBACK_PREFIX_PATTERN = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i;
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
  function previewUrlProtocol(rawUrl) {
    return /^([A-Za-z][A-Za-z\d+.-]*):/.exec(rawUrl)?.[1]?.toLowerCase().concat(":");
  }
  function normalizePreviewUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (trimmed.length === 0) {
      throw new PreviewUrlNormalizationError({ inputLength: rawUrl.length, reason: "empty" });
    }
    const useHttp = LOOPBACK_PREFIX_PATTERN.test(trimmed);
    const candidate = trimmed.includes("://") ? trimmed : `${useHttp ? "http" : "https"}://${trimmed}`;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (cause) {
      throw new PreviewUrlNormalizationError({
        inputLength: rawUrl.length,
        reason: "parse",
        protocol: previewUrlProtocol(candidate),
        cause
      });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PreviewUrlNormalizationError({
        inputLength: rawUrl.length,
        reason: "unsupported-protocol",
        protocol: parsed.protocol
      });
    }
    return parsed.href;
  }

  // viewModel.ts
  var initialNavigationState = {
    history: [],
    index: -1,
    epoch: 0,
    status: { kind: "idle" }
  };
  function normalizeAddress(raw) {
    try {
      return { ok: true, url: normalizePreviewUrl(raw) };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Address could not be parsed"
      };
    }
  }
  function submitAddress(state2, raw) {
    const result2 = normalizeAddress(raw);
    if (!result2.ok) {
      return {
        ...state2,
        status: { kind: "rejected", input: raw, message: result2.message }
      };
    }
    const history = [...state2.history.slice(0, state2.index + 1), result2.url];
    return {
      history,
      index: history.length - 1,
      epoch: state2.epoch + 1,
      status: { kind: "target", url: result2.url }
    };
  }
  function canGoBack(state2) {
    return state2.index > 0;
  }
  function canGoForward(state2) {
    return state2.index >= 0 && state2.index < state2.history.length - 1;
  }
  function goBack(state2) {
    if (!canGoBack(state2)) return state2;
    const index = state2.index - 1;
    return { ...state2, index, status: { kind: "target", url: state2.history[index] } };
  }
  function goForward(state2) {
    if (!canGoForward(state2)) return state2;
    const index = state2.index + 1;
    return { ...state2, index, status: { kind: "target", url: state2.history[index] } };
  }
  function reload(state2) {
    if (state2.status.kind !== "target") return state2;
    return { ...state2, epoch: state2.epoch + 1 };
  }
  function currentUrl(state2) {
    return state2.index >= 0 ? state2.history[state2.index] ?? null : null;
  }
  function recentTargets(state2) {
    return state2.history.map((url, index) => ({ url, index })).toReversed().filter((entry) => !isLeaseUrl(entry.url));
  }
  function tabLabel(title, url) {
    const trimmed = title.trim();
    if (trimmed.length > 0) return trimmed;
    if (url) {
      try {
        return new URL(url).host || "Browser";
      } catch {
      }
    }
    return "Browser";
  }
  function describeStatus(state2) {
    switch (state2.status.kind) {
      case "idle":
        return "Enter an address \u2014 nothing requested yet";
      case "rejected":
        return `Rejected \u201C${state2.status.input}\u201D \u2014 ${state2.status.message}`;
      case "target":
        return `Requested ${state2.status.url} (request ${state2.epoch})`;
    }
  }
  function isEpochChangedPresentation(leaseState) {
    return leaseState?.kind === "ended" && leaseState.reason === "epoch-changed";
  }
  function isBrowserPreviewFile(path3) {
    return /\.(?:html?|pdf)$/i.test(path3.split(/[?#]/, 1)[0] ?? "");
  }
  function isLeaseUrl(url) {
    try {
      return new URL(url).pathname.startsWith("/api/assets/");
    } catch {
      return false;
    }
  }

  // fileOpen.ts
  var fail6 = (reason, message) => ({
    ok: false,
    reason,
    message
  });
  function fileLeaseRef(threadId, relativePath) {
    if (relativePath.length === 0 || relativePath.startsWith("/") || relativePath.includes("\\") || /^[a-zA-Z]:/.test(relativePath) || relativePath.split("/").some((segment) => segment === ".."))
      return fail6(
        "outside-workspace",
        `Cannot open ${relativePath || "an empty path"} \u2014 the path is outside the workspace.`
      );
    if (!isBrowserPreviewFile(relativePath))
      return fail6(
        "not-previewable",
        `Cannot open ${relativePath} \u2014 the browser opens .html, .htm and .pdf files only.`
      );
    if (!threadId)
      return fail6(
        "context-missing",
        "Cannot open a workspace file here \u2014 this view has no thread to resolve the workspace from."
      );
    return { ok: true, resource: { _tag: "workspace-file", threadId, path: relativePath } };
  }
  function mintGate(supportedKinds) {
    return supportedKinds.includes("workspace-file") ? null : fail6(
      "mint-unsupported",
      "Cannot open workspace files \u2014 this environment cannot mint workspace-file leases."
    );
  }
  function resolveLeaseUrl(minted, documentUrl) {
    let resolved;
    try {
      resolved = new URL(minted, documentUrl);
    } catch {
      return fail6("foreign-origin", FOREIGN_ORIGIN_NO_BASE);
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
      return fail6(
        "foreign-origin",
        `Cannot open workspace files from this client \u2014 the file resolved to ${resolved.protocol}//${resolved.host}, not the environment's web address.`
      );
    return { ok: true, url: resolved.href };
  }
  var FOREIGN_ORIGIN_NO_BASE = "Cannot open workspace files from this client \u2014 it has no web address to resolve the file against.";
  var FOREIGN_ORIGIN_UNREACHABLE = "Cannot open the file \u2014 its preview URL did not load from this client (the environment may be unreachable).";
  var LEASE_DENIALS = [
    {
      name: "ResourceLeaseGrantDeniedError",
      reason: "grant-denied",
      message: `Cannot open workspace files \u2014 ${grantDenialMessage(WORKSPACE_RESOURCES)}`
    },
    {
      name: "ResourceLeaseKindDeniedError",
      reason: "mint-unsupported",
      message: "Cannot open workspace files \u2014 this environment does not mint workspace-file leases."
    },
    {
      name: "AssetWorkspacePathValidationError",
      reason: "outside-workspace",
      message: "Cannot open the file \u2014 the path resolves outside the workspace."
    },
    {
      name: "AssetPreviewTypeValidationError",
      reason: "not-previewable",
      message: "Cannot open the file \u2014 this file type cannot be served to the browser."
    },
    {
      name: "AssetWorkspaceAssetNotFoundError",
      reason: "not-found",
      message: "Cannot open the file \u2014 it no longer exists in the workspace."
    }
  ];
  var CONTEXT_ERRORS = [
    "AssetWorkspaceContextNotFoundError",
    "AssetWorkspaceContextResolutionError",
    "AssetWorkspaceRootNormalizationError"
  ];
  function fileOpenErrorState(error) {
    const text = error instanceof Error ? error.message : String(error);
    for (const denial of LEASE_DENIALS)
      if (text.includes(denial.name)) return fail6(denial.reason, denial.message);
    if (CONTEXT_ERRORS.some((name) => text.includes(name)))
      return fail6(
        "context-missing",
        "Cannot open the file \u2014 the thread's workspace could not be resolved."
      );
    if (/\bAPI unavailable\b/.test(text))
      return fail6(
        "mint-unsupported",
        "Cannot open workspace files \u2014 this environment has no t3.resources/lease provider."
      );
    return fail6("unavailable", `Cannot open the file${text ? ` \u2014 ${text.slice(0, 300)}` : ""}.`);
  }
  async function mintWorkspaceFileUrl(input) {
    const ref = fileLeaseRef(input.threadId, input.relativePath);
    if (!ref.ok) return ref;
    let minted;
    try {
      const capabilities = await input.lease.getCapabilities(input.signal);
      const gate = mintGate(capabilities.supportedKinds);
      if (gate) return gate;
      minted = await input.lease.createPresentationUrl(ref.resource, input.signal);
    } catch (error) {
      input.signal.throwIfAborted();
      return fileOpenErrorState(error);
    }
    const resolved = resolveLeaseUrl(minted.url, input.documentUrl);
    if (!resolved.ok) return resolved;
    try {
      const response = await input.fetch(resolved.url, { signal: input.signal });
      await response.body?.cancel().catch(() => {
      });
      if (!response.ok) return fail6("foreign-origin", FOREIGN_ORIGIN_UNREACHABLE);
    } catch (error) {
      input.signal.throwIfAborted();
      return fail6(
        "foreign-origin",
        `${FOREIGN_ORIGIN_UNREACHABLE}${error instanceof Error && error.message ? ` (${error.message.slice(0, 200)})` : ""}`
      );
    }
    return { ok: true, url: resolved.url, expiresAt: minted.expiresAt };
  }

  // favicon.tsx
  var import_react4 = __toESM(require_react(), 1);

  // faviconReads.ts
  var SETTLED_REFS_MAX = 4096;
  function createFaviconReadQueue(options) {
    const queued = /* @__PURE__ */ new Map();
    const running = /* @__PURE__ */ new Map();
    const settled = /* @__PURE__ */ new Set();
    const finish = (ref, src) => {
      settled.add(ref);
      if (settled.size > SETTLED_REFS_MAX) settled.delete(settled.values().next().value);
      options.settle(ref, src);
    };
    const start = (ref, views, read) => {
      const controller = new AbortController();
      const joined = /* @__PURE__ */ new Set();
      const release = () => {
        for (const signal of joined) if (!signal.aborted) return;
        controller.abort();
      };
      const join = (signal) => {
        joined.add(signal);
        signal.addEventListener("abort", release, { once: true });
      };
      running.set(ref, { controller, join });
      for (const signal of views.keys()) join(signal);
      read(ref, controller.signal).then(
        (src) => finish(ref, src),
        () => {
          if (!controller.signal.aborted) finish(ref, null);
        }
      ).finally(() => {
        for (const signal of joined) signal.removeEventListener("abort", release);
        running.delete(ref);
        pump();
      });
    };
    const pump = () => {
      for (const [ref, views] of queued) {
        if (running.size >= options.maxInFlight) return;
        for (const signal of views.keys()) if (signal.aborted) views.delete(signal);
        const read = views.values().next().value;
        if (read === void 0 || settled.has(ref)) {
          queued.delete(ref);
          continue;
        }
        if (running.has(ref)) continue;
        queued.delete(ref);
        start(ref, views, read);
      }
    };
    return {
      request(refs, read, signal) {
        if (signal.aborted) return;
        for (const ref of refs) {
          if (settled.has(ref)) continue;
          const reading = running.get(ref);
          if (reading && !reading.controller.signal.aborted) reading.join(signal);
          else queued.set(ref, (queued.get(ref) ?? /* @__PURE__ */ new Map()).set(signal, read));
        }
        pump();
      },
      inFlight: () => running.size
    };
  }

  // node_modules/@t3tools/shared/src/hostClassification.ts
  var normalizeHostname = (host) => host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/u, "");
  var parseIpv4Address = (host) => {
    const parts = normalizeHostname(host).split(".").map(Number);
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
  };
  var parseIpv4MappedIpv6Address = (host) => {
    const normalized = normalizeHostname(host);
    if (!normalized.startsWith("::ffff:")) return null;
    const suffix = normalized.slice("::ffff:".length);
    const dotted = parseIpv4Address(suffix);
    if (dotted) return dotted;
    const hextets = suffix.split(":");
    if (hextets.length !== 2 || hextets.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
    const high = Number.parseInt(hextets[0], 16);
    const low = Number.parseInt(hextets[1], 16);
    return [high >>> 8, high & 255, low >>> 8, low & 255];
  };
  var parseIpv6Address = (host) => {
    const normalized = normalizeHostname(host);
    if (!normalized.includes(":")) return null;
    const halves = normalized.split("::");
    if (halves.length > 2) return null;
    const head2 = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    if ([...head2, ...tail].some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
    const missing2 = 8 - head2.length - tail.length;
    if (halves.length === 1 && missing2 !== 0 || halves.length === 2 && missing2 < 1) return null;
    return [...head2, ...Array.from({ length: missing2 }, () => "0"), ...tail].map(
      (part) => Number.parseInt(part, 16)
    );
  };
  var ipv6PrefixMatches = (address, prefix, prefixLength) => {
    const fullHextets = Math.floor(prefixLength / 16);
    if (address.slice(0, fullHextets).some((part, index) => part !== prefix[index])) return false;
    const remainingBits = prefixLength % 16;
    if (remainingBits === 0) return true;
    const mask = 65535 << 16 - remainingBits & 65535;
    return (address[fullHextets] & mask) === (prefix[fullHextets] & mask);
  };
  var isPrivateIpv4Address = (parts) => parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] === 169 && parts[1] === 254 || parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19;
  var isSpecialPurposeIpv4Address = (parts) => isPrivateIpv4Address(parts) || parts[0] >= 224 || // Deliberately suppress the whole protocol-assignment block. IANA marks
  // .9 and .10 globally reachable, but privacy-safe false negatives are
  // preferable to disclosing another special-purpose address by mistake.
  parts[0] === 192 && parts[1] === 0 && parts[2] === 0 || parts[0] === 192 && parts[1] === 0 && parts[2] === 2 || parts[0] === 192 && parts[1] === 88 && parts[2] === 99 || parts[0] === 198 && parts[1] === 51 && parts[2] === 100 || parts[0] === 203 && parts[1] === 0 && parts[2] === 113;
  var isLocalLoopbackHost = (host) => {
    const normalized = normalizeHostname(host);
    if (normalized === "localhost" || normalized === "::1") return true;
    return parseIpv4Address(normalized)?.[0] === 127;
  };
  var isPrivateNetworkHost = (host) => {
    const normalized = normalizeHostname(host);
    if (normalized === "::" || isLocalLoopbackHost(normalized) || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized === "home.arpa" || normalized.endsWith(".home.arpa") || !normalized.includes(".") && !normalized.includes(":")) {
      return true;
    }
    if (normalized.endsWith(".ts.net")) return true;
    const parts = parseIpv4Address(normalized) ?? parseIpv4MappedIpv6Address(normalized);
    if (parts) return isPrivateIpv4Address(parts);
    const firstIpv6Token = normalized.split(":", 1)[0] ?? "";
    if (!normalized.includes(":") || !/^[\da-f]{1,4}$/u.test(firstIpv6Token)) return false;
    const firstIpv6Hextet = Number.parseInt(firstIpv6Token, 16);
    return Number.isInteger(firstIpv6Hextet) && ((firstIpv6Hextet & 65024) === 64512 || (firstIpv6Hextet & 65472) === 65152);
  };
  var isPublicFaviconHost = (host) => {
    if (host.endsWith("..")) return false;
    const normalized = normalizeHostname(host);
    if (isPrivateNetworkHost(normalized)) return false;
    if ([".alt", ".example", ".internal", ".invalid", ".onion", ".test"].some(
      (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix)
    )) {
      return false;
    }
    const ipv4 = parseIpv4Address(normalized) ?? parseIpv4MappedIpv6Address(normalized);
    if (ipv4) return !isSpecialPurposeIpv4Address(ipv4);
    if (!normalized.includes(":")) return true;
    const ipv6 = parseIpv6Address(normalized);
    if (!ipv6) return false;
    if (ipv6PrefixMatches(ipv6, [100, 65435, 0, 0, 0, 0, 0, 0], 96)) {
      const embeddedIpv4 = [ipv6[6] >>> 8, ipv6[6] & 255, ipv6[7] >>> 8, ipv6[7] & 255];
      return !isSpecialPurposeIpv4Address(embeddedIpv4);
    }
    const first = ipv6[0];
    if ((first & 57344) !== 8192) return false;
    if (ipv6PrefixMatches(ipv6, [8193, 0, 0, 0, 0, 0, 0, 0], 23)) {
      const publicProtocolAssignment = ipv6[1] === 1 && ipv6.slice(2, 7).every((part) => part === 0) && [1, 2, 3].includes(ipv6[7]) || ipv6PrefixMatches(ipv6, [8193, 3, 0, 0, 0, 0, 0, 0], 32) || ipv6PrefixMatches(ipv6, [8193, 4, 274, 0, 0, 0, 0, 0], 48) || ipv6PrefixMatches(ipv6, [8193, 32, 0, 0, 0, 0, 0, 0], 28) || ipv6PrefixMatches(ipv6, [8193, 48, 0, 0, 0, 0, 0, 0], 28);
      return publicProtocolAssignment;
    }
    if (ipv6PrefixMatches(ipv6, [8193, 3512, 0, 0, 0, 0, 0, 0], 32)) return false;
    if (ipv6PrefixMatches(ipv6, [8194, 0, 0, 0, 0, 0, 0, 0], 16)) return false;
    if (first === 16383 && (ipv6[1] & 61440) === 0) return false;
    return true;
  };

  // node_modules/@t3tools/shared/src/favicon.ts
  function faviconUrlForOrigin(rawUrl, size = 32) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (!url.host) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (!isPublicFaviconHost(url.hostname)) return null;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.host)}&sz=${size}`;
    } catch {
      return null;
    }
  }

  // faviconStore.ts
  var FAVICON_CACHE_MAX_ENTRIES = 40;
  var FAVICON_PROVIDER_SIZE = 32;
  var FAVICON_FAILURE_TTL_MS = 5 * 6e4;
  var MAX_FAVICON_READS = 8;
  var FAVICON_REF_MAX_ENTRIES = 256;
  function emptyFaviconCache() {
    return { byOrigin: {}, captured: {}, resolved: {} };
  }
  function capEntries(entries, stamp, max = FAVICON_CACHE_MAX_ENTRIES, pinned = /* @__PURE__ */ new Set()) {
    const keys = Object.keys(entries);
    if (keys.length <= max) return entries;
    const keep = /* @__PURE__ */ new Set([
      ...keys.filter((key) => pinned.has(key)),
      ...keys.filter((key) => !pinned.has(key)).toSorted((left, right) => stamp(entries[right]) - stamp(entries[left])).slice(0, Math.max(0, max - pinned.size))
    ]);
    return Object.fromEntries(keys.filter((key) => keep.has(key)).map((key) => [key, entries[key]]));
  }
  function formatFaviconHost(host) {
    return host.includes(":") ? `[${host}]` : host;
  }
  function faviconOriginKey(rawUrl) {
    if (rawUrl.length === 0 || rawUrl.length > 4096) return null;
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = normalizeHostname(parsed.hostname);
    const canonicalHost = isLocalLoopbackHost(host) || host === "0.0.0.0" ? "localhost" : host;
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return `${parsed.protocol}//${formatFaviconHost(canonicalHost)}:${port}`;
  }
  function recordProviderFaviconFailure(cache2, rawUrl, at) {
    const key = faviconOriginKey(rawUrl);
    if (!key) return cache2;
    const existing = cache2.byOrigin[key];
    if (existing && existing.providerFailedAt >= at) return cache2;
    return {
      ...cache2,
      byOrigin: capEntries(
        { ...cache2.byOrigin, [key]: { providerFailedAt: at } },
        (entry) => entry.providerFailedAt
      )
    };
  }
  var CAPTURED_SRC = /^data:image\/[a-z.+-]+;base64,/i;
  function dropCapturedFavicon(cache2, rawUrl, ref) {
    const key = faviconOriginKey(rawUrl);
    const originCapture = key ? cache2.captured[key] : void 0;
    const brokenRef = ref ?? originCapture?.ref;
    if (!key || !brokenRef) return cache2;
    const resolved = cache2.resolved[brokenRef];
    if (resolved?.src === null && originCapture?.ref !== brokenRef) return cache2;
    const captured = { ...cache2.captured };
    if (originCapture?.ref === brokenRef) delete captured[key];
    return {
      ...cache2,
      captured,
      resolved: {
        ...cache2.resolved,
        [brokenRef]: {
          src: null,
          resolvedAt: resolved?.resolvedAt ?? originCapture?.capturedAt ?? 0
        }
      }
    };
  }
  function recordResolvedFaviconRef(cache2, ref, src, at) {
    const image = src !== null && CAPTURED_SRC.test(src) ? src : null;
    const existing = cache2.resolved[ref];
    if (existing && existing.src === image) return cache2;
    return {
      ...cache2,
      resolved: capEntries(
        { ...cache2.resolved, [ref]: { src: image, resolvedAt: at } },
        (entry) => entry.resolvedAt,
        FAVICON_REF_MAX_ENTRIES
      )
    };
  }
  function applyResolvedFaviconRefs(cache2, sessions, at) {
    const refsByOrigin = /* @__PURE__ */ new Map();
    for (const session of sessions) {
      const ref = session.faviconRef;
      const key = session.navigation.url ? faviconOriginKey(session.navigation.url) : null;
      if (!ref || !key || !cache2.resolved[ref]?.src) continue;
      refsByOrigin.set(key, [...refsByOrigin.get(key) ?? [], ref]);
    }
    const updates = {};
    for (const [key, refs] of refsByOrigin) {
      const current = cache2.captured[key]?.ref;
      if (current !== void 0 && refs.includes(current)) continue;
      const ref = refs.at(-1);
      updates[key] = { ref, src: cache2.resolved[ref].src, capturedAt: at };
    }
    if (Object.keys(updates).length === 0) return cache2;
    return {
      ...cache2,
      captured: capEntries(
        { ...cache2.captured, ...updates },
        (entry) => entry.capturedAt,
        FAVICON_CACHE_MAX_ENTRIES,
        new Set(refsByOrigin.keys())
      )
    };
  }
  function expireStaleFaviconFailure(cache2, rawUrl, now) {
    const key = rawUrl ? faviconOriginKey(rawUrl) : null;
    const entry = key ? cache2.byOrigin[key] : void 0;
    if (!key || !entry || now - entry.providerFailedAt < FAVICON_FAILURE_TTL_MS) return cache2;
    const { [key]: _expired, ...byOrigin } = cache2.byOrigin;
    return { ...cache2, byOrigin };
  }
  var GLYPH = { kind: "glyph" };
  function faviconFallbackGlyph(rawUrl) {
    if (!rawUrl) return "\u2022";
    try {
      const letter = normalizeHostname(new URL(rawUrl).hostname).match(/[a-z\d]/i);
      return letter ? letter[0].toUpperCase() : "\u2022";
    } catch {
      return "\u2022";
    }
  }
  function resolveFavicon(cache2, rawUrl, ref) {
    if (!rawUrl) return GLYPH;
    const key = faviconOriginKey(rawUrl);
    if (!key) return GLYPH;
    const own = ref ? cache2.resolved[ref]?.src : null;
    if (ref && own) return { kind: "image", src: own, tier: "captured", ref };
    const captured = cache2.captured[key];
    if (captured) return { kind: "image", src: captured.src, tier: "captured", ref: captured.ref };
    if (cache2.byOrigin[key]) return GLYPH;
    const src = faviconUrlForOrigin(rawUrl, FAVICON_PROVIDER_SIZE);
    return src ? { kind: "image", src, tier: "provider" } : GLYPH;
  }
  function pendingFaviconRefs(cache2, sessions) {
    const pending = /* @__PURE__ */ new Set();
    for (const session of sessions) {
      const ref = session.faviconRef;
      const url = session.navigation.url;
      if (!ref || !url || cache2.resolved[ref]) continue;
      const key = faviconOriginKey(url);
      if (!key || cache2.captured[key]?.ref === ref) continue;
      pending.add(ref);
    }
    return [...pending];
  }
  function panelTabIndicators(cache2, presented, sessions) {
    const rawUrl = presented ? presented.navigation.url ?? presented.requestedUrl : null;
    const pageUrl = rawUrl && rawUrl.length <= 2048 && faviconOriginKey(rawUrl) ? rawUrl : null;
    const resolution = resolveFavicon(cache2, pageUrl, presented?.faviconRef);
    const audible = sessions.filter((session) => session.audible === true);
    const audio = audible.some((session) => session.audioMuted !== true) ? "audible" : audible.length > 0 ? "muted" : null;
    if (pageUrl === null && audio === null) return null;
    return {
      ...pageUrl === null ? {} : { pageUrl },
      ...resolution.kind === "image" && resolution.tier === "captured" ? { faviconDataUrl: resolution.src } : {},
      ...audio === null ? {} : { audio }
    };
  }

  // favicon.tsx
  var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
  var muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var listeners = /* @__PURE__ */ new Set();
  var cache = emptyFaviconCache();
  var version = 0;
  function commit(next) {
    if (next === cache) return;
    cache = next;
    version += 1;
    for (const listener of listeners) listener();
  }
  function faviconImageFailed(rawUrl, shown) {
    commit(
      shown.tier === "captured" ? dropCapturedFavicon(cache, rawUrl, shown.ref) : recordProviderFaviconFailure(cache, rawUrl, Date.now())
    );
  }
  var reads = createFaviconReadQueue({
    maxInFlight: MAX_FAVICON_READS,
    settle: (ref, src) => commit(recordResolvedFaviconRef(cache, ref, src, Date.now()))
  });
  function resolveSessionFavicons(api, sessions, signal) {
    reads.request(
      pendingFaviconRefs(cache, sessions),
      (ref, readSignal) => api.invoke("getFavicon", { ref }, readSignal).then((favicon) => favicon.dataUrl),
      signal
    );
  }
  function applySessionFavicons(rendered, sessions) {
    if (rendered === cache.resolved) commit(applyResolvedFaviconRefs(cache, sessions, Date.now()));
  }
  function useFaviconCache() {
    (0, import_react4.useSyncExternalStore)(subscribe, () => version);
    return cache;
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function useFaviconResolution(url, ref) {
    (0, import_react4.useSyncExternalStore)(subscribe, () => version);
    (0, import_react4.useEffect)(() => {
      commit(expireStaleFaviconFailure(cache, url, Date.now()));
    }, [url]);
    return resolveFavicon(cache, url, ref);
  }
  function BrowserFavicon(props) {
    const size = props.size ?? 12;
    const ref = props.faviconRef ?? null;
    const resolution = useFaviconResolution(props.url, ref);
    const box = {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 3
    };
    if (resolution.kind === "glyph")
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "span",
        {
          "aria-hidden": "true",
          style: {
            ...box,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.max(8, size - 3),
            lineHeight: 1,
            color: muted
          },
          children: faviconFallbackGlyph(props.url)
        }
      );
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "img",
      {
        src: resolution.src,
        alt: "",
        "aria-hidden": "true",
        draggable: false,
        width: size,
        height: size,
        style: { ...box, objectFit: "contain" },
        onError: () => faviconImageFailed(props.url ?? "", resolution)
      }
    );
  }

  // historyStore.ts
  var BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT = 50;
  var BROWSER_HISTORY_MAX_URL_LENGTH = 2048;
  var BROWSER_HISTORY_MAX_TITLE_LENGTH = 512;
  var MAX_VALID_DATE_MS = 864e13;
  var PREVIEW_RECENT_URL_DISPLAY_LIMIT = 8;
  function isValidHistoryTimestamp(value) {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_VALID_DATE_MS;
  }
  function normalizeHistoryUrl(raw) {
    let parsed;
    try {
      parsed = new URL(normalizePreviewUrl(raw));
    } catch {
      return null;
    }
    parsed.username = parsed.password = "";
    return parsed.href.length > BROWSER_HISTORY_MAX_URL_LENGTH ? null : parsed.href;
  }
  function visitLookupKey(normalized, environmentHostname) {
    const parsed = new URL(normalized);
    const host = normalizeHostname(parsed.hostname);
    const environmentHost = environmentHostname && normalizeHostname(environmentHostname);
    if (isLocalLoopbackHost(host) || host === "0.0.0.0" || host === environmentHost)
      parsed.hostname = "local";
    return parsed.href;
  }
  function isStableLocalUrl(normalized) {
    const host = normalizeHostname(new URL(normalized).hostname);
    return isLocalLoopbackHost(host) || host === "0.0.0.0";
  }
  function upsertHistoryEntry(entries, url, at, options) {
    const key = visitLookupKey(url, options?.environmentHostname);
    const existing = entries.find(
      (candidate) => visitLookupKey(candidate.url, options?.environmentHostname) === key
    );
    const rest = entries.filter(
      (candidate) => visitLookupKey(candidate.url, options?.environmentHostname) !== key
    );
    const visitedAt = options?.insertOrdered && existing && existing.lastVisitedAt > at ? existing.lastVisitedAt : at;
    const storedUrl = existing && (isStableLocalUrl(existing.url) || !isStableLocalUrl(url)) ? existing.url : url;
    const entry = existing ? { ...existing, url: storedUrl, lastVisitedAt: visitedAt } : { url, lastVisitedAt: visitedAt };
    if (!options?.insertOrdered)
      return [entry, ...rest].slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
    const index = rest.findIndex((candidate) => candidate.lastVisitedAt < entry.lastVisitedAt);
    const next = index === -1 ? [...rest, entry] : rest.toSpliced(index, 0, entry);
    return next.slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
  }
  function recordHistoryVisit(entries, rawUrl, at, options) {
    const normalized = normalizeHistoryUrl(rawUrl);
    return normalized ? upsertHistoryEntry(entries, normalized, at, options) : [...entries];
  }
  function removeHistoryUrl(entries, rawUrl) {
    const normalized = normalizeHistoryUrl(rawUrl);
    return normalized ? entries.filter((candidate) => candidate.url !== normalized) : [...entries];
  }
  function sanitizeHistoryEntries(value) {
    if (!Array.isArray(value)) return [];
    const seenUrls = /* @__PURE__ */ new Set();
    return value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const { url, lastVisitedAt, title } = candidate;
      if (typeof url !== "string") return [];
      const normalizedUrl = normalizeHistoryUrl(url);
      if (!normalizedUrl) return [];
      if (!isValidHistoryTimestamp(lastVisitedAt)) return [];
      return [
        {
          url: normalizedUrl,
          lastVisitedAt,
          ...typeof title === "string" && title.length > 0 ? { title: title.slice(0, BROWSER_HISTORY_MAX_TITLE_LENGTH) } : {}
        }
      ];
    }).toSorted((a, b) => b.lastVisitedAt - a.lastVisitedAt).filter((entry) => {
      const key = visitLookupKey(entry.url);
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    }).slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
  }
  function recentHistoryEntries(entries, limit = PREVIEW_RECENT_URL_DISPLAY_LIMIT) {
    return entries.filter((entry) => URL.canParse(entry.url)).slice(0, limit);
  }
  function restoreTarget(fileSource, url) {
    if (fileSource) return { relativePath: fileSource };
    if (url && !isLeaseUrl(url)) return { url };
    return {};
  }
  function adoptedFileSource(fileSource, mintedUrl, url) {
    return fileSource !== null && url !== null && url === mintedUrl ? fileSource : null;
  }
  var HISTORY_SAVE_BUDGET_BYTES = 56e3;
  var historyByteEncoder = new TextEncoder();
  function fitHistoryToSaveBudget(record2, entries, budgetBytes = HISTORY_SAVE_BUDGET_BYTES) {
    let next = entries.slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
    while (next.length > 0 && historyByteEncoder.encode(JSON.stringify({ ...record2, history: next })).length > budgetBytes)
      next = next.slice(0, -1);
    return next;
  }

  // landing.tsx
  var import_react5 = __toESM(require_react(), 1);

  // localServers.ts
  var LOCAL_SERVERS_HINT = "Select a live local server to open it in this browser tab.";
  var LOCAL_SERVERS_LOOPBACK_LIMITATION = "Opened as-is: for a remote environment, localhost reaches the machine running the browser, not the environment.";
  var LOCAL_SERVERS_TRUNCATED_NOTICE = "Some discovered servers are not listed \u2014 the environment reported more than it could share.";
  var NO_PREVIEW_TITLE = "No preview yet";
  var NO_PREVIEW_DESCRIPTION = "Type a URL above, or run a dev script. Browser-ready localhost servers will show up here automatically.";
  var NO_PREVIEW_DESCRIPTION_WITHOUT_DISCOVERY = "Type a URL above.";
  var LOOPBACK_KEY_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
  function loopbackKey(host, port) {
    const normalized = host.toLowerCase();
    return `${LOOPBACK_KEY_HOSTS.has(normalized) ? "loopback" : normalized}:${port}`;
  }
  function localServersFromSnapshot(snapshot) {
    let truncated = snapshot.truncated;
    const byKey = /* @__PURE__ */ new Map();
    for (const server of snapshot.servers) {
      let parsed;
      try {
        parsed = new URL(server.url);
      } catch {
        truncated = true;
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        truncated = true;
        continue;
      }
      const key = loopbackKey(parsed.hostname, server.port);
      const existing = byKey.get(key);
      if (existing && !(parsed.hostname === "localhost" && existing.host !== "localhost")) continue;
      byKey.set(key, {
        url: parsed.href,
        host: parsed.hostname,
        port: server.port,
        title: "Listening",
        description: `${parsed.hostname}:${server.port}`
      });
    }
    const servers = [...byKey.values()].toSorted(
      (left, right) => left.port - right.port || left.url.localeCompare(right.url)
    );
    return { kind: "ready", servers, truncated };
  }
  function localServersErrorState(error) {
    const text = error instanceof Error ? error.message : String(error);
    const denial = describeGrantDenial(error);
    if (denial)
      return {
        kind: "denied",
        grant: denial.grant,
        message: `Local servers are hidden \u2014 ${denial.message}`
      };
    return {
      kind: "unavailable",
      message: `Local servers are unavailable${text ? ` \u2014 ${text.slice(0, 300)}` : ""}.`
    };
  }
  var LOCAL_SERVERS_CLOSED_MESSAGE = "Local server discovery stopped \u2014 the environment's port scanner is unavailable.";
  async function watchLocalServers(api, signal, onState) {
    onState({ kind: "loading" });
    try {
      for await (const frame of api.subscribe("subscribe", {}, signal)) {
        if (signal.aborted) return;
        const value = frame.value;
        if (!value) continue;
        if (value.kind === "closed") {
          onState({ kind: "closed", message: LOCAL_SERVERS_CLOSED_MESSAGE });
          return;
        }
        onState(localServersFromSnapshot(value));
      }
      if (!signal.aborted)
        onState({ kind: "unavailable", message: "Local server discovery ended unexpectedly." });
    } catch (error) {
      if (!signal.aborted) onState(localServersErrorState(error));
    }
  }
  function landingModel(input) {
    const local = input.localServers;
    const serverList = local.kind === "ready" ? local.servers : [];
    const failed = local.kind === "closed" || local.kind === "denied" || local.kind === "unavailable";
    const localNotice = failed ? local.message : local.kind === "ready" && local.truncated ? LOCAL_SERVERS_TRUNCATED_NOTICE : null;
    const noPreview = input.recentCount === 0 && serverList.length === 0 ? {
      title: NO_PREVIEW_TITLE,
      description: failed ? NO_PREVIEW_DESCRIPTION_WITHOUT_DISCOVERY : NO_PREVIEW_DESCRIPTION
    } : null;
    return { noPreview, serverList, localNotice };
  }

  // landing.tsx
  var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
  var muted2 = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var headingStyle = { margin: 0, fontSize: 12, fontWeight: 500, color: muted2 };
  function useLocalServers(host, session, active) {
    const [state2, setState] = (0, import_react5.useState)(LOADING);
    const [run2, setRun] = (0, import_react5.useState)({ host, session, active });
    if (run2.host !== host || run2.session !== session || run2.active !== active) {
      setRun({ host, session, active });
      setState(LOADING);
    }
    (0, import_react5.useEffect)(() => {
      if (!active) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void watchLocalServers(
        bindStreamApi(browserLocalServersApi, host, session.context),
        signal,
        setState
      );
      return () => controller.abort();
    }, [host, session, active]);
    return active ? state2 : IDLE;
  }
  var IDLE = { kind: "idle" };
  var LOADING = { kind: "loading" };
  function RecentlyUsedHeading() {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { style: headingStyle, children: "Recently used" });
  }
  function NoPreview(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { "aria-label": props.title, style: { display: "grid", gap: 4, maxWidth: "36rem" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { style: { ...headingStyle, color: "inherit", fontSize: 13 }, children: props.title }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { margin: 0, fontSize: 12, color: muted2 }, children: props.description })
    ] });
  }
  function LocalServersSection(props) {
    if (props.servers.length === 0 && props.notice === null) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { "aria-label": "Local servers", style: { display: "grid", gap: 6, maxWidth: "36rem" }, children: [
      props.servers.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { style: headingStyle, children: "Local servers" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, fontSize: 12 }, children: props.servers.map((server) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "button",
          {
            type: "button",
            onClick: () => props.onOpen(server.url),
            style: {
              font: "inherit",
              fontSize: 12,
              border: "none",
              background: "transparent",
              color: "inherit",
              padding: "2px 0",
              textAlign: "left",
              display: "grid"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: server.title }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { color: muted2 }, children: server.description })
            ]
          }
        ) }, `${server.host}:${server.port}`)) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { margin: 0, fontSize: 11, color: muted2 }, children: LOCAL_SERVERS_HINT }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "note", style: { margin: 0, fontSize: 11, color: muted2 }, children: LOCAL_SERVERS_LOOPBACK_LIMITATION })
      ] }),
      props.notice !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "note", style: { margin: 0, fontSize: 11, color: muted2 }, children: props.notice })
    ] });
  }

  // projectHistory.ts
  function projectHistoryErrorState(op, error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("capability denied")) {
      const grant = describeGrantDenial(error)?.grant ?? (op === "list" ? BROWSER_READ_HISTORY : BROWSER_RECORD_HISTORY);
      return {
        kind: "unavailable",
        message: `Showing this view's history only \u2014 ${grantDenialMessage(grant)}`
      };
    }
    return {
      kind: "unavailable",
      message: `Showing this view's history only \u2014 project history is unavailable${text ? ` (${text.slice(0, 300)})` : ""}.`
    };
  }
  function displayedHistory(state2, own) {
    return state2.kind === "ready" ? state2.entries : own;
  }
  function createProjectHistory(api, signal, onState) {
    let issued = 0;
    const run2 = (op, request) => {
      const sequence = ++issued;
      const current = () => !signal.aborted && sequence === issued;
      void request(signal).then(
        (result2) => {
          if (current())
            onState({
              kind: "ready",
              entries: sanitizeHistoryEntries(result2?.entries),
              truncated: result2?.truncated === true
            });
        },
        (error) => {
          if (current()) onState(projectHistoryErrorState(op, error));
        }
      );
    };
    return {
      refresh: () => run2("list", (abort) => api.invoke("list", {}, abort)),
      record: (url) => run2("record", (abort) => api.invoke("record", { url }, abort)),
      setTitle: (url, title) => run2("setTitle", (abort) => api.invoke("setTitle", { url, title }, abort)),
      remove: (url) => run2("remove", (abort) => api.invoke("remove", { url }, abort))
    };
  }
  function createRevisionFence() {
    return { epoch: null, revision: -1, retired: /* @__PURE__ */ new Set() };
  }
  function isStaleRevision(fence, epoch, revision2) {
    return fence.retired.has(epoch) || epoch === fence.epoch && revision2 < fence.revision;
  }
  function advanceRevision(fence, epoch, revision2) {
    if (isStaleRevision(fence, epoch, revision2)) return false;
    if (fence.epoch !== null && fence.epoch !== epoch) fence.retired.add(fence.epoch);
    fence.epoch = epoch;
    fence.revision = revision2;
    return true;
  }
  function createCommandDispatch(options) {
    const { signal, fence } = options;
    return (run2, onAccepted) => {
      void run2(signal).then(
        (receipt2) => {
          if (signal.aborted) return;
          const current = advanceRevision(fence, receipt2.serverEpoch, receipt2.revision);
          if (receipt2.outcome !== "accepted") {
            if (current) options.refuse(receipt2.outcome);
            return;
          }
          if (current) options.adopt(receipt2);
          onAccepted?.();
        },
        (error) => {
          if (!signal.aborted) options.fail(error);
        }
      );
    };
  }
  function titleUpdate(navigation, presentingFile, isLeaseUrl2) {
    if (!navigation || navigation.kind !== "loaded" || presentingFile) return null;
    const { url, title } = navigation;
    if (!url || !title.trim() || isLeaseUrl2(url)) return null;
    return { url, title };
  }

  // pageControls.ts
  function pageControlsBlock(session) {
    if (session === null) return "Waiting for the browser session to report its state.";
    const { engine } = session;
    switch (engine.state) {
      case "ready":
      case "starting":
        return null;
      case "unavailable":
        return `Page controls need the T3 Code desktop app, where the page renders (${engine.reason ?? "desktop-required"}).`;
      case "recovering":
        return "The page crashed and the browser engine is recovering it (recovering).";
      case "crashed":
        return engine.reason === "recovery-exhausted" ? "The page crashed and recovery gave up (recovery-exhausted). Reload opens a fresh session." : "The page crashed (crash).";
    }
  }
  function isRecoveryExhausted(session) {
    return session?.engine.state === "crashed" && session.engine.reason === "recovery-exhausted";
  }
  function engineStatusLabel(session) {
    const { engine, navigation } = session;
    const engineText = engine.state === "ready" ? "engine ready" : `engine ${engine.state}${engine.reason ? ` (${engine.reason})` : ""}`;
    const failure = navigation.failureCode ? ` (${navigation.failureCode})` : "";
    return `${engineText}, navigation ${navigation.kind}${failure}`;
  }
  var ZOOM_LADDER = BROWSER_SESSION_ZOOM_LEVELS;
  var DEFAULT_ZOOM_FACTOR = 1;
  var ZOOM_EPSILON = 1e-3;
  function isLadderFactor(factor) {
    return ZOOM_LADDER.some((level) => Math.abs(level - factor) < ZOOM_EPSILON);
  }
  function nextZoomFactor(current, direction) {
    const base = current ?? DEFAULT_ZOOM_FACTOR;
    const found = ZOOM_LADDER.findIndex(
      (level) => Math.abs(level - base) < ZOOM_EPSILON || level > base
    );
    const step = found < 0 ? ZOOM_LADDER.length - 1 : Math.abs(ZOOM_LADDER[found] - base) < ZOOM_EPSILON ? found : found - 1;
    const index = direction === "in" ? Math.min(step + 1, ZOOM_LADDER.length - 1) : Math.max(step - 1, 0);
    return ZOOM_LADDER[index];
  }
  function zoomPercent(factor) {
    return `${Math.round(factor * 100)}%`;
  }
  var VERB_LABELS = {
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    hardReload: "Hard reload",
    zoom: "Zoom",
    setAppearance: "Appearance",
    setAudioMuted: "Mute",
    openDevTools: "Open DevTools",
    closeDevTools: "Close DevTools",
    setPictureInPicture: "Picture in picture"
  };
  function pageCommandErrorMessage(method, error) {
    const label = VERB_LABELS[method];
    const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const denial = describeGrantDenial(error);
    if (denial) return `${label} \u2014 ${denial.message}`;
    if (text.includes("BrowserSessionNotOwned"))
      return `${label} is only available on pages this panel opened (not-owned).`;
    if (text.includes("(engine-unsupported)"))
      return `${label} is not supported by the browser engine rendering this page (engine-unsupported).`;
    if (text.includes("BrowserSessionEngineDetached"))
      return `${label} was not sent: no desktop engine has attached this page yet (no-attached-engine).`;
    if (text.includes("BrowserSessionCommandUnsupported"))
      return `${label} needs the T3 Code desktop app, where the page renders (desktop-required).`;
    if (text.includes("BrowserStaleEngineGeneration"))
      return `${label} was not sent: the page's engine was replaced (stale-generation). Try again.`;
    if (text.includes("BrowserSessionNotFound"))
      return `${label} was not sent: the session is gone (session-not-found).`;
    const engineNotLive = /BrowserSessionEngineNotLive:.*\(([a-z-]+)\)/.exec(text);
    if (engineNotLive)
      return `${label} needs a live page; the page's engine is not live (${engineNotLive[1]}).`;
    return `${label} failed \u2014 ${text || "unknown error"}`;
  }
  function pageReceiptMessage(method, outcome) {
    const label = VERB_LABELS[method];
    switch (outcome) {
      case "accepted":
        return null;
      case "rejected":
        return `${label} was rejected by the browser engine.`;
      case "unknown":
        return `${label}: the browser engine did not answer (unknown). The page state will catch up from the session.`;
    }
  }
  async function runPageCommand(api, target, session, verb, signal) {
    const block = pageControlsBlock(session);
    if (block !== null) return { kind: "blocked", message: block };
    if (verb.method === "zoom" && !isLadderFactor(verb.zoomFactor))
      return {
        kind: "blocked",
        message: `${zoomPercent(verb.zoomFactor)} is not on the zoom ladder.`
      };
    const guard2 = {
      tabId: target.tabId,
      serverEpoch: target.serverEpoch,
      expectedEngineGeneration: target.engineGeneration
    };
    let receipt2;
    try {
      switch (verb.method) {
        case "zoom":
          receipt2 = await api.invoke("zoom", { ...guard2, zoomFactor: verb.zoomFactor }, signal);
          break;
        case "setAppearance":
          receipt2 = await api.invoke(
            "setAppearance",
            { ...guard2, appearance: verb.appearance },
            signal
          );
          break;
        case "setAudioMuted":
          receipt2 = await api.invoke("setAudioMuted", { ...guard2, muted: verb.muted }, signal);
          break;
        case "setPictureInPicture":
          receipt2 = await api.invoke("setPictureInPicture", { ...guard2, open: verb.open }, signal);
          break;
        default:
          receipt2 = await api.invoke(verb.method, guard2, signal);
      }
    } catch (error) {
      return { kind: "failed", message: pageCommandErrorMessage(verb.method, error) };
    }
    if (receipt2.outcome === "accepted") return { kind: "accepted", receipt: receipt2 };
    return {
      kind: receipt2.outcome,
      receipt: receipt2,
      message: pageReceiptMessage(verb.method, receipt2.outcome)
    };
  }

  // floating.ts
  function floatingLayers(overlayZIndex) {
    return { deviceChrome: overlayZIndex, transient: overlayZIndex + 1 };
  }
  var floatingOverPage = { [BROWSER_SURFACE_OVERLAY_ATTRIBUTE]: "" };

  // pageMenu.tsx
  var import_react6 = __toESM(require_react(), 1);
  var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
  var muted3 = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var border = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
  var control = {
    font: "inherit",
    fontSize: 12,
    padding: "2px 8px",
    border,
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  var APPEARANCE_OPTIONS = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" }
  ];
  var ZOOM_INDICATOR_MS = 1500;
  function ZoomIndicator(props) {
    const { zoomFactor, zIndex, style, visible } = props;
    const [shown, setShown] = (0, import_react6.useState)(null);
    const last = (0, import_react6.useRef)(zoomFactor);
    (0, import_react6.useEffect)(() => {
      if (zoomFactor === null || last.current === zoomFactor) {
        last.current = zoomFactor;
        return;
      }
      const first = last.current === null;
      last.current = zoomFactor;
      if (first) return;
      setShown(zoomFactor);
      const timer = setTimeout(() => setShown(null), ZOOM_INDICATOR_MS);
      return () => clearTimeout(timer);
    }, [zoomFactor]);
    if (shown === null || !visible) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "div",
      {
        role: "status",
        "aria-label": "Page zoom",
        ...floatingOverPage,
        style: {
          ...style,
          position: "absolute",
          top: 12,
          right: 12,
          zIndex,
          pointerEvents: "none",
          padding: "3px 10px",
          borderRadius: 999,
          border,
          fontSize: 12,
          fontWeight: 500,
          background: "var(--t3-browser-canvas, var(--background, #fff))"
        },
        children: zoomPercent(shown)
      }
    );
  }
  function PageMenu(props) {
    const { host, session, blockReason, run: run2, zoomStep, floating, visible, children } = props;
    const [open, setOpen] = (0, import_react6.useState)(false);
    if (open && !visible) setOpen(false);
    const [trigger, setTrigger] = (0, import_react6.useState)(null);
    const root = (0, import_react6.useRef)(null);
    const menu = (0, import_react6.useRef)(null);
    (0, import_react6.useEffect)(() => {
      if (!open) return;
      const onPointer = (event) => {
        const target = event.target;
        if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
      };
      const onKey = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", onPointer);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onPointer);
        document.removeEventListener("keydown", onKey);
      };
    }, [open]);
    const disabled = blockReason !== null;
    const zoom = session?.zoomFactor ?? null;
    const audioMuted = session?.audioMuted ?? null;
    const devToolsOpen = session?.devToolsOpen ?? null;
    const pictureInPicture = session?.pictureInPicture ?? null;
    const { Popover } = floating;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: root, style: { position: "relative" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Tooltip, { host, label: "More", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          ref: setTrigger,
          type: "button",
          "aria-label": "Preview menu",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          disabled: session === null,
          onClick: () => setOpen((value) => !value),
          style: control,
          children: "\u22EF"
        }
      ) }),
      open && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        Popover,
        {
          anchor: trigger,
          elementRef: (element) => {
            menu.current = element;
          },
          role: "menu",
          "aria-label": "Page",
          "data-t3-browser-popover": "",
          style: {
            ...floating.style,
            minWidth: 220,
            display: "grid",
            gap: 8,
            padding: 8,
            border,
            borderRadius: 8,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            color: "var(--t3-browser-text, var(--foreground, #20252d))",
            fontSize: 12
          },
          children: [
            blockReason && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "note", style: { margin: 0, color: muted3 }, children: blockReason }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "button",
              {
                type: "button",
                role: "menuitem",
                disabled,
                onClick: () => {
                  run2({ method: "hardReload" });
                  setOpen(false);
                },
                style: { ...control, textAlign: "left" },
                children: "Hard reload"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { style: { display: "flex", justifyContent: "space-between", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "Appearance" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
                "select",
                {
                  "aria-label": "Appearance",
                  disabled,
                  value: session?.appearance ?? "",
                  onChange: (event) => run2({ method: "setAppearance", appearance: event.target.value }),
                  style: control,
                  children: [
                    session?.appearance == null && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u2014" }),
                    APPEARANCE_OPTIONS.map((option2) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: option2.value, children: option2.label }, option2.value))
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { flex: 1 }, children: "Zoom" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  "aria-label": "Zoom out",
                  disabled,
                  onClick: () => zoomStep("out"),
                  style: control,
                  children: "\u2212"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
                "select",
                {
                  "aria-label": "Zoom level",
                  disabled,
                  value: zoom === null ? "" : String(zoom),
                  onChange: (event) => run2({ method: "zoom", zoomFactor: Number(event.target.value) }),
                  style: { ...control, fontVariantNumeric: "tabular-nums" },
                  children: [
                    zoom === null && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u2014" }),
                    ZOOM_LADDER.map((level) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: String(level), children: zoomPercent(level) }, level))
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  "aria-label": "Zoom in",
                  disabled,
                  onClick: () => zoomStep("in"),
                  style: control,
                  children: "+"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "button",
                {
                  type: "button",
                  "aria-label": "Reset zoom",
                  disabled: disabled || zoom === DEFAULT_ZOOM_FACTOR,
                  onClick: () => run2({ method: "zoom", zoomFactor: DEFAULT_ZOOM_FACTOR }),
                  style: control,
                  children: "\u21BA"
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "button",
              {
                type: "button",
                role: "menuitemcheckbox",
                "aria-checked": audioMuted === true,
                disabled: disabled || audioMuted === null,
                onClick: () => run2({ method: "setAudioMuted", muted: audioMuted !== true }),
                style: { ...control, textAlign: "left" },
                children: audioMuted ? "Unmute page" : "Mute page"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "button",
              {
                type: "button",
                role: "menuitemcheckbox",
                "aria-checked": devToolsOpen === true,
                disabled: disabled || devToolsOpen === null,
                onClick: () => {
                  run2({ method: devToolsOpen ? "closeDevTools" : "openDevTools" });
                  setOpen(false);
                },
                style: { ...control, textAlign: "left" },
                children: devToolsOpen ? "Close DevTools" : "Open DevTools"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "button",
              {
                type: "button",
                role: "menuitemcheckbox",
                "aria-checked": pictureInPicture === true,
                disabled: disabled || pictureInPicture === null,
                onClick: () => {
                  run2({ method: "setPictureInPicture", open: pictureInPicture !== true });
                  setOpen(false);
                },
                style: { ...control, textAlign: "left" },
                children: pictureInPicture ? "Close picture in picture" : "Pop out (picture in picture)"
              }
            ),
            children?.(() => setOpen(false))
          ]
        }
      )
    ] });
  }

  // popover.tsx
  var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
  function panelPopover(host, zIndex) {
    return resolveFloatingLayer(host)?.Popover ?? inlinePopover(zIndex);
  }
  function inlinePopover(zIndex) {
    return function InlinePopover({
      anchor,
      side = "bottom",
      align = "end",
      offset = 6,
      elementRef,
      style,
      ...attributes
    }) {
      if (anchor === null) return null;
      const inset = side === "inset" ? offset : 0;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "div",
        {
          ...attributes,
          ...floatingOverPage,
          ref: elementRef,
          style: {
            ...style,
            position: "absolute",
            ...side === "inset" ? { top: offset } : side === "top" ? { bottom: `calc(100% + ${offset}px)` } : { top: `calc(100% + ${offset}px)` },
            ...align === "start" ? { left: inset } : { right: inset },
            zIndex
          }
        }
      );
    };
  }

  // profileMenu.tsx
  var import_react7 = __toESM(require_react(), 1);

  // profiles.ts
  var DEFAULT_PROFILE_ID = "default";
  var ACTION_LABEL = {
    list: "Listing browser profiles",
    open: "Opening the page in another profile",
    clearCookies: "Clearing cookies",
    clearCache: "Clearing the cache",
    listImportSources: "Listing browsers to import from",
    importCookies: "Importing cookies"
  };
  function sessionProfileId(session) {
    return session?.profileId ?? DEFAULT_PROFILE_ID;
  }
  function profileLabel(list, profileId) {
    if (list === null) return profileId === DEFAULT_PROFILE_ID ? "Default" : profileId;
    return list.profiles.find((profile) => profile.id === profileId)?.name ?? "Removed profile";
  }
  function profileBadgeName(list, profileId) {
    if (list === null || profileId === list.defaultProfileId) return null;
    return profileLabel(list, profileId);
  }
  function profileFailureMessage(action, error) {
    const text = error instanceof Error ? error.message : String(error);
    const label = ACTION_LABEL[action];
    const denial = describeGrantDenial(error);
    if (denial) return `${label} \u2014 ${denial.message}`;
    if (text.includes("(desktop-required)")) {
      return `${label} needs the T3 Code desktop app \u2014 no desktop browser engine is connected (desktop-required).`;
    }
    if (text.includes("(engine-unsupported)")) {
      return `${label} is not supported by this desktop's browser engine (engine-unsupported).`;
    }
    if (text.includes("BrowserProfileNotFound")) {
      return `${label} failed \u2014 that browser profile no longer exists (profile-not-found).`;
    }
    if (text.includes("BrowserProfilesUnavailable")) {
      return `${label} failed \u2014 the desktop did not answer in time (unknown).`;
    }
    return `${label} failed${text ? ` \u2014 ${text.slice(0, 300)}` : ""}.`;
  }
  function clearResultMessage(result2, kind, profileName) {
    const what = kind === "clearCookies" ? "cookies" : "the cache";
    if (result2.outcome === "unknown") {
      return `The desktop did not confirm clearing ${what} for "${profileName}" (unknown) \u2014 it may or may not have happened.`;
    }
    return kind === "clearCookies" ? `Cookies cleared for "${profileName}" \u2014 every page in that profile is signed out.` : `Cache cleared for "${profileName}".`;
  }
  var IMPORT_FAILURE_COPY = {
    notInstalled: "that browser is not installed on the desktop",
    needsKeychainApproval: "the desktop needs Keychain access to read its cookies",
    keychainItemMissing: "no encryption key in the desktop's Keychain \u2014 sign in to that browser once",
    needsFullDiskAccess: "give T3 Code Full Disk Access on the desktop, then retry",
    browserRunning: "quit that browser on the desktop first",
    unsupportedPlatform: "importing from that browser isn't possible on the desktop's platform",
    keychainUnavailable: "the desktop's system keyring could not be accessed",
    unknownSource: "that browser is no longer available to import from",
    unknownSourceProfile: "that browser profile no longer exists",
    sessionUnavailable: "the target profile could not be opened",
    readFailed: "the browser's cookie database could not be read"
  };
  function importResultMessage(result2, profileName) {
    switch (result2.outcome) {
      case "imported":
        return `Imported ${result2.imported} cookie${result2.imported === 1 ? "" : "s"} into "${profileName}"${result2.skipped > 0 ? ` (${result2.skipped} skipped)` : ""}.`;
      case "declined":
        return "Cookie import was declined on the desktop.";
      case "unknown":
        return "The desktop did not answer the import (unknown) \u2014 check the T3 Code desktop app.";
      case "failed":
        return `Cookie import failed (${result2.reason}) \u2014 ${IMPORT_FAILURE_COPY[result2.reason]}.`;
    }
  }
  function importableSources(sources) {
    return sources.filter(
      (source) => source.unavailable !== "notInstalled" && source.unavailable !== "unsupportedPlatform"
    );
  }
  function reopenRequest(previous, url) {
    const profileId = sessionProfileId(previous);
    return profileId === DEFAULT_PROFILE_ID ? { api: "sessions", input: { url } } : { api: "profiles", input: { profileId, url } };
  }
  function sameProfileList(a, b) {
    return a === b || a !== null && b !== null && a.defaultProfileId === b.defaultProfileId && a.profiles.length === b.profiles.length && a.profiles.every(
      (profile, index) => profile.id === b.profiles[index].id && profile.name === b.profiles[index].name
    );
  }
  var DESKTOP_REQUIRED = new Error(
    "no desktop browser engine is connected to this environment (desktop-required)."
  );
  function createProfileListStore(source, signal) {
    let snapshot = { list: null, error: null };
    let mode = "idle";
    let read = 0;
    const listeners2 = /* @__PURE__ */ new Set();
    const set = (next) => {
      if (sameProfileList(snapshot.list, next.list) && snapshot.error === next.error) return;
      snapshot = sameProfileList(snapshot.list, next.list) ? { ...next, list: snapshot.list } : next;
      for (const listener of listeners2) listener();
    };
    const readList = () => {
      const current = ++read;
      void source.invoke("list", {}, signal).then(
        (list) => {
          if (current === read && mode === "reads") set({ list, error: null });
        },
        (error) => {
          if (current === read && mode === "reads") set({ list: null, error });
        }
      );
    };
    const watch = async () => {
      mode = "probing";
      const changes = await source.watch(signal).catch(() => null);
      if (signal.aborted) return;
      if (changes === null) {
        mode = "reads";
        readList();
        return;
      }
      mode = "live";
      try {
        for await (const change of changes) {
          set(
            change.list !== null ? { list: change.list, error: null } : { list: null, error: change.pending ? null : DESKTOP_REQUIRED }
          );
        }
      } catch (error) {
        if (!signal.aborted) set({ list: null, error });
      }
      if (!signal.aborted) mode = "idle";
    };
    return {
      subscribe(listener) {
        listeners2.add(listener);
        return () => listeners2.delete(listener);
      },
      getSnapshot: () => snapshot,
      refresh() {
        if (signal.aborted) return;
        if (mode === "idle") void watch();
        else if (mode === "reads") readList();
      }
    };
  }

  // profileMenu.tsx
  var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
  var CHANGES_RANGE = "^1.1.0";
  var bindProfilesApi = (host, context2) => ({
    ...bindApi(browserProfilesApi, host, context2),
    async watch(signal) {
      const selected = (await host.discoverApis(context2, signal)).find(
        (api) => api.id === BROWSER_PROFILES && api.selected
      );
      if (selected === void 0 || !satisfiesSemverRange(selected.version, CHANGES_RANGE)) {
        return null;
      }
      const frames = bindStreamApi(browserProfilesApi, host, context2, CHANGES_RANGE).subscribe(
        "changes",
        {},
        signal
      );
      return (async function* () {
        for await (const frame of frames) {
          if (frame.type === "closed") return;
          yield frame.value;
        }
      })();
    }
  });
  var useProfileList = (profiles) => (0, import_react7.useSyncExternalStore)(profiles.subscribe, profiles.getSnapshot);
  var muted4 = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var border2 = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
  var control2 = {
    font: "inherit",
    fontSize: 12,
    padding: "2px 8px",
    border: border2,
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  var PENDING = {
    clearCookies: "Clearing cookies\u2026",
    clearCache: "Clearing the cache\u2026",
    importCookies: "Importing \u2014 confirm the import in the T3 Code desktop app."
  };
  var firstProfile = (sources, sourceId) => sources.find((source) => source.id === sourceId)?.profiles[0]?.handle ?? "";
  function ProfileBadge(props) {
    const { host, session, profiles, visible } = props;
    const profileId = sessionProfileId(session);
    const { list } = useProfileList(profiles);
    (0, import_react7.useEffect)(() => {
      if (visible) profiles.refresh();
    }, [profiles, profileId, visible]);
    const name = profileBadgeName(list, profileId);
    if (name === null) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { host, label: name, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "span",
      {
        "data-t3-browser-profile-badge": true,
        style: {
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          maxWidth: 112,
          padding: "1px 6px",
          border: border2,
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 500,
          whiteSpace: "nowrap"
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: name })
      }
    ) });
  }
  function ProfileSection(props) {
    const { session, api, profiles, signal, onOpenInProfile, report, onChosen } = props;
    const profileId = sessionProfileId(session);
    const { list, error } = useProfileList(profiles);
    const listNote = list !== null ? null : error === null ? "Loading profiles\u2026" : profileFailureMessage("list", error);
    const [importer, setImporter] = (0, import_react7.useState)({ kind: "closed" });
    (0, import_react7.useEffect)(() => profiles.refresh(), [profiles]);
    const name = profileLabel(list, profileId);
    const choose = (action) => {
      onChosen();
      report(PENDING[action]);
    };
    const clear = (kind) => {
      choose(kind);
      void api.invoke(kind, { profileId }, signal).then(
        (result2) => report(clearResultMessage(result2, kind, name)),
        (error2) => report(profileFailureMessage(kind, error2))
      );
    };
    const openImporter = () => {
      setImporter({ kind: "loading" });
      void api.invoke("listImportSources", {}, signal).then(
        ({ sources }) => {
          const usable = importableSources(sources);
          const sourceId = usable[0]?.id ?? "";
          setImporter({
            kind: "ready",
            sources: usable,
            sourceId,
            handle: firstProfile(usable, sourceId)
          });
        },
        (error2) => setImporter({ kind: "failed", message: profileFailureMessage("listImportSources", error2) })
      );
    };
    const runImport = (sourceId, handle) => {
      choose("importCookies");
      void api.invoke("importCookies", { profileId, sourceId, sourceProfile: handle }, signal).then(
        (result2) => report(importResultMessage(result2, name)),
        (error2) => report(profileFailureMessage("importCookies", error2))
      );
    };
    const others = list?.profiles.filter((profile) => profile.id !== profileId) ?? [];
    const selectedSource = importer.kind === "ready" ? importer.sources.find((source) => source.id === importer.sourceId) : void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      "div",
      {
        role: "group",
        "aria-label": "Profile",
        style: { display: "grid", gap: 6, borderTop: border2, paddingTop: 8 },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "span",
            {
              style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: muted4 },
              children: [
                "Profile: ",
                name
              ]
            }
          ),
          listNote && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "note", style: { margin: 0, color: muted4 }, children: listNote }),
          others.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { style: { display: "flex", justifyContent: "space-between", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "Open page in" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "select",
              {
                "aria-label": "Open page in profile",
                value: "",
                onChange: (event) => {
                  if (!event.target.value) return;
                  onChosen();
                  onOpenInProfile(event.target.value);
                },
                style: { ...control2, maxWidth: 140 },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "Choose\u2026" }),
                  others.map((profile) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: profile.id, children: profile.name }, profile.id))
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "button",
            {
              type: "button",
              role: "menuitem",
              onClick: () => clear("clearCookies"),
              style: { ...control2, textAlign: "left" },
              children: "Clear cookies"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "button",
            {
              type: "button",
              role: "menuitem",
              onClick: () => clear("clearCache"),
              style: { ...control2, textAlign: "left" },
              children: "Clear cache"
            }
          ),
          importer.kind === "closed" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "button",
            {
              type: "button",
              role: "menuitem",
              onClick: openImporter,
              style: { ...control2, textAlign: "left" },
              children: "Import cookies\u2026"
            }
          ) : importer.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "note", style: { margin: 0, color: muted4 }, children: "Listing browsers on the desktop\u2026" }) : importer.kind === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "note", style: { margin: 0, color: muted4 }, children: importer.message }) : importer.sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "note", style: { margin: 0, color: muted4 }, children: "No browser on the desktop can be imported from." }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "grid", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "select",
              {
                "aria-label": "Import from browser",
                value: importer.sourceId,
                onChange: (event) => setImporter({
                  ...importer,
                  sourceId: event.target.value,
                  handle: firstProfile(importer.sources, event.target.value)
                }),
                style: control2,
                children: importer.sources.map((source) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: source.id, children: source.name }, source.id))
              }
            ),
            selectedSource?.unavailable ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "note", style: { margin: 0, color: muted4 }, children: importResultMessage(
              { outcome: "failed", profileId, reason: selectedSource.unavailable },
              name
            ) }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "select",
              {
                "aria-label": "Import from browser profile",
                value: importer.handle,
                onChange: (event) => setImporter({ ...importer, handle: event.target.value }),
                style: control2,
                children: selectedSource?.profiles.map((profile) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: profile.handle, children: profile.cookieCount === void 0 ? profile.name : `${profile.name} (${profile.cookieCount} cookies)` }, profile.handle))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "button",
              {
                type: "button",
                role: "menuitem",
                disabled: !importer.handle || selectedSource?.unavailable !== void 0,
                onClick: () => runImport(importer.sourceId, importer.handle),
                style: { ...control2, textAlign: "left" },
                children: [
                  "Import into ",
                  name
                ]
              }
            )
          ] })
        ]
      }
    );
  }

  // viewportToolbar.tsx
  var import_react8 = __toESM(require_react(), 1);

  // viewport.ts
  var PREVIEW_VIEWPORT_MIN_DIMENSION = 240;
  var PREVIEW_VIEWPORT_MAX_DIMENSION = 3840;
  var PREVIEW_VIEWPORT_MAX_AREA = 3840 * 2160;
  var DEVICE_TOOLBAR_HEIGHT = 32;
  var DEVICE_VIEWPORT_RAIL = 10;
  var VIEWPORT_COMMIT_TIMEOUT_MS = 15e3;
  var FALLBACK_RESPONSIVE_VIEWPORT_SIZE = { width: 1024, height: 768 };
  var PREVIEW_VIEWPORT_PRESETS = [
    { id: "iphone-se", label: "iPhone SE", detail: "375 \xD7 667", width: 375, height: 667 },
    { id: "iphone-xr", label: "iPhone XR", detail: "414 \xD7 896", width: 414, height: 896 },
    { id: "iphone-12-pro", label: "iPhone 12 Pro", detail: "390 \xD7 844", width: 390, height: 844 },
    {
      id: "iphone-14-pro-max",
      label: "iPhone 14 Pro Max",
      detail: "430 \xD7 932",
      width: 430,
      height: 932
    },
    { id: "pixel-7", label: "Pixel 7", detail: "412 \xD7 915", width: 412, height: 915 },
    {
      id: "samsung-galaxy-s8-plus",
      label: "Samsung Galaxy S8+",
      detail: "360 \xD7 740",
      width: 360,
      height: 740
    },
    {
      id: "samsung-galaxy-s20-ultra",
      label: "Samsung Galaxy S20 Ultra",
      detail: "412 \xD7 915",
      width: 412,
      height: 915
    },
    { id: "ipad-mini", label: "iPad Mini", detail: "768 \xD7 1024", width: 768, height: 1024 },
    { id: "ipad-air", label: "iPad Air", detail: "820 \xD7 1180", width: 820, height: 1180 },
    { id: "ipad-pro", label: "iPad Pro", detail: "1024 \xD7 1366", width: 1024, height: 1366 },
    {
      id: "surface-pro-7",
      label: "Surface Pro 7",
      detail: "912 \xD7 1368",
      width: 912,
      height: 1368
    },
    { id: "surface-duo", label: "Surface Duo", detail: "540 \xD7 720", width: 540, height: 720 },
    {
      id: "galaxy-z-fold-5",
      label: "Galaxy Z Fold 5",
      detail: "344 \xD7 882",
      width: 344,
      height: 882
    },
    {
      id: "asus-zenbook-fold",
      label: "Asus Zenbook Fold",
      detail: "853 \xD7 1280",
      width: 853,
      height: 1280
    },
    {
      id: "samsung-galaxy-a51-71",
      label: "Samsung Galaxy A51/71",
      detail: "412 \xD7 914",
      width: 412,
      height: 914
    },
    { id: "nest-hub", label: "Nest Hub", detail: "1024 \xD7 600", width: 1024, height: 600 },
    { id: "nest-hub-max", label: "Nest Hub Max", detail: "1280 \xD7 800", width: 1280, height: 800 }
  ];
  var viewportSettingKey = (setting) => setting._tag === "fill" ? "fill" : `${setting._tag}:${setting.width}:${setting.height}:${setting._tag === "preset" ? setting.presetId : ""}`;
  var clampDimension = (value) => Math.min(PREVIEW_VIEWPORT_MAX_DIMENSION, Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, value));
  function clampViewportSize(size) {
    const width = clampDimension(Math.round(size.width));
    const height = clampDimension(Math.round(size.height));
    if (width * height <= PREVIEW_VIEWPORT_MAX_AREA) return { width, height };
    return {
      width: Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, Math.floor(PREVIEW_VIEWPORT_MAX_AREA / height)),
      height
    };
  }
  function responsiveViewportForToggle(panel) {
    const size = panel === null ? FALLBACK_RESPONSIVE_VIEWPORT_SIZE : clampViewportSize({
      width: panel.width - DEVICE_VIEWPORT_RAIL * 2,
      height: panel.height - DEVICE_TOOLBAR_HEIGHT - DEVICE_VIEWPORT_RAIL
    });
    return { _tag: "freeform", ...size };
  }
  function validFreeformSize(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width >= PREVIEW_VIEWPORT_MIN_DIMENSION && width <= PREVIEW_VIEWPORT_MAX_DIMENSION && height >= PREVIEW_VIEWPORT_MIN_DIMENSION && height <= PREVIEW_VIEWPORT_MAX_DIMENSION && width * height <= PREVIEW_VIEWPORT_MAX_AREA;
  }
  function presetViewport(presetId) {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return null;
    return { _tag: "preset", width: preset.width, height: preset.height, presetId: preset.id };
  }
  function freeformFromSetting(setting) {
    return { _tag: "freeform", width: setting.width, height: setting.height };
  }
  function rotateViewport(setting, pendingSize) {
    const source = pendingSize !== null && validFreeformSize(pendingSize.width, pendingSize.height) && (pendingSize.width !== setting.width || pendingSize.height !== setting.height) ? { _tag: "freeform", width: pendingSize.width, height: pendingSize.height } : setting;
    return { ...source, width: source.height, height: source.width };
  }
  var ViewportTargetChangedError = class extends Error {
    name = "ViewportTargetChangedError";
    constructor() {
      super("The browser session changed before the resize ran");
    }
  };
  var ViewportCommitTimeoutError = class extends Error {
    name = "ViewportCommitTimeoutError";
    constructor() {
      super("Timed out committing the browser viewport");
    }
  };
  function createViewportCommitter(resize, timeoutMs = VIEWPORT_COMMIT_TIMEOUT_MS) {
    let tail = Promise.resolve();
    const commit2 = (viewport, signal, target) => {
      const run2 = tail.then(() => {
        let timeoutId;
        const timeout2 = new Promise((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new ViewportCommitTimeoutError()), timeoutMs);
        });
        return Promise.race([resize(viewport, signal, target), timeout2]).finally(() => {
          if (timeoutId !== void 0) clearTimeout(timeoutId);
        });
      });
      tail = run2.then(
        () => void 0,
        () => void 0
      );
      return run2;
    };
    return { commit: commit2 };
  }
  function deviceViewportArea(slot) {
    return {
      width: Math.max(1, slot.width - DEVICE_VIEWPORT_RAIL * 2),
      height: Math.max(1, slot.height - DEVICE_TOOLBAR_HEIGHT - DEVICE_VIEWPORT_RAIL)
    };
  }
  var normalizeZoomFactor = (zoomFactor) => Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  function deviceViewportLayout(slot, setting, zoomFactor = 1) {
    const unrounded = deviceViewportArea(slot);
    const area = {
      width: Math.max(1, Math.round(unrounded.width)),
      height: Math.max(1, Math.round(unrounded.height))
    };
    const zoom = normalizeZoomFactor(zoomFactor);
    const renderedWidth = setting.width * zoom;
    const renderedHeight = setting.height * zoom;
    const scale = Math.min(1, area.width / renderedWidth, area.height / renderedHeight);
    const width = renderedWidth * scale;
    const height = renderedHeight * scale;
    return {
      x: DEVICE_VIEWPORT_RAIL + Math.max(0, Math.round((area.width - width) / 2)),
      y: DEVICE_TOOLBAR_HEIGHT + Math.max(0, Math.round((area.height - height) / 2)),
      width,
      height,
      scale
    };
  }
  var VIEWPORT_RAIL_KEY_COMMIT_DELAY_MS = 150;
  var controlsWidth = (direction) => direction.includes("east") || direction.includes("west");
  var controlsHeight = (direction) => direction.includes("south");
  var validAspectRatio = (aspectRatio) => aspectRatio !== null && aspectRatio !== void 0 && Number.isFinite(aspectRatio) && aspectRatio > 0;
  function resizeAtAspectRatio(desired, aspectRatio, primaryAxis) {
    if (primaryAxis === "width") {
      const minimum2 = Math.ceil(
        Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, PREVIEW_VIEWPORT_MIN_DIMENSION * aspectRatio)
      );
      const maximum2 = Math.floor(
        Math.min(
          PREVIEW_VIEWPORT_MAX_DIMENSION,
          PREVIEW_VIEWPORT_MAX_DIMENSION * aspectRatio,
          Math.sqrt(PREVIEW_VIEWPORT_MAX_AREA * aspectRatio)
        )
      );
      let width2 = Math.min(maximum2, Math.max(minimum2, Math.round(desired)));
      let height2 = Math.round(width2 / aspectRatio);
      while (width2 * height2 > PREVIEW_VIEWPORT_MAX_AREA && width2 > minimum2) {
        width2 -= 1;
        height2 = Math.round(width2 / aspectRatio);
      }
      return { width: width2, height: height2 };
    }
    const minimum = Math.ceil(
      Math.max(PREVIEW_VIEWPORT_MIN_DIMENSION, PREVIEW_VIEWPORT_MIN_DIMENSION / aspectRatio)
    );
    const maximum = Math.floor(
      Math.min(
        PREVIEW_VIEWPORT_MAX_DIMENSION,
        PREVIEW_VIEWPORT_MAX_DIMENSION / aspectRatio,
        Math.sqrt(PREVIEW_VIEWPORT_MAX_AREA / aspectRatio)
      )
    );
    let height = Math.min(maximum, Math.max(minimum, Math.round(desired)));
    let width = Math.round(height * aspectRatio);
    while (width * height > PREVIEW_VIEWPORT_MAX_AREA && height > minimum) {
      height -= 1;
      width = Math.round(height * aspectRatio);
    }
    return { width, height };
  }
  function lockedAspectRatio(setting, locked) {
    return locked && setting !== null ? setting.width / setting.height : null;
  }
  function resizeViewportBy(start, delta, direction, aspectRatio = null) {
    const horizontal = direction.includes("east") ? delta.x : direction.includes("west") ? -delta.x : 0;
    const vertical = direction.includes("south") ? delta.y : 0;
    if (validAspectRatio(aspectRatio)) {
      const desiredWidth = start.width + horizontal;
      const desiredHeight = start.height + vertical;
      const leadsWidth = horizontal !== 0 || direction === "east" || direction === "west";
      const leadsHeight = vertical !== 0 || direction === "south";
      const primaryAxis = leadsWidth && !leadsHeight ? "width" : leadsHeight && !leadsWidth ? "height" : Math.abs(desiredWidth - start.width) / start.width >= Math.abs(desiredHeight - start.height) / start.height ? "width" : "height";
      return resizeAtAspectRatio(
        primaryAxis === "width" ? desiredWidth : desiredHeight,
        aspectRatio,
        primaryAxis
      );
    }
    let width = clampDimension(Math.round(start.width + horizontal));
    let height = clampDimension(Math.round(start.height + vertical));
    if (width * height <= PREVIEW_VIEWPORT_MAX_AREA) return { width, height };
    if (Math.abs(horizontal) >= Math.abs(vertical)) {
      width = Math.max(
        PREVIEW_VIEWPORT_MIN_DIMENSION,
        Math.floor(PREVIEW_VIEWPORT_MAX_AREA / height)
      );
    } else {
      height = Math.max(
        PREVIEW_VIEWPORT_MIN_DIMENSION,
        Math.floor(PREVIEW_VIEWPORT_MAX_AREA / width)
      );
    }
    return { width, height };
  }
  var resizeFromEndRail = (start, pointerDelta, available) => {
    const startEdge = start < available ? (available + start) / 2 : start;
    const targetEdge = startEdge + pointerDelta;
    return targetEdge <= available ? targetEdge * 2 - available : targetEdge;
  };
  var resizeFromStartRail = (start, pointerDelta, available) => {
    if (start > available) {
      const distanceToFit = start - available;
      return pointerDelta <= distanceToFit ? start - pointerDelta : available - (pointerDelta - distanceToFit) * 2;
    }
    const targetEdge = (available - start) / 2 + pointerDelta;
    return targetEdge >= 0 ? available - targetEdge * 2 : available - targetEdge;
  };
  function resizeViewportFromRail(start, pointerDelta, available, renderScale, direction, aspectRatio = null) {
    const scale = normalizeZoomFactor(renderScale);
    const startWidth = start.width * scale;
    const startHeight = start.height * scale;
    const desiredWidth = direction.includes("east") ? resizeFromEndRail(startWidth, pointerDelta.x, available.width) : direction.includes("west") ? resizeFromStartRail(startWidth, pointerDelta.x, available.width) : startWidth;
    const desiredHeight = direction.includes("south") ? resizeFromEndRail(startHeight, pointerDelta.y, available.height) : startHeight;
    const widthDelta = (desiredWidth - startWidth) / scale;
    const heightDelta = (desiredHeight - startHeight) / scale;
    return resizeViewportBy(
      start,
      { x: direction.includes("west") ? -widthDelta : widthDelta, y: heightDelta },
      direction,
      aspectRatio
    );
  }
  function railKeyDelta(direction, key, shiftKey) {
    const step = shiftKey ? 50 : 10;
    if (key === "ArrowLeft" && controlsWidth(direction)) return { x: -step, y: 0 };
    if (key === "ArrowRight" && controlsWidth(direction)) return { x: step, y: 0 };
    if (key === "ArrowUp" && controlsHeight(direction)) return { x: 0, y: -step };
    if (key === "ArrowDown" && controlsHeight(direction)) return { x: 0, y: step };
    return null;
  }
  function createViewportDragCoalescer(dispatch) {
    let inFlightKey = null;
    let waiting = null;
    let idleWaiters = [];
    const keyOf = (viewport, target) => `${target ?? ""}|${viewportSettingKey(viewport)}`;
    const send = (viewport, target) => {
      inFlightKey = keyOf(viewport, target);
      const next = () => {
        inFlightKey = null;
        const queued = waiting;
        waiting = null;
        if (queued) {
          send(queued.viewport, queued.target);
          return;
        }
        const resolvers = idleWaiters;
        idleWaiters = [];
        for (const resolve2 of resolvers) resolve2();
      };
      void Promise.resolve().then(() => dispatch(viewport, target)).then(next, next);
    };
    return {
      push: (viewport, target) => {
        if (inFlightKey === null) {
          send(viewport, target);
          return;
        }
        waiting = keyOf(viewport, target) === inFlightKey ? null : { viewport, target };
      },
      drop: () => {
        waiting = null;
      },
      whenIdle: () => inFlightKey === null ? Promise.resolve() : new Promise((resolve2) => {
        idleWaiters.push(resolve2);
      })
    };
  }
  function createRailGestures(setPreview) {
    let commit2 = () => Promise.resolve(false);
    let gesture = null;
    const coalescer = createViewportDragCoalescer((viewport, target) => {
      const owner = gesture && gesture.target === target ? gesture : null;
      const entry = { key: viewportSettingKey(viewport) };
      owner?.expected.push(entry);
      return commit2(viewport, target ?? "").then((applied) => {
        if (applied || gesture === null) return;
        const index = gesture.expected.indexOf(entry);
        if (index >= 0) gesture.expected.splice(index, 1);
      });
    });
    let version2 = 0;
    const release = () => {
      if (!gesture) return;
      gesture.cleanup?.();
      gesture.cleanup = null;
      if (gesture.keyTimer !== null) clearTimeout(gesture.keyTimer);
      gesture.keyTimer = null;
    };
    const abort = () => {
      release();
      version2 += 1;
      coalescer.drop();
      gesture = null;
      setPreview(null);
    };
    return {
      /** `next` resolves true when the server accepted the resize. */
      bindCommit: (next) => {
        commit2 = next;
      },
      /**
       * Start a gesture at `start`, or with `continueLive` extend the live one
       * (a burst of arrow keys). A new gesture inherits the settling one's
       * keys so its still-landing commits are not mistaken for foreign ones.
       */
      begin: (target, start, continueLive) => {
        release();
        version2 += 1;
        const previous = gesture;
        if (continueLive && previous && previous.target === target) return previous;
        gesture = {
          target,
          start,
          expected: previous && previous.target === target ? [...previous.expected] : [{ key: viewportSettingKey(start) }],
          cleanup: null,
          keyTimer: null
        };
        return gesture;
      },
      input: (target, next) => {
        if (gesture !== target) return;
        version2 += 1;
        setPreview(next);
      },
      push: (target, viewport) => {
        if (gesture !== target) return;
        coalescer.push(viewport, target.target);
      },
      /**
       * Clear the preview once every commit the gesture made has settled —
       * unless newer input arrived meanwhile.
       */
      settle: () => {
        const settling = ++version2;
        void coalescer.whenIdle().then(() => {
          if (version2 !== settling) return;
          gesture = null;
          setPreview(null);
        });
      },
      /**
       * A setting from anywhere else (another client, the events stream, the
       * toolbar) retires the gesture, like native's source-key check.
       */
      observe: (target, key) => {
        if (!gesture) return;
        const landed = key === null ? -1 : gesture.expected.findIndex((entry) => entry.key === key);
        if (target !== gesture.target || landed < 0) {
          abort();
          return;
        }
        gesture.expected.splice(0, landed);
      },
      abort,
      dispose: () => {
        release();
        version2 += 1;
        coalescer.drop();
        gesture = null;
      }
    };
  }
  function viewportFailureMessage(error) {
    return error instanceof Error ? error.message : "An error occurred.";
  }
  async function notifyViewportResizeFailure(notifications, threadId, error, signal) {
    await notifications.invoke(
      "notify",
      {
        severity: "error",
        title: "Unable to resize browser viewport",
        ...error instanceof Error ? { body: error.message } : {},
        threadId,
        anchor: "thread"
      },
      signal
    );
  }

  // viewportToolbar.tsx
  var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
  var muted5 = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var border3 = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
  var chromeButton = {
    font: "inherit",
    fontSize: 12,
    lineHeight: 1,
    padding: "3px 6px",
    border: border3,
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  var numberInput = {
    font: "inherit",
    fontSize: 12,
    width: 52,
    padding: "2px 4px",
    border: border3,
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  function useElementSize(element) {
    const [size, setSize] = (0, import_react8.useState)(
      null
    );
    (0, import_react8.useEffect)(() => {
      if (!element) return;
      const observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (!box) return;
        setSize(
          (current) => current !== null && current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height }
        );
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, [element]);
    return size;
  }
  function AspectLockIcon(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "svg",
      {
        "aria-hidden": true,
        width: 12,
        height: 12,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        style: { display: "block" },
        children: props.locked ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M15 7h2a5 5 0 1 1 0 10h-2" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("line", { x1: "8", x2: "16", y1: "12", y2: "12" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2" })
      }
    );
  }
  function useAspectLocks(tabs, held) {
    const [locks, setLocks] = (0, import_react8.useState)(() => /* @__PURE__ */ new Map());
    const live = (tabId) => held?.tabId === tabId || tabs.some((tab) => tab.tabId === tabId);
    return {
      isLocked: (tab) => tab !== null && locks.get(tab.tabId) === tab.serverEpoch && live(tab.tabId),
      setLocked: (tab, locked) => setLocks((current) => {
        const next = new Map([...current].filter(([tabId]) => live(tabId)));
        if (locked) next.set(tab.tabId, tab.serverEpoch);
        else next.delete(tab.tabId);
        return next;
      })
    };
  }
  function BrowserViewportToolbar(props) {
    const { host, setting, pending, onCommit, aspectLocked, onAspectLockedChange, zIndex } = props;
    const aspectRatio = lockedAspectRatio(setting, aspectLocked);
    const [edit, setEdit] = (0, import_react8.useState)(null);
    const committedKey = viewportSettingKey(setting);
    const customSize = edit !== null && edit.key === committedKey ? { width: edit.width, height: edit.height } : null;
    const presentedSize = customSize ?? {
      width: String(setting.width),
      height: String(setting.height)
    };
    const customWidth = Number(presentedSize.width);
    const customHeight = Number(presentedSize.height);
    const customValid = validFreeformSize(customWidth, customHeight);
    const selectedValue = setting._tag === "preset" && PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId) ? setting.presetId : "responsive";
    const applyCustomSize = () => {
      if (!customValid || customWidth === setting.width && customHeight === setting.height) {
        setEdit(null);
        return;
      }
      void onCommit({ _tag: "freeform", width: customWidth, height: customHeight });
    };
    const keepFocus = (event) => event.preventDefault();
    const updateDimension = (axis, value) => {
      setEdit((current) => {
        const kept = current && current.key === committedKey ? current : null;
        const next = {
          key: committedKey,
          width: axis === "width" ? value : kept?.width ?? String(setting.width),
          height: axis === "height" ? value : kept?.height ?? String(setting.height)
        };
        const numeric = Number(value);
        if (aspectRatio === null || !Number.isInteger(numeric) || numeric < PREVIEW_VIEWPORT_MIN_DIMENSION || numeric > PREVIEW_VIEWPORT_MAX_DIMENSION)
          return next;
        const resized = resizeViewportBy(
          setting,
          axis === "width" ? { x: numeric - setting.width, y: 0 } : { x: 0, y: numeric - setting.height },
          axis === "width" ? "east" : "south",
          aspectRatio
        );
        return { key: committedKey, width: String(resized.width), height: String(resized.height) };
      });
    };
    const selectViewport = (value) => {
      if (value === "responsive") {
        if (setting._tag === "freeform") return;
        void onCommit(freeformFromSetting(setting));
        return;
      }
      const preset = presetViewport(value);
      if (preset) void onCommit(preset);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "div",
      {
        role: "toolbar",
        "aria-label": "Browser device toolbar",
        ...floatingOverPage,
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: DEVICE_TOOLBAR_HEIGHT,
          zIndex,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 6px",
          boxSizing: "border-box",
          background: "var(--t3-browser-canvas, var(--background, #fff))",
          borderBottom: border3,
          overflowX: "auto",
          whiteSpace: "nowrap"
        },
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          applyCustomSize();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "select",
            {
              "aria-label": "Browser device preset",
              value: selectedValue,
              disabled: pending,
              onChange: (event) => selectViewport(event.target.value),
              style: { ...chromeButton, padding: "2px 4px" },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "responsive", children: "Responsive" }),
                PREVIEW_VIEWPORT_PRESETS.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: preset.id, children: `${preset.label} \u2014 ${preset.detail}` }, preset.id))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "form",
            {
              style: { display: "flex", alignItems: "center", gap: 4, margin: 0 },
              "aria-label": "Viewport dimensions",
              onSubmit: (event) => {
                event.preventDefault();
                applyCustomSize();
              },
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                applyCustomSize();
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "input",
                  {
                    type: "number",
                    inputMode: "numeric",
                    min: PREVIEW_VIEWPORT_MIN_DIMENSION,
                    max: PREVIEW_VIEWPORT_MAX_DIMENSION,
                    value: presentedSize.width,
                    disabled: pending,
                    onFocus: () => setEdit(
                      (current) => current && current.key === committedKey ? current : {
                        key: committedKey,
                        width: String(setting.width),
                        height: String(setting.height)
                      }
                    ),
                    onChange: (event) => updateDimension("width", event.target.value),
                    "aria-label": "Viewport width",
                    "aria-invalid": !customValid,
                    style: numberInput
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": true, style: { color: muted5, fontSize: 11 }, children: "\xD7" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "input",
                  {
                    type: "number",
                    inputMode: "numeric",
                    min: PREVIEW_VIEWPORT_MIN_DIMENSION,
                    max: PREVIEW_VIEWPORT_MAX_DIMENSION,
                    value: presentedSize.height,
                    disabled: pending,
                    onFocus: () => setEdit(
                      (current) => current && current.key === committedKey ? current : {
                        key: committedKey,
                        width: String(setting.width),
                        height: String(setting.height)
                      }
                    ),
                    onChange: (event) => updateDimension("height", event.target.value),
                    "aria-label": "Viewport height",
                    "aria-invalid": !customValid,
                    style: numberInput
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Tooltip, { host, label: aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              type: "button",
              "aria-label": aspectLocked ? "Unlock viewport aspect ratio" : "Lock viewport aspect ratio",
              "aria-pressed": aspectLocked,
              disabled: pending || !customValid,
              onMouseDown: keepFocus,
              onClick: () => onAspectLockedChange(!aspectLocked),
              style: {
                ...chromeButton,
                ...aspectLocked ? { background: "var(--t3-browser-border, var(--border, #dfe3e8))" } : {}
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(AspectLockIcon, { locked: aspectLocked })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              type: "button",
              "aria-label": "Rotate viewport",
              disabled: pending,
              onMouseDown: keepFocus,
              onClick: () => void onCommit(
                rotateViewport(
                  setting,
                  customValid ? { width: customWidth, height: customHeight } : null
                )
              ),
              style: chromeButton,
              children: "\u27F3"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              type: "button",
              "aria-label": "Close device toolbar",
              disabled: pending,
              onMouseDown: keepFocus,
              onClick: () => {
                setEdit(null);
                void onCommit({ _tag: "fill" }).then((accepted) => {
                  if (accepted) onAspectLockedChange(false);
                });
              },
              style: { ...chromeButton, marginLeft: "auto" },
              children: "\xD7"
            }
          )
        ]
      }
    );
  }
  function ViewportDeviceFrame(props) {
    const { slot, setting, fallbackSlot, zoomFactor, zIndex } = props;
    const layout = deviceViewportLayout(
      slot ?? fallbackSlot,
      setting,
      zoomFactor
    );
    const percent = Math.round(layout.scale * 100);
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "div",
        {
          "aria-hidden": true,
          style: {
            position: "absolute",
            left: layout.x,
            top: layout.y,
            width: layout.width,
            height: layout.height,
            border: border3,
            borderRadius: 6,
            boxShadow: "0 1px 4px rgba(15, 23, 42, 0.18)",
            pointerEvents: "none",
            zIndex,
            boxSizing: "border-box"
          }
        }
      ),
      layout.scale < 1 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          "aria-label": `Viewport scaled to ${percent}%`,
          style: {
            position: "absolute",
            left: layout.x + layout.width - 4,
            top: layout.y + layout.height + 6,
            transform: "translateX(-100%)",
            padding: "1px 6px",
            fontSize: 11,
            color: muted5,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            border: border3,
            borderRadius: 999,
            pointerEvents: "none",
            zIndex
          },
          children: [
            percent,
            "%"
          ]
        }
      ) : null
    ] });
  }
  function useViewportRails(options) {
    const { setting, target, slot, zoomFactor, aspectRatio, commit: commit2 } = options;
    const [preview, setPreview] = (0, import_react8.useState)(null);
    const [gestures] = (0, import_react8.useState)(() => createRailGestures(setPreview));
    (0, import_react8.useEffect)(() => gestures.bindCommit(commit2), [gestures, commit2]);
    const committedKey = setting === null ? null : viewportSettingKey(setting);
    (0, import_react8.useEffect)(() => gestures.observe(target, committedKey), [gestures, target, committedKey]);
    (0, import_react8.useEffect)(() => () => gestures.dispose(), [gestures]);
    const displayed = setting === null ? null : preview === null ? setting : { _tag: "freeform", width: preview.width, height: preview.height };
    const onPointerDown = (direction, event) => {
      if (displayed === null || setting === null || target === null) return;
      event.preventDefault();
      event.stopPropagation();
      const gesture = gestures.begin(target, displayed, false);
      const pointerId = event.pointerId;
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      const start = { width: displayed.width, height: displayed.height };
      const area = deviceViewportArea(slot);
      const renderScale = zoomFactor * deviceViewportLayout(slot, start, zoomFactor).scale;
      let latest = start;
      let moved = false;
      gestures.input(gesture, { ...start, direction });
      try {
        handle.setPointerCapture(pointerId);
      } catch {
      }
      const move = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        const next = resizeViewportFromRail(
          start,
          { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY },
          area,
          renderScale,
          direction,
          aspectRatio
        );
        if (next.width === latest.width && next.height === latest.height) return;
        latest = next;
        moved = true;
        gestures.input(gesture, { ...next, direction });
        gestures.push(gesture, { _tag: "freeform", ...next });
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        gesture.cleanup = null;
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
        }
      };
      function finish(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        cleanup();
        if (moved && latest.width === start.width && latest.height === start.height) {
          gestures.push(gesture, gesture.start);
        }
        gestures.settle();
      }
      function cancel(cancelEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        cleanup();
        if (moved) gestures.push(gesture, gesture.start);
        gestures.settle();
      }
      gesture.cleanup = cleanup;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    };
    const onKeyDown = (direction, event) => {
      if (displayed === null || setting === null || target === null) return;
      const delta = railKeyDelta(direction, event.key, event.shiftKey);
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const next = resizeViewportBy(displayed, delta, direction, aspectRatio);
      if (next.width === displayed.width && next.height === displayed.height) return;
      const gesture = gestures.begin(target, displayed, true);
      gestures.input(gesture, { ...next, direction });
      gesture.keyTimer = setTimeout(() => {
        gesture.keyTimer = null;
        gestures.push(gesture, { _tag: "freeform", ...next });
        gestures.settle();
      }, VIEWPORT_RAIL_KEY_COMMIT_DELAY_MS);
    };
    return { displayed, preview, onPointerDown, onKeyDown, cancel: gestures.abort };
  }
  var RAILS = [
    { direction: "west", label: "left edge", kind: "vertical", cursor: "ew-resize" },
    { direction: "east", label: "right edge", kind: "vertical", cursor: "ew-resize" },
    { direction: "south", label: "bottom edge", kind: "horizontal", cursor: "ns-resize" },
    { direction: "southwest", label: "bottom-left corner", kind: "corner", cursor: "nesw-resize" },
    { direction: "southeast", label: "bottom-right corner", kind: "corner", cursor: "nwse-resize" }
  ];
  var railBox = (direction, layout) => {
    const rail = DEVICE_VIEWPORT_RAIL;
    const right = layout.x + layout.width;
    const bottom = layout.y + layout.height;
    switch (direction) {
      case "west":
        return { left: layout.x - rail, top: layout.y, width: rail, height: layout.height };
      case "east":
        return { left: right, top: layout.y, width: rail, height: layout.height };
      case "south":
        return { left: layout.x, top: bottom, width: layout.width, height: rail };
      case "southwest":
        return { left: layout.x - rail, top: bottom, width: rail, height: rail };
      case "southeast":
        return { left: right, top: bottom, width: rail, height: rail };
    }
  };
  var grip = (kind, active) => ({
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: kind === "corner" ? "translate(-50%, -50%) rotate(-45deg)" : "translate(-50%, -50%)",
    width: kind === "vertical" ? 3 : kind === "horizontal" ? 24 : 10,
    height: kind === "vertical" ? 24 : kind === "horizontal" ? 3 : 1,
    borderLeft: kind === "vertical" ? "1px solid currentColor" : void 0,
    borderRight: kind === "vertical" ? "1px solid currentColor" : void 0,
    borderTop: kind === "horizontal" || kind === "corner" ? "1px solid currentColor" : void 0,
    borderBottom: kind === "horizontal" ? "1px solid currentColor" : void 0,
    boxSizing: "border-box",
    color: active ? "var(--t3-browser-foreground, var(--foreground, #101828))" : muted5,
    pointerEvents: "none"
  });
  function ViewportResizeRails(props) {
    const { layout, preview, onPointerDown, onKeyDown } = props;
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      RAILS.map((rail) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          type: "button",
          "aria-label": `Resize browser viewport from ${rail.label}. Use arrow keys to resize.`,
          onPointerDown: (event) => onPointerDown(rail.direction, event),
          onKeyDown: (event) => onKeyDown(rail.direction, event),
          style: {
            position: "absolute",
            ...railBox(rail.direction, layout),
            zIndex: rail.kind === "corner" ? 42 : 41,
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: rail.cursor,
            touchAction: "none"
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": true, style: grip(rail.kind, preview?.direction === rail.direction) })
        },
        rail.direction
      )),
      preview ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          "aria-hidden": true,
          style: {
            position: "absolute",
            left: layout.x + layout.width / 2,
            top: layout.y + 10,
            transform: "translateX(-50%)",
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            border: border3,
            borderRadius: 6,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            boxShadow: "0 1px 4px rgba(15, 23, 42, 0.18)",
            pointerEvents: "none",
            zIndex: 43
          },
          children: [
            preview.width,
            " \xD7 ",
            preview.height
          ]
        }
      ) : null
    ] });
  }

  // uiContracts.ts
  var BROWSER_SURFACE_ID = "t3.browser/view";
  var BROWSER_THEME_VARS = {
    text: "--t3-browser-text",
    mutedForeground: "--t3-browser-muted-foreground",
    border: "--t3-browser-border",
    canvas: "--t3-browser-canvas"
  };
  function themeVarOverrides(tokens, cssVars) {
    const overrides = {};
    for (const [role, property] of Object.entries(BROWSER_THEME_VARS)) {
      const value = tokens[role];
      if (value === void 0) continue;
      const contractVar = cssVars[role];
      overrides[property] = contractVar ? `var(${contractVar}, ${value})` : value;
    }
    return overrides;
  }
  function watchThemeVars(theme, streams, signal, apply) {
    let generation = 0;
    let live = true;
    const refresh = () => {
      const at = ++generation;
      void theme.invoke("getTokens", {}, signal).then(
        (value) => {
          if (live && !signal.aborted && at === generation)
            apply(themeVarOverrides(value.tokens, value.cssVars));
        },
        () => {
          if (!signal.aborted && at === generation) apply(null);
        }
      );
    };
    refresh();
    void (async () => {
      try {
        for await (const frame of streams.subscribe("subscribeState", {}, signal)) {
          if (signal.aborted || frame.type === "closed") break;
          refresh();
        }
      } catch {
      }
      live = false;
      generation++;
      if (!signal.aborted) apply(null);
    })();
  }
  function focusAddressInput(input) {
    input?.focus();
    input?.select();
  }
  var BROWSER_GLOBAL_COMMANDS = [
    {
      id: "toggle",
      title: "Toggle Browser Panel",
      defaultKey: "mod+shift+j",
      scope: "global",
      activation: { surfaceId: BROWSER_SURFACE_ID, placement: "side-panel" }
    }
  ];
  var BROWSER_VIEW_COMMANDS = [
    {
      id: "reload",
      title: "Reload Page",
      defaultKey: "mod+r",
      when: `extension.${BROWSER_SURFACE_ID}.focus`,
      scope: "surface"
    },
    {
      id: "focusAddress",
      title: "Focus Address Bar",
      defaultKey: "mod+l",
      when: `extension.${BROWSER_SURFACE_ID}.focus`,
      scope: "surface"
    },
    {
      id: "zoomIn",
      title: "Zoom In",
      // Both spellings, like the native `preview.zoomIn` rules.
      defaultKey: ["mod+=", "mod++"],
      when: `extension.${BROWSER_SURFACE_ID}.focus`,
      scope: "surface"
    },
    {
      id: "zoomOut",
      title: "Zoom Out",
      defaultKey: "mod+-",
      when: `extension.${BROWSER_SURFACE_ID}.focus`,
      scope: "surface"
    },
    {
      id: "resetZoom",
      title: "Reset Zoom",
      defaultKey: "mod+0",
      when: `extension.${BROWSER_SURFACE_ID}.focus`,
      scope: "surface"
    }
  ];
  async function togglePanelSurface(panels, threadId, signal) {
    const { surfaces } = await panels.invoke("listSurfaces", { threadId }, signal);
    const open = surfaces.find((surface) => surface.id === BROWSER_SURFACE_ID);
    if (!open) {
      await panels.invoke(
        "openSurface",
        { surfaceId: BROWSER_SURFACE_ID, placement: "side-panel", threadId },
        signal
      );
      return "opened";
    }
    if (open.active) {
      await panels.invoke("closeSurface", { surfaceId: open.id, threadId }, signal);
      return "closed";
    }
    await panels.invoke("activateSurface", { surfaceId: open.id, threadId }, signal);
    return "activated";
  }
  async function notifyToggleFailure(notifications, threadId, error, signal) {
    await notifications.invoke(
      "notify",
      {
        severity: "error",
        title: "Unable to toggle the browser panel",
        ...error instanceof Error ? { body: error.message } : {},
        threadId,
        anchor: "thread"
      },
      signal
    );
  }
  function externalOpenTarget(url, fileSource) {
    if (url === null || fileSource !== null || isLeaseUrl(url)) return null;
    const checked = checkExternalUrl(url);
    return checked.ok ? checked.url : null;
  }
  async function openExternally(external, url, signal) {
    try {
      const receipt2 = await external.invoke("open", { url }, signal);
      return receipt2.status === "opened" ? null : `Could not open in system browser (${receipt2.reason})`;
    } catch (error) {
      return `Could not open in system browser \u2014 ${error instanceof Error ? error.message : "unavailable"}`;
    }
  }

  // extension.tsx
  var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.browser";
  var muted6 = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
  var border4 = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
  var buttonStyle = {
    font: "inherit",
    fontSize: 12,
    padding: "2px 8px",
    border: border4,
    borderRadius: 5,
    background: "transparent",
    color: "inherit"
  };
  function useThemeVars(host, session, visible) {
    const [vars, setVars] = (0, import_react9.useState)(null);
    (0, import_react9.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      watchThemeVars(
        bindApi(uiThemeApi, host, session.context),
        bindStreamApi(uiThemeApi, host, session.context),
        AbortSignal.any([controller.signal, session.signal]),
        setVars
      );
      return () => controller.abort();
    }, [host, session, visible]);
    return vars;
  }
  function runGlobalBrowserCommand(host, call) {
    if (call.commandId !== "toggle") return;
    const threadId = call.context.resource.threadId;
    if (!threadId) return;
    void togglePanelSurface(
      bindApi(uiPanelsApi, host, call.context),
      threadId,
      AbortSignal.timeout(1e4)
    ).catch((error) => {
      void notifyToggleFailure(
        bindApi(uiNotificationsApi, host, call.context),
        threadId,
        error,
        AbortSignal.timeout(5e3)
      ).catch(() => {
      });
    });
  }
  function disconnectedNotice(host) {
    const label = host.environmentLabel?.();
    return label ? `${label} is not connected.` : "Environment is not connected.";
  }
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || Array.isArray(value)) return false;
    const record2 = value;
    return Object.keys(record2).every((key) => {
      if (key === "relativePath" || key === "url" || key === "tabId" || key === "serverEpoch")
        return typeof record2[key] === "string";
      if (key === "history") return true;
      return false;
    });
  }
  function BrowserView(props) {
    const { host, session } = props;
    const restored = restoreState(session.restoreState) ? session.restoreState : null;
    const [state2, setState] = (0, import_react9.useState)(
      () => restored?.url ? submitAddress(initialNavigationState, restored.url) : initialNavigationState
    );
    const [fileSource, setFileSource] = (0, import_react9.useState)(
      restored?.url ? null : restored?.relativePath ?? null
    );
    const fileSourceRef = (0, import_react9.useRef)(fileSource);
    const fileLeaseUrl = (0, import_react9.useRef)(null);
    const fileRun = (0, import_react9.useRef)(null);
    const [address, setAddress] = (0, import_react9.useState)(restored?.url ?? restored?.relativePath ?? "");
    const [history, setHistory] = (0, import_react9.useState)(
      () => sanitizeHistoryEntries(restored?.history)
    );
    const [held, setHeld] = (0, import_react9.useState)(
      () => restored?.tabId && restored?.serverEpoch ? {
        tabId: restored.tabId,
        serverEpoch: restored.serverEpoch,
        engineGeneration: null
      } : null
    );
    const [live, setLive] = (0, import_react9.useState)(null);
    const [tabs, setTabs] = (0, import_react9.useState)([]);
    const tabsEpoch = (0, import_react9.useRef)(null);
    const [notice, setNotice] = (0, import_react9.useState)(null);
    const [visible, setVisible] = (0, import_react9.useState)(session.visible);
    const [surfaceAttempt, setSurfaceAttempt] = (0, import_react9.useState)(0);
    const surfaceUnavailableRef = (0, import_react9.useRef)(false);
    const heldRef = (0, import_react9.useRef)(held);
    const historyRef = (0, import_react9.useRef)(history);
    const dropHeldSession = (0, import_react9.useCallback)(() => {
      heldRef.current = null;
      setHeld(null);
      setLive(null);
      setNotice(null);
    }, [setHeld, setLive, setNotice]);
    const [fence] = (0, import_react9.useState)(createRevisionFence);
    const heldRevision = (0, import_react9.useRef)(-1);
    const addressRef = (0, import_react9.useRef)(null);
    const [contentElement, setContentElement] = (0, import_react9.useState)(null);
    const contentSize = useElementSize(contentElement);
    const [viewportPending, setViewportPending] = (0, import_react9.useState)(false);
    const viewportCommitter = (0, import_react9.useRef)(null);
    const themeVars = useThemeVars(host, session, visible);
    const profilesApi = (0, import_react9.useMemo)(() => bindProfilesApi(host, session.context), [host, session]);
    const profiles = (0, import_react9.useMemo)(
      () => createProfileListStore(profilesApi, session.signal),
      [profilesApi, session.signal]
    );
    const localServers = useLocalServers(host, session, visible && held === null);
    const [projectHistoryState, setProjectHistoryState] = (0, import_react9.useState)({
      kind: "loading"
    });
    const projectHistory = (0, import_react9.useMemo)(
      () => createProjectHistory(
        bindApi(browserHistoryApi, host, session.context),
        session.signal,
        setProjectHistoryState
      ),
      [host, session]
    );
    (0, import_react9.useEffect)(() => {
      if (visible) projectHistory.refresh();
    }, [projectHistory, visible]);
    (0, import_react9.useEffect)(() => {
      heldRef.current = held;
    }, [held]);
    (0, import_react9.useEffect)(() => {
      historyRef.current = history;
    }, [history]);
    (0, import_react9.useEffect)(() => session.onVisibility(setVisible), [session]);
    (0, import_react9.useEffect)(() => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const resumable = resolveResumableStreams(host, "t3.browser/sessions#events");
      let connected = false;
      const onSuspended = () => {
        if (signal.aborted || !connected) return;
        setNotice(disconnectedNotice(host));
      };
      void (async () => {
        try {
          const api = bindStreamApi(browserSessionsApi, host, session.context);
          let pending = null;
          for await (const frame of api.subscribe(
            "events",
            {},
            signal,
            resumable ? { resume: "fresh-snapshot", onSuspended } : void 0
          )) {
            signal.throwIfAborted();
            const value = frame.value;
            if (!value) continue;
            const current = heldRef.current;
            switch (value.kind) {
              case "snapshot-start":
                pending = [];
                break;
              case "snapshot-chunk":
                pending?.push(...value.sessions);
                break;
              case "snapshot-complete": {
                if (fence.retired.has(value.serverEpoch)) {
                  pending = null;
                  break;
                }
                advanceRevision(fence, value.serverEpoch, value.revision);
                tabsEpoch.current = value.serverEpoch;
                setTabs(pending ?? []);
                if (connected) setNotice(null);
                connected = true;
                if (current && !(value.serverEpoch === current.serverEpoch && value.revision < heldRevision.current)) {
                  const found = pending?.find((item) => item.tabId === current.tabId);
                  if (value.serverEpoch !== current.serverEpoch || !found) {
                    dropHeldSession();
                    if (value.serverEpoch === current.serverEpoch)
                      setNotice("Session ended (session-closed)");
                  } else {
                    setLive(found);
                    heldRevision.current = value.revision;
                    if (surfaceUnavailableRef.current) setSurfaceAttempt((attempt) => attempt + 1);
                  }
                }
                pending = null;
                break;
              }
              case "session-upsert":
                setTabs((currentTabs) => {
                  const index = currentTabs.findIndex((item) => item.tabId === value.session.tabId);
                  return index === -1 ? [...currentTabs, value.session] : currentTabs.map(
                    (item, itemIndex) => itemIndex === index ? value.session : item
                  );
                });
                if (current && value.session.tabId === current.tabId && value.revision >= heldRevision.current) {
                  heldRevision.current = value.revision;
                  setLive(value.session);
                  if (tabsEpoch.current) advanceRevision(fence, tabsEpoch.current, value.revision);
                  setHeld(
                    (previous) => previous ? { ...previous, engineGeneration: value.session.engine.generation } : previous
                  );
                }
                break;
              case "session-removed":
                setTabs((currentTabs) => currentTabs.filter((item) => item.tabId !== value.tabId));
                if (current && value.tabId === current.tabId) {
                  dropHeldSession();
                  setNotice(`Session ended (session-closed: ${value.reason})`);
                }
                break;
              case "closed":
                if (current) {
                  dropHeldSession();
                }
                tabsEpoch.current = null;
                setTabs([]);
                setNotice(`Sessions stream closed (${value.reason})`);
                break;
            }
          }
        } catch (error) {
          if (signal.aborted) return;
          const denial = describeGrantDenial(error);
          setNotice(
            denial ? `Browser sessions are unavailable \u2014 ${denial.message}` : error instanceof Error ? error.message : "Sessions stream unavailable"
          );
        }
      })();
      return () => controller.abort();
    }, [host, session]);
    const faviconCache = useFaviconCache();
    (0, import_react9.useEffect)(() => {
      resolveSessionFavicons(
        bindApi(browserSessionsApi, host, session.context),
        tabs,
        session.signal
      );
    }, [host, session, tabs]);
    const resolvedFaviconRefs = faviconCache.resolved;
    (0, import_react9.useEffect)(() => applySessionFavicons(resolvedFaviconRefs, tabs), [resolvedFaviconRefs, tabs]);
    (0, import_react9.useEffect)(() => {
      if (typeof session.setTabIndicators !== "function") return;
      const indicators = panelTabIndicators(faviconCache, live, tabs);
      try {
        session.setTabIndicators(indicators);
      } catch {
        const { faviconDataUrl: _refused, ...rest } = indicators ?? {};
        session.setTabIndicators(Object.keys(rest).length > 0 ? rest : null);
      }
    }, [session, faviconCache, live, tabs]);
    const {
      ref: surfaceSlotRef,
      lease: surfaceLease,
      denial: surfaceDenial,
      shown: surfaceShown,
      overlayZIndex
    } = useBrowserSurfaceSlot(host, session, {
      session: held,
      visible: visible && held !== null,
      cornerRadius: 8
    });
    (0, import_react9.useEffect)(() => {
      surfaceUnavailableRef.current = surfaceDenial?.reason === "host-unavailable";
    }, [surfaceDenial?.reason]);
    const epochChangedPresentation = isEpochChangedPresentation(surfaceLease?.state ?? null) || surfaceDenial?.reason === "epoch-changed";
    (0, import_react9.useEffect)(() => {
      if (epochChangedPresentation) dropHeldSession();
    }, [epochChangedPresentation, dropHeldSession]);
    const layers = floatingLayers(overlayZIndex);
    const Popover = (0, import_react9.useMemo)(() => panelPopover(host, layers.transient), [host, layers.transient]);
    const floating = (0, import_react9.useMemo)(
      () => ({
        Popover,
        style: {
          color: "var(--t3-browser-text, var(--foreground, #20252d))",
          background: "var(--t3-browser-canvas, var(--background, #fff))",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          fontSize: 13,
          ...themeVars
        }
      }),
      [Popover, themeVars]
    );
    const remoteEligible = held !== null && (host.browserSurface === void 0 || host.browserSurface.presentation.supported === false);
    const remote = useRemoteBrowserFrames(host, session, {
      session: held,
      enabled: visible && remoteEligible && surfaceLease?.state.kind !== "ended"
    });
    (0, import_react9.useEffect)(() => {
      const api = bindApi(browserSessionsApi, host, session.context);
      viewportCommitter.current = createViewportCommitter((viewport, signal, target) => {
        const current = heldRef.current;
        if (!current) return Promise.reject(new Error("No browser session to resize"));
        if (target !== void 0 && current.tabId !== target) {
          return Promise.reject(new ViewportTargetChangedError());
        }
        return api.invoke(
          "resize",
          {
            tabId: current.tabId,
            serverEpoch: current.serverEpoch,
            expectedEngineGeneration: current.engineGeneration,
            viewport
          },
          signal
        );
      });
      return () => {
        viewportCommitter.current = null;
      };
    }, [host, session]);
    const commitViewport = (next, target) => {
      const committer = viewportCommitter.current;
      if (!committer) return Promise.resolve(false);
      setViewportPending(true);
      return committer.commit(next, session.signal, target).then(
        (receipt2) => {
          setViewportPending(false);
          if (session.signal.aborted) return false;
          if (isStaleRevision(fence, receipt2.serverEpoch, receipt2.revision))
            return receipt2.outcome === "accepted";
          if (heldRef.current?.tabId !== receipt2.session.tabId) return false;
          advanceRevision(fence, receipt2.serverEpoch, receipt2.revision);
          heldRevision.current = Math.max(heldRevision.current, receipt2.revision);
          if (receipt2.outcome !== "accepted") {
            setNotice(`Browser command ${receipt2.outcome}`);
            return false;
          }
          const heldNext = {
            tabId: receipt2.session.tabId,
            serverEpoch: receipt2.serverEpoch,
            engineGeneration: receipt2.session.engine.generation
          };
          heldRef.current = heldNext;
          setHeld(heldNext);
          setLive(receipt2.session);
          setNotice(null);
          return true;
        },
        (error) => {
          setViewportPending(false);
          if (session.signal.aborted || error instanceof ViewportTargetChangedError) return false;
          const message = viewportFailureMessage(error);
          setNotice(message);
          void notifyViewportResizeFailure(
            bindApi(uiNotificationsApi, host, session.context),
            session.context.resource.threadId ?? "",
            error,
            AbortSignal.timeout(5e3)
          ).catch(() => {
          });
          return false;
        }
      );
    };
    const viewportSetting = live?.viewport ?? null;
    const deviceMode = viewportSetting !== null && viewportSetting._tag !== "fill";
    const viewportSlot = contentSize ?? FALLBACK_RESPONSIVE_VIEWPORT_SIZE;
    const pageZoom = live?.zoomFactor ?? 1;
    const fixedViewport = viewportSetting !== null && viewportSetting._tag !== "fill" ? viewportSetting : null;
    const aspectLocks = useAspectLocks(tabs, held);
    const aspectLocked = aspectLocks.isLocked(held);
    const rails = useViewportRails({
      setting: fixedViewport,
      target: held?.tabId ?? null,
      slot: viewportSlot,
      zoomFactor: pageZoom,
      aspectRatio: lockedAspectRatio(fixedViewport, aspectLocked),
      commit: commitViewport
    });
    const commitViewportChange = (next) => {
      rails.cancel();
      return commitViewport(next);
    };
    const persist = (entries, url, heldSession) => {
      const base = {
        ...restoreTarget(fileSourceRef.current, url),
        ...heldSession ? { tabId: heldSession.tabId, serverEpoch: heldSession.serverEpoch } : {}
      };
      session.save({ ...base, history: fitHistoryToSaveBudget(base, entries) });
    };
    const commit2 = (next) => {
      setState(next);
      if (next.status.kind !== "target" || isLeaseUrl(next.status.url)) return;
      const entries = recordHistoryVisit(history, next.status.url, Date.now());
      setHistory(entries);
      historyRef.current = entries;
      persist(entries, next.status.url, heldRef.current);
    };
    const removeRecent = (rawUrl) => {
      projectHistory.remove(rawUrl);
      const entries = removeHistoryUrl(history, rawUrl);
      setHistory(entries);
      historyRef.current = entries;
      persist(entries, currentUrl(state2), heldRef.current);
    };
    const dispatch = createCommandDispatch({
      signal: session.signal,
      fence,
      refuse: (outcome) => setNotice(`Browser command ${outcome}`),
      fail: (error) => {
        if (error instanceof Error && error.message.includes("BrowserStaleServerEpoch")) {
          if (held && heldRef.current?.serverEpoch === held.serverEpoch) dropHeldSession();
          return;
        }
        setNotice(error instanceof Error ? error.message : "Browser command failed");
      },
      adopt: (receipt2) => {
        heldRevision.current = receipt2.revision;
        const next = {
          tabId: receipt2.session.tabId,
          serverEpoch: receipt2.serverEpoch,
          engineGeneration: receipt2.session.engine.generation
        };
        heldRef.current = next;
        setHeld(next);
        setLive(receipt2.session);
        setNotice(null);
        const requested = receipt2.session.requestedUrl;
        const base = {
          ...restoreTarget(fileSourceRef.current, requested),
          tabId: next.tabId,
          serverEpoch: next.serverEpoch
        };
        session.save({ ...base, history: fitHistoryToSaveBudget(base, historyRef.current) });
      }
    });
    const presentFile = (relativePath) => {
      if (relativePath !== fileSourceRef.current) fileLeaseUrl.current = null;
      fileSourceRef.current = relativePath;
      setFileSource(relativePath);
    };
    const submit = (raw) => {
      fileRun.current?.abort();
      presentFile(null);
      const next = submitAddress(state2, raw);
      commit2(next);
      if (next.status.kind !== "target") return;
      const url = next.status.url;
      go(url, isLeaseUrl(url) ? void 0 : () => projectHistory.record(url));
    };
    const go = (url, onAccepted) => {
      if (surfaceDenial?.reason === "host-unavailable") setSurfaceAttempt((attempt) => attempt + 1);
      const api = bindApi(browserSessionsApi, host, session.context);
      const current = heldRef.current;
      const usable = current && surfaceLease?.state.kind !== "ended" && !isRecoveryExhausted(live) ? current : null;
      const reopen = usable ? null : reopenRequest(current ? live : null, url);
      dispatch(
        (signal) => usable ? api.invoke(
          "navigate",
          {
            tabId: usable.tabId,
            serverEpoch: usable.serverEpoch,
            url,
            expectedEngineGeneration: usable.engineGeneration
          },
          signal
        ) : reopen?.api === "profiles" ? profilesApi.invoke("open", reopen.input, signal).catch((error) => {
          throw new Error(profileFailureMessage("open", error));
        }) : api.invoke("open", { url }, signal),
        onAccepted
      );
    };
    const openInProfile = (profileId) => {
      const url = live?.navigation.url ?? live?.requestedUrl ?? void 0;
      setNotice(null);
      dispatch(
        (signal) => profilesApi.invoke("open", { profileId, ...url === void 0 ? {} : { url } }, signal).catch((error) => {
          throw new Error(profileFailureMessage("open", error));
        })
      );
    };
    const adopt = (0, import_react9.useCallback)(
      (tab) => {
        const serverEpoch = tabsEpoch.current;
        if (!serverEpoch) return;
        fileRun.current?.abort();
        const next = { tabId: tab.tabId, serverEpoch, engineGeneration: tab.engine.generation };
        heldRef.current = next;
        heldRevision.current = -1;
        setHeld(next);
        setLive(tab);
        setNotice(null);
        const url = tab.navigation.url ?? tab.requestedUrl ?? null;
        setAddress(url ?? "");
        if (url) setState((current) => submitAddress(current, url));
        presentFile(adoptedFileSource(fileSourceRef.current, fileLeaseUrl.current, url));
        const base = {
          ...restoreTarget(fileSourceRef.current, url),
          tabId: next.tabId,
          serverEpoch: next.serverEpoch
        };
        session.save({ ...base, history: fitHistoryToSaveBudget(base, historyRef.current) });
      },
      [presentFile, session]
    );
    const openFile = (relativePath) => {
      fileRun.current?.abort();
      const controller = new AbortController();
      fileRun.current = controller;
      const signal = AbortSignal.any([controller.signal, session.signal]);
      presentFile(relativePath);
      setAddress(relativePath);
      setNotice(`Opening ${relativePath}\u2026`);
      const lease = bindApi(resourcesLeaseApi, host, session.context);
      void mintWorkspaceFileUrl({
        lease: {
          getCapabilities: (abort) => lease.invoke("getCapabilities", {}, abort),
          createPresentationUrl: (resource, abort) => lease.invoke("createPresentationUrl", { resource }, abort)
        },
        threadId: session.context.resource.threadId,
        relativePath,
        documentUrl: globalThis.location?.href,
        fetch: (url, init) => fetch(url, init),
        signal
      }).then(
        (result2) => {
          if (signal.aborted) return;
          if (!result2.ok) {
            setNotice(result2.message);
            return;
          }
          fileLeaseUrl.current = result2.url;
          setState((current) => submitAddress(current, result2.url));
          go(result2.url);
        },
        () => {
        }
      );
    };
    (0, import_react9.useEffect)(() => {
      if (fileSourceRef.current && !heldRef.current) openFile(fileSourceRef.current);
      return () => fileRun.current?.abort();
    }, []);
    const pendingZoom = (0, import_react9.useRef)(null);
    (0, import_react9.useEffect)(() => {
      if (live?.zoomFactor === pendingZoom.current) pendingZoom.current = null;
    }, [live?.zoomFactor]);
    const runPage = (verb, tab) => {
      const epoch = tabsEpoch.current;
      const target = tab ? epoch ? { tabId: tab.tabId, serverEpoch: epoch, engineGeneration: tab.engine.generation } : null : heldRef.current;
      if (!target) return;
      if (verb.method === "zoom" && !tab) pendingZoom.current = verb.zoomFactor;
      const api = bindApi(browserSessionsApi, host, session.context);
      void runPageCommand(api, target, tab ?? live, verb, session.signal).then((outcome) => {
        if (session.signal.aborted) return;
        if (outcome.kind !== "accepted") {
          if (verb.method === "zoom" && !tab) pendingZoom.current = null;
          setNotice(outcome.message);
          return;
        }
        setNotice(null);
        const { receipt: receipt2 } = outcome;
        const current = heldRef.current;
        if (!current || receipt2.session.tabId !== current.tabId) return;
        if (!advanceRevision(fence, receipt2.serverEpoch, receipt2.revision)) return;
        heldRevision.current = Math.max(heldRevision.current, receipt2.revision);
        const next = { ...current, engineGeneration: receipt2.session.engine.generation };
        heldRef.current = next;
        setHeld(next);
        setLive(receipt2.session);
      });
    };
    const zoomStep = (direction) => runPage({
      method: "zoom",
      zoomFactor: nextZoomFactor(pendingZoom.current ?? live?.zoomFactor ?? null, direction)
    });
    const pageBlock = held ? pageControlsBlock(live) : null;
    const command = (method) => {
      if (method === "reload" && fileSourceRef.current) return openFile(fileSourceRef.current);
      if (!held) return;
      if (method === "reload" && isRecoveryExhausted(live)) {
        const url = live?.navigation.url ?? live?.requestedUrl ?? null;
        if (url) go(url);
        return;
      }
      if (pageBlock !== null) {
        setNotice(pageBlock);
        return;
      }
      if (method === "back") commit2(goBack(state2));
      else if (method === "forward") commit2(goForward(state2));
      else commit2(reload(state2));
      runPage({ method });
    };
    const runViewCommand = (0, import_react9.useRef)(() => {
    });
    (0, import_react9.useEffect)(() => {
      runViewCommand.current = (commandId) => {
        if (commandId === "reload") {
          if (held || fileSourceRef.current) command("reload");
          else commit2(reload(state2));
        } else if (commandId === "focusAddress") {
          focusAddressInput(addressRef.current);
        } else if (held && (commandId === "zoomIn" || commandId === "zoomOut")) {
          zoomStep(commandId === "zoomIn" ? "in" : "out");
        } else if (held && commandId === "resetZoom") {
          runPage({ method: "zoom", zoomFactor: DEFAULT_ZOOM_FACTOR });
        }
      };
    });
    (0, import_react9.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      void bindApi(uiKeybindingsApi, host, session.context, "^1.1.0").invoke("registerCommands", { commands: BROWSER_VIEW_COMMANDS }, signal).then(
        ({ commandSetToken }) => {
          if (signal.aborted) return;
          try {
            session.bindCommands(commandSetToken, (call) => runViewCommand.current(call.commandId));
          } catch {
          }
        },
        () => {
        }
      );
      return () => controller.abort();
    }, [host, session, visible]);
    const titled = titleUpdate(live?.navigation ?? null, fileSource !== null, isLeaseUrl);
    const titledUrl = titled?.url ?? null;
    const titledTitle = titled?.title ?? null;
    const lastTitled = (0, import_react9.useRef)(null);
    (0, import_react9.useEffect)(() => {
      if (titledUrl === null || titledTitle === null) return;
      if (projectHistoryState.kind !== "ready" || projectHistoryState.entries.length === 0) return;
      const key = `${titledUrl}
${titledTitle}`;
      if (lastTitled.current === key) return;
      lastTitled.current = key;
      projectHistory.setTitle(titledUrl, titledTitle);
    }, [projectHistory, projectHistoryState, titledUrl, titledTitle]);
    const recents = recentHistoryEntries(displayedHistory(projectHistoryState, history));
    const showRecents = state2.status.kind !== "target" && recents.length > 0;
    const externalTarget = externalOpenTarget(
      live ? live.navigation.url ?? live.requestedUrl : currentUrl(state2),
      fileSource
    );
    const landing = landingModel({
      recentCount: showRecents ? recents.length : 0,
      localServers
    });
    const leaseState = surfaceLease?.state;
    const remoteNotice = remote.status.kind === "connecting" ? "Connecting remote browser frames\u2026" : remote.status.kind === "error" ? `Remote browser frames failed \u2014 ${remote.status.detail}` : remote.status.kind === "unsupported" ? `This client cannot composite a native browser surface and has no remote frame transport (${remote.status.detail}). The session is still open \u2014 view it from the desktop app.` : null;
    const capturePage = capturePageView(surfaceLease, surfaceShown, live?.navigation.kind);
    const pageLoading = held !== null && (live?.navigation.kind === "loading" || live?.navigation.kind === "pending");
    const surfaceNotice = epochChangedPresentation || surfaceDenial?.reason === "host-unavailable" ? null : leaseState?.kind === "ended" ? `Surface ended (${leaseState.reason}). Enter an address to open a new session.` : remoteEligible ? remoteNotice : surfaceDenial ? surfaceDenial.grant ? `Native presentation is unavailable \u2014 ${grantDenialMessage(surfaceDenial.grant)}` : `Native presentation is unavailable \u2014 ${surfaceDenial.reason}: ${surfaceDenial.detail}` : null;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
      "section",
      {
        "aria-label": "Browser",
        "data-t3-browser-panel": true,
        style: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          color: "var(--t3-browser-text, var(--foreground, #20252d))",
          background: "var(--t3-browser-canvas, var(--background, #fff))",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          fontSize: 13,
          ...themeVars
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("style", { children: `:is([data-t3-browser-panel],[data-t3-browser-popover]) :is(button,input,select,textarea):focus-visible{outline:none;box-shadow:0 0 0 1px var(--t3-browser-canvas, var(--background, #fff)),0 0 0 3px var(--ring, var(--primary, #1b4ed8))}` }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                gap: 6,
                padding: 8,
                borderBottom: border4,
                flexShrink: 0,
                alignItems: "center"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Tooltip, { host, label: "Back", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Back",
                    disabled: held ? pageBlock !== null || !(live?.canGoBack ?? false) : !canGoBack(state2),
                    onClick: () => held ? command("back") : commit2(goBack(state2)),
                    style: buttonStyle,
                    children: "\u2190"
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Tooltip, { host, label: "Forward", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Forward",
                    disabled: held ? pageBlock !== null || !(live?.canGoForward ?? false) : !canGoForward(state2),
                    onClick: () => held ? command("forward") : commit2(goForward(state2)),
                    style: buttonStyle,
                    children: "\u2192"
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Tooltip, { host, label: pageLoading ? "Loading\u2026" : "Refresh", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": pageLoading ? "Stop" : "Refresh",
                    disabled: fileSource === null && (held ? pageBlock !== null && !isRecoveryExhausted(live) : state2.status.kind !== "target"),
                    onClick: () => held || fileSource ? command("reload") : commit2(reload(state2)),
                    style: buttonStyle,
                    children: "\u27F3"
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": deviceMode ? "Hide device toolbar" : "Show device toolbar",
                    "aria-pressed": deviceMode,
                    disabled: !held || viewportPending,
                    onClick: () => {
                      if (!viewportSetting) return;
                      void commitViewportChange(
                        viewportSetting._tag !== "fill" ? { _tag: "fill" } : responsiveViewportForToggle(contentSize)
                      );
                    },
                    style: {
                      ...buttonStyle,
                      ...deviceMode ? { background: "var(--t3-browser-border, var(--border, #dfe3e8))" } : {}
                    },
                    children: "\u26F6"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  BrowserCaptureButtons,
                  {
                    host,
                    session,
                    held,
                    page: capturePage,
                    onStatus: setNotice,
                    style: buttonStyle
                  }
                ),
                held && live && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ProfileBadge, { host, session: live, profiles, visible }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  AddressInput,
                  {
                    inputRef: addressRef,
                    value: address,
                    committed: committedAddress({
                      fileSource,
                      pageUrl: live ? live.navigation.url ?? live.requestedUrl ?? null : null,
                      target: currentUrl(state2)
                    }),
                    onValueChange: setAddress,
                    onSubmit: submit,
                    style: {
                      flex: 1,
                      minWidth: 0,
                      font: "inherit",
                      fontSize: 12,
                      // The native address bar carries its ring on a rounded wrapper;
                      // without a radius the focus ring would draw a hard rectangle.
                      borderRadius: "var(--control-radius, 8px)",
                      padding: "0 4px"
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Tooltip, { host, label: "Open in system browser", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Open in system browser",
                    disabled: externalTarget === null,
                    onClick: () => {
                      if (externalTarget === null) return;
                      void openExternally(
                        bindApi(uiExternalApi, host, session.context),
                        externalTarget,
                        session.signal
                      ).then((fault) => {
                        if (fault !== null && !session.signal.aborted) setNotice(fault);
                      });
                    },
                    style: buttonStyle,
                    children: "\u2197"
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  PageMenu,
                  {
                    host,
                    session: held ? live : null,
                    blockReason: pageBlock,
                    run: (verb) => runPage(verb),
                    zoomStep,
                    floating,
                    visible,
                    children: (close) => held && live && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      ProfileSection,
                      {
                        session: live,
                        api: profilesApi,
                        profiles,
                        signal: session.signal,
                        onOpenInProfile: openInProfile,
                        report: setNotice,
                        onChosen: close
                      }
                    )
                  }
                )
              ]
            }
          ),
          tabs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "div",
            {
              role: "tablist",
              "aria-label": "Open browser sessions",
              style: {
                display: "flex",
                gap: 4,
                padding: "0 8px 6px",
                overflowX: "auto",
                flexShrink: 0
              },
              children: tabs.map((tab) => {
                const tabUrl = tab.navigation.url ?? tab.requestedUrl ?? null;
                const active = held?.tabId === tab.tabId;
                const label = tabLabel(tab.navigation.title, tabUrl);
                return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
                  "span",
                  {
                    role: "presentation",
                    style: { display: "inline-flex", alignItems: "center", gap: 2 },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
                        "button",
                        {
                          type: "button",
                          role: "tab",
                          "aria-selected": active,
                          onClick: () => {
                            if (!active) adopt(tab);
                          },
                          style: {
                            ...buttonStyle,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            maxWidth: 180,
                            whiteSpace: "nowrap",
                            ...active ? { background: "var(--t3-browser-border, var(--border, #dfe3e8))" } : {}
                          },
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(BrowserFavicon, { url: tabUrl, faviconRef: tab.faviconRef }),
                            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }, children: label })
                          ]
                        }
                      ),
                      tab.audible === true && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                        "button",
                        {
                          type: "button",
                          "aria-label": tab.audioMuted ? `Unmute ${label}` : `Mute ${label}`,
                          "aria-pressed": tab.audioMuted === true,
                          disabled: pageControlsBlock(tab) !== null,
                          onClick: () => runPage({ method: "setAudioMuted", muted: !tab.audioMuted }, tab),
                          style: { ...buttonStyle, border: "none", padding: "0 2px" },
                          children: tab.audioMuted ? "\u{1F507}" : "\u{1F50A}"
                        }
                      )
                    ]
                  },
                  tab.tabId
                );
              })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "div",
            {
              role: "status",
              "aria-label": "Browser status",
              style: { padding: "6px 10px", color: muted6, fontSize: 11, flexShrink: 0 },
              children: notice ?? (held && live ? `${live.navigation.title || live.navigation.url || "session"} \u2014 ${engineStatusLabel(live)}` : describeStatus(state2))
            }
          ),
          held ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { ref: setContentElement, style: { position: "relative", flex: 1, minHeight: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "div",
              {
                ref: surfaceSlotRef,
                "aria-label": "Browser surface",
                style: { position: "absolute", inset: 0 }
              },
              surfaceAttempt
            ),
            remoteEligible && remote.status.kind !== "unsupported" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "div",
              {
                ref: remote.ref,
                "aria-label": "Remote browser surface",
                style: { position: "absolute", inset: 0 }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              ZoomIndicator,
              {
                zoomFactor: live?.zoomFactor ?? null,
                zIndex: layers.transient,
                style: floating.style,
                visible
              },
              held.tabId
            ),
            rails.displayed && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                BrowserViewportToolbar,
                {
                  host,
                  setting: rails.displayed,
                  pending: viewportPending,
                  onCommit: commitViewportChange,
                  aspectLocked,
                  onAspectLockedChange: (locked) => aspectLocks.setLocked(held, locked),
                  zIndex: layers.deviceChrome
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                ViewportDeviceFrame,
                {
                  slot: contentSize,
                  setting: rails.displayed,
                  fallbackSlot: FALLBACK_RESPONSIVE_VIEWPORT_SIZE,
                  zoomFactor: pageZoom,
                  zIndex: layers.deviceChrome
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                ViewportResizeRails,
                {
                  layout: deviceViewportLayout(viewportSlot, rails.displayed, pageZoom),
                  preview: rails.preview,
                  onPointerDown: rails.onPointerDown,
                  onKeyDown: rails.onKeyDown
                }
              )
            ] }),
            surfaceNotice && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "p",
              {
                role: "note",
                style: {
                  position: "absolute",
                  inset: 0,
                  margin: 0,
                  padding: 12,
                  fontSize: 12,
                  color: muted6,
                  background: "var(--t3-browser-canvas, var(--background, #fff))"
                },
                children: surfaceNotice
              }
            )
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
            "div",
            {
              style: {
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: 12,
                display: "grid",
                gap: 10,
                alignContent: "start",
                justifyItems: "start"
              },
              children: [
                landing.noPreview && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(NoPreview, { ...landing.noPreview }),
                showRecents && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(RecentlyUsedHeading, {}),
                showRecents && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "ul",
                  {
                    "aria-label": "Recently used",
                    style: { listStyle: "none", margin: 0, padding: 0, fontSize: 12 },
                    children: recents.map((entry) => {
                      const parsed = new URL(entry.url);
                      const path3 = parsed.pathname === "/" ? "" : parsed.pathname;
                      const label = `${parsed.host}${path3}${parsed.search}${parsed.hash}`;
                      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("li", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(BrowserFavicon, { url: entry.url, size: 14 }),
                        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                          "button",
                          {
                            type: "button",
                            onClick: () => submit(entry.url),
                            style: {
                              ...buttonStyle,
                              border: "none",
                              padding: "2px 0",
                              textAlign: "left",
                              textDecoration: "underline",
                              color: muted6
                            },
                            children: entry.title ? `${entry.title} \u2014 ${label}` : label
                          }
                        ),
                        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                          "button",
                          {
                            type: "button",
                            "aria-label": `Remove ${label} from history`,
                            onClick: () => removeRecent(entry.url),
                            style: { ...buttonStyle, border: "none", padding: "0 2px", color: muted6 },
                            children: "\xD7"
                          }
                        )
                      ] }, entry.url);
                    })
                  }
                ),
                projectHistoryState.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "note", style: { margin: 0, fontSize: 11, color: muted6 }, children: projectHistoryState.message }),
                projectHistoryState.kind === "ready" && projectHistoryState.truncated && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "note", style: { margin: 0, fontSize: 11, color: muted6 }, children: "Project history truncated \u2014 showing the most recent entries that fit." }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  LocalServersSection,
                  {
                    servers: landing.serverList,
                    notice: landing.localNotice,
                    onOpen: (url) => {
                      setAddress(url);
                      submit(url);
                    }
                  }
                ),
                recentTargets(state2).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "ul",
                  {
                    "aria-label": "Requested targets",
                    style: { listStyle: "none", margin: 0, padding: 0, fontSize: 12 },
                    children: recentTargets(state2).map((target) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      "button",
                      {
                        type: "button",
                        "aria-current": target.index === state2.index,
                        onClick: () => submit(target.url),
                        style: {
                          ...buttonStyle,
                          border: "none",
                          padding: "2px 0",
                          textAlign: "left",
                          textDecoration: "underline",
                          color: target.index === state2.index ? "var(--t3-browser-text, var(--foreground, #20252d))" : muted6
                        },
                        children: target.url
                      }
                    ) }, target.url))
                  }
                )
              ]
            }
          )
        ]
      }
    );
  }
  var authored = defineExtension({
    id: manifestId,
    version: "0.1.0",
    requires: [
      requireApi(browserSessionsApi),
      requireApi(browserProfilesApi),
      requireApi(browserLocalServersApi),
      requireApi(browserHistoryApi),
      requireApi(browserFramesApi),
      requireApi(resourcesLeaseApi),
      requireApi(uiThemeApi),
      // Explicit floor until the defineApi `baseline` option unifies these at merge.
      requireApi(uiKeybindingsApi, "^1.1.0"),
      requireApi(uiPanelsApi),
      requireApi(uiNotificationsApi),
      requireApi(composerContextApi),
      requireApi(uiExternalApi)
    ],
    surfaces: [
      {
        name: "view",
        title: "Browser",
        scope: "thread",
        placements: ["side-panel"],
        clients: ["web", "desktop"],
        // Stays empty: this field gates mounting on host services reached
        // through `session.invoke` — `t3.ui/*` are brokered APIs (bindApi,
        // opportunistic under grants) and `t3.browser/surface` rides
        // `host.browserSurface`, so no required service belongs here.
        capabilities: [],
        stateVersion: 1,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(BrowserView, { host, session }) };
        }
      }
    ]
  });
  var client = authored.client;
  var extension_default = {
    ...authored,
    ...client === void 0 ? {} : {
      client(host) {
        host.registerGlobalCommands?.(
          BROWSER_GLOBAL_COMMANDS,
          (call) => runGlobalBrowserCommand(host, call)
        );
        return client(host);
      }
    }
  };

  // extension.ts
  var extension_default2 = extension_default;

  // generated-client.ts
  var generated_client_default = extension_default2.client;
  return __toCommonJS(generated_client_exports);
})();

return __t3Client.default(__t3Host);
}
