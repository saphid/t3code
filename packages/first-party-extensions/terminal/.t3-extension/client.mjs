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
    const match = VERSION.exec(text);
    return match ? toVersion(match.slice(1, 4)) : null;
  }
  function compareVersions(a, b) {
    return Math.sign(a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  }
  function rangeFloor(range) {
    const match = RANGE.exec(range);
    if (match)
      return toVersion(match.slice(1, 4));
    const bounded = BOUNDED.exec(range);
    if (!bounded)
      return null;
    const floor = toVersion(bounded.slice(1, 4));
    const ceiling = toVersion(bounded.slice(4, 7));
    return floor && ceiling && compareVersions(floor, ceiling) < 0 ? floor : null;
  }

  // node_modules/@t3tools/extension-sdk/dist/capabilities.js
  function resolveResumableStreams(host) {
    const member = host.resumableStreams;
    if (!member || typeof member !== "object")
      return null;
    const { version, subscribeApi } = member;
    return typeof version === "number" && version >= 1 && typeof subscribeApi === "function" ? member : null;
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
    const [head, ...rest] = path3;
    const key = head.endsWith("[]") ? head.slice(0, -2) : head;
    const child = value[key];
    if (!head.endsWith("[]"))
      return hasInput(child, rest);
    return Array.isArray(child) && child.some((item) => hasInput(item, rest));
  }
  function negotiated(definition, options) {
    if (options.baseline === void 0) {
      if (options.additions?.length)
        throw new Error("API additions need a baseline");
      return {};
    }
    const version = parseVersion(definition.version);
    if (!version)
      throw new Error("An API with a baseline needs a plain X.Y.Z version: " + definition.version);
    const baseline = parseVersion(options.baseline);
    if (!baseline || baseline[0] !== version[0] || compareVersions(baseline, version) > 0)
      throw new Error("API baseline must be an earlier plain X.Y.Z version of the same major");
    const additions = (options.additions ?? []).map((addition) => ({ ...addition }));
    if (compareVersions(baseline, version) < 0 && additions.length === 0)
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
      if (compareVersions(added, baseline) <= 0 || compareVersions(added, version) > 0 || ("stream" in addition ? !definition.streams?.some((stream) => stream.name === addition.stream) : !owners.some((owner) => owner.name === addition.method)) || "output" in addition && typeof path3 !== "string" || path3 !== void 0 && (typeof path3 !== "string" || !/^[A-Za-z_$][\w$]*(\[\])?(\.[A-Za-z_$][\w$]*(\[\])?)*$/.test(path3)))
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
  function bindApi(api, client, context, versionRange = defaultVersionRange(api)) {
    const unnegotiated = unnegotiatedAdditions(api, versionRange);
    return {
      invoke(method, input, signal) {
        const addition = unnegotiated.find((item) => "method" in item && item.method === method && (item.input === void 0 || hasInput(input, item.input.split("."))));
        if (addition)
          return Promise.reject(new ApiVersionError(`${api.definition.id}#${method}${addition.input === void 0 ? "" : " " + addition.input} needs ^${addition.version}, but this binding asks for ${versionRange}; probe the host version, then bind at ^${addition.version}`));
        return client.invokeApi({ id: api.definition.id, versionRange, method, input, context }, signal);
      }
    };
  }
  function defineStreamApi(definition, options = {}) {
    const validated = validateApiDefinition(definition);
    if (!validated.streams?.length)
      throw new Error("Expected API stream definitions");
    return { definition: validated, ...negotiated(validated, options) };
  }
  function bindStreamApi(api, client, context, versionRange = defaultVersionRange(api)) {
    const unnegotiated = unnegotiatedAdditions(api, versionRange);
    return {
      subscribe(name, input, signal, options) {
        const addition = unnegotiated.find((item) => "stream" in item && item.stream === name);
        if (addition)
          throw new ApiVersionError(`${api.definition.id} stream ${name} needs ^${addition.version}, but this binding asks for ${versionRange}; probe the host version, then bind at ^${addition.version}`);
        let subscribeApi = client.subscribeApi.bind(client);
        if (options?.resume === "fresh-snapshot") {
          const resumable = resolveResumableStreams(client);
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
          context,
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
  function prsReadDefinition(version, listResult, detail) {
    return {
      id: PRS_READ,
      version,
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
  var uiPreferencesDefinition = (version, preferences, patch) => ({
    id: UI_PREFERENCES,
    version,
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
  async function openExternalLink(client, context, url, options) {
    const discovered = await client.discoverApis(context, options.signal);
    const routesLinks = discovered.some((api) => {
      const version = api.id === UI_EXTERNAL ? parseVersion(api.version) : null;
      return version !== null && version[0] === 1 && compareVersions(version, [1, 1, 0]) >= 0;
    });
    if (!routesLinks)
      return bindApi(uiExternalApi, client, context).invoke("open", { url }, options.signal);
    return bindApi(uiExternalApi, client, context, "^1.1.0").invoke("openLink", { url, ...options.forceSystem === true ? { forceSystem: true } : {} }, options.signal);
  }
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
    const { version, Tooltip: Tooltip2 } = member;
    return Number.isInteger(version) && version >= 1 && isComponentType(Tooltip2) ? member : null;
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
  function requireApi(api, versionRange = defaultVersionRange(api)) {
    return { id: api.definition.id, versionRange };
  }
  function Tooltip(props) {
    const { host, ...rest } = props;
    const tooltip = resolveTooltip(host);
    return tooltip === null ? rest.children : host.React.createElement(tooltip.Tooltip, rest);
  }

  // node_modules/@t3tools/shared/src/projectScripts.ts
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

  // node_modules/@t3tools/shared/src/terminalLabels.ts
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
    const usedIds = new Set(existingTerminalIds.filter((id2) => id2.trim().length > 0));
    let nextIndex = 1;
    while (usedIds.has(`term-${nextIndex}`)) {
      nextIndex += 1;
    }
    return `term-${nextIndex}`;
  }

  // extension.tsx
  var import_react2 = __toESM(require_react(), 1);

  // node_modules/@t3tools/ghostty-terminal/src/platform.ts
  function isMacPlatform(platform) {
    return /mac|iphone|ipad|ipod/i.test(platform);
  }

  // node_modules/@t3tools/ghostty-terminal/src/terminal-links.ts
  var URL_PATTERN = /https?:\/\/[^\s"'`<>]+/giu;
  var FILE_PATH_PATTERN = /(?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+){0,2}/g;
  var TRAILING_PUNCTUATION_PATTERN = /[.,;!?]+$/;
  function trimClosingDelimiters(value) {
    let output = value.replace(TRAILING_PUNCTUATION_PATTERN, "");
    if (output.length === 0) return output;
    const trimUnbalanced = (open, close) => {
      while (output.endsWith(close)) {
        const opens = output.split(open).length - 1;
        const closes = output.split(close).length - 1;
        if (opens >= closes) return;
        output = output.slice(0, -1);
      }
    };
    trimUnbalanced("(", ")");
    trimUnbalanced("[", "]");
    trimUnbalanced("{", "}");
    return output;
  }
  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }
  function collectMatches(line, kind, pattern, existing) {
    const matches = [];
    pattern.lastIndex = 0;
    for (const rawMatch of line.matchAll(pattern)) {
      const raw = rawMatch[0];
      const start = rawMatch.index ?? -1;
      if (start < 0 || raw.length === 0) continue;
      const trimmed = trimClosingDelimiters(raw);
      if (trimmed.length === 0) continue;
      if (kind === "path" && isTerminalUrl(trimmed)) continue;
      const candidate = {
        kind,
        text: trimmed,
        start,
        end: start + trimmed.length
      };
      const collides = [...existing, ...matches].some((other) => overlaps(candidate, other));
      if (collides) continue;
      matches.push(candidate);
    }
    return matches;
  }
  function extractTerminalLinks(line) {
    const urlMatches = collectMatches(line, "url", URL_PATTERN, []);
    const pathMatches = collectMatches(line, "path", FILE_PATH_PATTERN, urlMatches);
    return [...urlMatches, ...pathMatches].toSorted((a, b) => a.start - b.start);
  }
  function isTerminalUrl(value) {
    return /^https?:\/\//iu.test(value);
  }
  function collectWrappedTerminalLinkLine(bufferLineNumber, getLine) {
    const anchorLine = getLine(bufferLineNumber - 1);
    if (!anchorLine) return null;
    let startBufferLineNumber = bufferLineNumber;
    let startLine = anchorLine;
    while (startBufferLineNumber > 1 && startLine.isWrapped) {
      const previousLine = getLine(startBufferLineNumber - 2);
      if (!previousLine) return null;
      startBufferLineNumber -= 1;
      startLine = previousLine;
    }
    const segments = [];
    let nextStartIndex = 0;
    let currentBufferLineNumber = startBufferLineNumber;
    while (true) {
      const currentLine = getLine(currentBufferLineNumber - 1);
      if (!currentLine) break;
      const nextLine = getLine(currentBufferLineNumber);
      const hasWrappedContinuation = nextLine?.isWrapped === true;
      const text = currentLine.translateToString(!hasWrappedContinuation);
      segments.push({
        bufferLineNumber: currentBufferLineNumber,
        text,
        startIndex: nextStartIndex,
        endIndex: nextStartIndex + text.length
      });
      nextStartIndex += text.length;
      if (!hasWrappedContinuation) break;
      currentBufferLineNumber += 1;
    }
    return {
      text: segments.map((segment) => segment.text).join(""),
      segments
    };
  }

  // node_modules/@t3tools/ghostty-terminal/src/runtime.ts
  var textDecoder = new TextDecoder();
  var GhosttyRuntime = class _GhosttyRuntime {
    memory;
    layouts;
    exports;
    memoryView;
    ptyWriters = /* @__PURE__ */ new Map();
    nextPtyWriterId = 1;
    writePtyFunctionIndex = 0;
    constructor(instance) {
      this.exports = instance.exports;
      const memory = instance.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) {
        throw new Error("libghostty-vt did not export WebAssembly memory");
      }
      this.memory = memory;
      this.memoryView = new DataView(memory.buffer);
      const jsonPointer = this.call("ghostty_type_json");
      const bytes = new Uint8Array(memory.buffer);
      let end = jsonPointer;
      while (end < bytes.length && bytes[end] !== 0) end += 1;
      this.layouts = JSON.parse(textDecoder.decode(bytes.subarray(jsonPointer, end)));
    }
    static async load(sources) {
      let instance;
      const imports = {
        env: {
          log: (pointer, length) => {
            if (!instance) return;
            const memory = instance.exports.memory;
            if (!(memory instanceof WebAssembly.Memory)) return;
            const message = textDecoder.decode(new Uint8Array(memory.buffer, pointer, length));
            console.debug("[libghostty-vt]", message);
          }
        }
      };
      const result = await WebAssembly.instantiate(sources.vt, imports);
      instance = result.instance;
      const runtime = new _GhosttyRuntime(result.instance);
      await runtime.installWritePtyTrampoline(sources.writePty);
      return runtime;
    }
    call(name, ...args) {
      const fn = this.exports[name];
      if (typeof fn !== "function") {
        throw new Error(`libghostty-vt export is unavailable: ${name}`);
      }
      return fn(...args);
    }
    layout(name) {
      const layout = this.layouts[name];
      if (!layout) throw new Error(`libghostty-vt type layout is unavailable: ${name}`);
      return layout;
    }
    alloc(size) {
      const pointer = this.call("ghostty_wasm_alloc_u8_array", size);
      if (pointer === 0) throw new Error(`libghostty-vt failed to allocate ${size} bytes`);
      new Uint8Array(this.memory.buffer, pointer, size).fill(0);
      return pointer;
    }
    free(pointer, size) {
      if (pointer !== 0) this.call("ghostty_wasm_free_u8_array", pointer, size);
    }
    allocOpaque() {
      const pointer = this.call("ghostty_wasm_alloc_opaque");
      if (pointer === 0) throw new Error("libghostty-vt failed to allocate an opaque pointer");
      new DataView(this.memory.buffer).setUint32(pointer, 0, true);
      return pointer;
    }
    freeOpaque(pointer) {
      if (pointer !== 0) this.call("ghostty_wasm_free_opaque", pointer);
    }
    readPointer(slot) {
      return this.currentMemoryView().getUint32(slot, true);
    }
    attachPtyWriter(terminal, writer) {
      if (this.writePtyFunctionIndex === 0) {
        throw new Error("libghostty-vt PTY callback trampoline is unavailable");
      }
      const id2 = this.nextPtyWriterId++;
      this.ptyWriters.set(id2, writer);
      this.call("ghostty_terminal_set", terminal, 0, id2);
      this.call("ghostty_terminal_set", terminal, 1, this.writePtyFunctionIndex);
      return id2;
    }
    detachPtyWriter(terminal, id2) {
      this.call("ghostty_terminal_set", terminal, 1, 0);
      this.call("ghostty_terminal_set", terminal, 0, 0);
      this.ptyWriters.delete(id2);
    }
    view(pointer, size) {
      return new DataView(this.memory.buffer, pointer, size);
    }
    bytes(pointer, size) {
      return new Uint8Array(this.memory.buffer, pointer, size);
    }
    /** Reuse scalar reads across cells, refreshing after any terminal grows shared WASM memory. */
    currentMemoryView() {
      if (this.memoryView.buffer !== this.memory.buffer) {
        this.memoryView = new DataView(this.memory.buffer);
      }
      return this.memoryView;
    }
    setField(pointer, structName, fieldName, value) {
      const field = this.layout(structName).fields[fieldName];
      if (!field) throw new Error(`libghostty-vt field is unavailable: ${structName}.${fieldName}`);
      const view = this.currentMemoryView();
      const offset = pointer + field.offset;
      switch (field.type) {
        case "bool":
        case "u8":
          view.setUint8(offset, value);
          return;
        case "u16":
          view.setUint16(offset, value, true);
          return;
        case "i32":
          view.setInt32(offset, value, true);
          return;
        case "u32":
        case "enum":
          view.setUint32(offset, value, true);
          return;
        case "u64":
          view.setBigUint64(offset, BigInt(value), true);
          return;
        default:
          throw new Error(`Unsupported libghostty-vt field type: ${field.type}`);
      }
    }
    readField(pointer, structName, fieldName) {
      const field = this.layout(structName).fields[fieldName];
      if (!field) throw new Error(`libghostty-vt field is unavailable: ${structName}.${fieldName}`);
      const view = this.currentMemoryView();
      const offset = pointer + field.offset;
      switch (field.type) {
        case "bool":
        case "u8":
          return view.getUint8(offset);
        case "u16":
          return view.getUint16(offset, true);
        case "i32":
          return view.getInt32(offset, true);
        case "u32":
        case "enum":
          return view.getUint32(offset, true);
        case "u64":
          return Number(view.getBigUint64(offset, true));
        default:
          throw new Error(`Unsupported libghostty-vt field type: ${field.type}`);
      }
    }
    async installWritePtyTrampoline(writePty) {
      const result = await WebAssembly.instantiate(writePty, {
        env: {
          t3_write_pty: (_terminal, userdata, pointer, length) => {
            const writer = this.ptyWriters.get(userdata);
            if (!writer || length === 0) return;
            writer(textDecoder.decode(new Uint8Array(this.memory.buffer, pointer, length)));
          }
        }
      });
      const trampoline = result.instance.exports.ghostty_write_pty;
      const table = this.exports.__indirect_function_table;
      if (typeof trampoline !== "function" || !(table instanceof WebAssembly.Table)) {
        throw new Error("libghostty-vt did not expose its callback table");
      }
      const index = table.length;
      table.grow(1);
      table.set(index, trampoline);
      this.writePtyFunctionIndex = index;
    }
  };
  var runtimePromises = /* @__PURE__ */ new WeakMap();
  function loadGhosttyRuntime(sources) {
    const existing = runtimePromises.get(sources);
    if (existing) return existing;
    const promise = GhosttyRuntime.load(sources).catch((error) => {
      if (runtimePromises.get(sources) === promise) runtimePromises.delete(sources);
      throw error;
    });
    runtimePromises.set(sources, promise);
    return promise;
  }

  // node_modules/@t3tools/ghostty-terminal/src/selection.ts
  var SELECTION_MULTI_CLICK_INTERVAL_MS = 500;

  // node_modules/@t3tools/ghostty-terminal/src/keyCodes.ts
  var ghosttyKeyboardCodes = [
    "Unidentified",
    "Backquote",
    "Backslash",
    "BracketLeft",
    "BracketRight",
    "Comma",
    "Digit0",
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Equal",
    "IntlBackslash",
    "IntlRo",
    "IntlYen",
    "KeyA",
    "KeyB",
    "KeyC",
    "KeyD",
    "KeyE",
    "KeyF",
    "KeyG",
    "KeyH",
    "KeyI",
    "KeyJ",
    "KeyK",
    "KeyL",
    "KeyM",
    "KeyN",
    "KeyO",
    "KeyP",
    "KeyQ",
    "KeyR",
    "KeyS",
    "KeyT",
    "KeyU",
    "KeyV",
    "KeyW",
    "KeyX",
    "KeyY",
    "KeyZ",
    "Minus",
    "Period",
    "Quote",
    "Semicolon",
    "Slash",
    "AltLeft",
    "AltRight",
    "Backspace",
    "CapsLock",
    "ContextMenu",
    "ControlLeft",
    "ControlRight",
    "Enter",
    "MetaLeft",
    "MetaRight",
    "ShiftLeft",
    "ShiftRight",
    "Space",
    "Tab",
    "Convert",
    "KanaMode",
    "NonConvert",
    "Delete",
    "End",
    "Help",
    "Home",
    "Insert",
    "PageDown",
    "PageUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "NumLock",
    "Numpad0",
    "Numpad1",
    "Numpad2",
    "Numpad3",
    "Numpad4",
    "Numpad5",
    "Numpad6",
    "Numpad7",
    "Numpad8",
    "Numpad9",
    "NumpadAdd",
    "NumpadBackspace",
    "NumpadClear",
    "NumpadClearEntry",
    "NumpadComma",
    "NumpadDecimal",
    "NumpadDivide",
    "NumpadEnter",
    "NumpadEqual",
    "NumpadMemoryAdd",
    "NumpadMemoryClear",
    "NumpadMemoryRecall",
    "NumpadMemoryStore",
    "NumpadMemorySubtract",
    "NumpadMultiply",
    "NumpadParenLeft",
    "NumpadParenRight",
    "NumpadSubtract",
    "NumpadSeparator",
    "NumpadArrowUp",
    "NumpadArrowDown",
    "NumpadArrowRight",
    "NumpadArrowLeft",
    "NumpadBegin",
    "NumpadHome",
    "NumpadEnd",
    "NumpadInsert",
    "NumpadDelete",
    "NumpadPageUp",
    "NumpadPageDown",
    "Escape",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
    "F13",
    "F14",
    "F15",
    "F16",
    "F17",
    "F18",
    "F19",
    "F20",
    "F21",
    "F22",
    "F23",
    "F24",
    "F25",
    "Fn",
    "FnLock",
    "PrintScreen",
    "ScrollLock",
    "Pause",
    "BrowserBack",
    "BrowserFavorites",
    "BrowserForward",
    "BrowserHome",
    "BrowserRefresh",
    "BrowserSearch",
    "BrowserStop",
    "Eject",
    "LaunchApp1",
    "LaunchApp2",
    "LaunchMail",
    "MediaPlayPause",
    "MediaSelect",
    "MediaStop",
    "MediaTrackNext",
    "MediaTrackPrevious",
    "Power",
    "Sleep",
    "AudioVolumeDown",
    "AudioVolumeMute",
    "AudioVolumeUp",
    "WakeUp",
    "Copy",
    "Cut",
    "Paste"
  ];
  var codeToGhosttyKey = new Map(
    ghosttyKeyboardCodes.map((code, index) => [code, index])
  );
  function ghosttyKeyForCode(code) {
    return codeToGhosttyKey.get(code) ?? 0;
  }
  var shiftedToUnshiftedCharacter = /* @__PURE__ */ new Map([
    ["!", "1"],
    ["@", "2"],
    ["#", "3"],
    ["$", "4"],
    ["%", "5"],
    ["^", "6"],
    ["&", "7"],
    ["*", "8"],
    ["(", "9"],
    [")", "0"],
    ["~", "`"],
    ["_", "-"],
    ["+", "="],
    ["{", "["],
    ["}", "]"],
    ["|", "\\"],
    [":", ";"],
    ['"', "'"],
    ["<", ","],
    [">", "."],
    ["?", "/"]
  ]);
  var keyboardLayoutMapPromise;
  function loadGhosttyKeyboardLayoutMap() {
    if (keyboardLayoutMapPromise) return keyboardLayoutMapPromise;
    const browserNavigator = globalThis.navigator;
    const keyboard = browserNavigator?.keyboard;
    const promise = keyboard?.getLayoutMap().catch(() => void 0) ?? Promise.resolve(void 0);
    keyboardLayoutMapPromise = promise;
    return promise;
  }
  function ghosttyConsumedMods(event) {
    if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return 0;
    return [...event.key].length === 1 ? 1 : 0;
  }
  function ghosttyUnshiftedCodepoint(event, layoutMap) {
    if ([...event.key].length !== 1) return 0;
    const layoutCharacter = layoutMap?.get(event.code);
    if (layoutCharacter && [...layoutCharacter].length === 1) {
      return layoutCharacter.codePointAt(0) ?? 0;
    }
    if (/^[A-Z]$/u.test(event.key)) return event.key.charCodeAt(0) + 32;
    if (event.shiftKey) {
      const unshiftedCharacter = shiftedToUnshiftedCharacter.get(event.key);
      if (unshiftedCharacter) return unshiftedCharacter.codePointAt(0) ?? 0;
      const lowercase = event.key.toLowerCase();
      if (lowercase !== event.key && [...lowercase].length === 1) {
        return lowercase.codePointAt(0) ?? 0;
      }
      return 0;
    }
    return event.key.codePointAt(0) ?? 0;
  }

  // node_modules/@t3tools/ghostty-terminal/src/core.ts
  var GHOSTTY_SUCCESS = 0;
  var GHOSTTY_OUT_OF_SPACE = -3;
  var MAX_SCROLLBACK_ROWS = 1e4;
  var SELECTION_FORMAT_OPTIONS_SIZE = 16;
  var RENDER_DATA = {
    cols: 1,
    rows: 2,
    dirty: 3,
    rowIterator: 4,
    background: 5,
    foreground: 6,
    cursor: 7,
    cursorHasValue: 8,
    cursorStyle: 10,
    cursorVisible: 11,
    cursorBlinking: 12,
    cursorInViewport: 14,
    cursorX: 15,
    cursorY: 16
  };
  var ROW_DATA = {
    dirty: 1,
    raw: 2,
    cells: 3
  };
  var CELL_DATA = {
    raw: 1,
    style: 2,
    graphemesLength: 3,
    graphemes: 4,
    background: 5,
    foreground: 6,
    selected: 7
  };
  var RAW_CELL_DATA = {
    wide: 3
  };
  var GHOSTTY_CELL_WIDE = {
    narrow: 0,
    wide: 1,
    spacerTail: 2,
    spacerHead: 3
  };
  var decoder = new TextDecoder();
  var encoder = new TextEncoder();
  function blend(foreground, background) {
    const channel = (front, back) => Math.floor((front * 155 + back * 100) / 255);
    return {
      r: channel(foreground.r, background.r),
      g: channel(foreground.g, background.g),
      b: channel(foreground.b, background.b)
    };
  }
  function sameColor(left, right) {
    return left.r === right.r && left.g === right.g && left.b === right.b;
  }
  function ghosttyCellText(codepointView, graphemeLength) {
    if (graphemeLength === 1) return String.fromCodePoint(codepointView.getUint32(0, true));
    const CHUNK_SIZE = 4096;
    let text = "";
    for (let start = 0; start < graphemeLength; start += CHUNK_SIZE) {
      const count = Math.min(CHUNK_SIZE, graphemeLength - start);
      const codes = new Array(count);
      for (let index = 0; index < count; index += 1) {
        codes[index] = codepointView.getUint32((start + index) * 4, true);
      }
      text += String.fromCodePoint(...codes);
    }
    return text;
  }
  var GhosttyTerminalCore = class _GhosttyTerminalCore {
    runtime;
    terminalSlot = 0;
    terminal = 0;
    renderStateSlot = 0;
    renderState = 0;
    rowIteratorSlot = 0;
    rowCellsSlot = 0;
    keyEncoderSlot = 0;
    keyEncoder = 0;
    keyEventSlot = 0;
    keyEvent = 0;
    mouseEncoderSlot = 0;
    mouseEncoder = 0;
    mouseEventSlot = 0;
    mouseEvent = 0;
    ptyWriterId = 0;
    ptyWriter = null;
    scratch = 0;
    graphemes = 0;
    graphemeCapacity = 0;
    style = 0;
    scrollbar = 0;
    rows = [];
    disposed = false;
    keyboardLayoutMap;
    constructor(runtime) {
      this.runtime = runtime;
      void loadGhosttyKeyboardLayoutMap().then((layoutMap) => {
        if (!this.disposed) this.keyboardLayoutMap = layoutMap;
      });
    }
    static async create(runtime, cols, rows, cellWidth, cellHeight, theme, onPtyData) {
      const core = new _GhosttyTerminalCore(runtime);
      try {
        core.initialize(cols, rows, cellWidth, cellHeight, theme, onPtyData);
        return core;
      } catch (error) {
        core.dispose();
        throw error;
      }
    }
    initialize(cols, rows, cellWidth, cellHeight, theme, onPtyData) {
      const optionsSize = this.runtime.layout("GhosttyTerminalOptions").size;
      const options = this.runtime.alloc(optionsSize);
      this.runtime.setField(options, "GhosttyTerminalOptions", "cols", cols);
      this.runtime.setField(options, "GhosttyTerminalOptions", "rows", rows);
      this.runtime.setField(options, "GhosttyTerminalOptions", "max_scrollback", MAX_SCROLLBACK_ROWS);
      this.terminalSlot = this.runtime.allocOpaque();
      const terminalResult = this.runtime.call("ghostty_terminal_new", 0, this.terminalSlot, options);
      this.runtime.free(options, optionsSize);
      this.assertSuccess("ghostty_terminal_new", terminalResult);
      this.terminal = this.runtime.readPointer(this.terminalSlot);
      this.applyDefaultCursorBlink();
      this.ptyWriter = onPtyData;
      this.ptyWriterId = this.runtime.attachPtyWriter(this.terminal, onPtyData);
      this.renderStateSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_render_state_new",
        this.runtime.call("ghostty_render_state_new", 0, this.renderStateSlot)
      );
      this.renderState = this.runtime.readPointer(this.renderStateSlot);
      this.rowIteratorSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_render_state_row_iterator_new",
        this.runtime.call("ghostty_render_state_row_iterator_new", 0, this.rowIteratorSlot)
      );
      this.rowCellsSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_render_state_row_cells_new",
        this.runtime.call("ghostty_render_state_row_cells_new", 0, this.rowCellsSlot)
      );
      this.keyEncoderSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_key_encoder_new",
        this.runtime.call("ghostty_key_encoder_new", 0, this.keyEncoderSlot)
      );
      this.keyEncoder = this.runtime.readPointer(this.keyEncoderSlot);
      this.keyEventSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_key_event_new",
        this.runtime.call("ghostty_key_event_new", 0, this.keyEventSlot)
      );
      this.keyEvent = this.runtime.readPointer(this.keyEventSlot);
      this.mouseEncoderSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_mouse_encoder_new",
        this.runtime.call("ghostty_mouse_encoder_new", 0, this.mouseEncoderSlot)
      );
      this.mouseEncoder = this.runtime.readPointer(this.mouseEncoderSlot);
      this.mouseEventSlot = this.runtime.allocOpaque();
      this.assertSuccess(
        "ghostty_mouse_event_new",
        this.runtime.call("ghostty_mouse_event_new", 0, this.mouseEventSlot)
      );
      this.mouseEvent = this.runtime.readPointer(this.mouseEventSlot);
      this.scratch = this.runtime.alloc(16);
      const styleSize = this.runtime.layout("GhosttyStyle").size;
      this.style = this.runtime.alloc(styleSize);
      this.runtime.setField(this.style, "GhosttyStyle", "size", styleSize);
      this.scrollbar = this.runtime.alloc(this.runtime.layout("GhosttyTerminalScrollbar").size);
      this.setTheme(theme);
      this.resize(cols, rows, cellWidth, cellHeight);
    }
    write(data) {
      this.ensureActive();
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      if (bytes.length === 0) return;
      const pointer = this.runtime.alloc(bytes.length);
      this.runtime.bytes(pointer, bytes.length).set(bytes);
      this.runtime.call("ghostty_terminal_vt_write", this.terminal, pointer, bytes.length);
      this.runtime.free(pointer, bytes.length);
    }
    /**
     * Erase the viewport and scrollback (ED 2 + ED 3) without an RIS: modes,
     * cursor position, and screen selection survive. This is the parser-side
     * equivalent of a host history clear, which never reaches the process —
     * `resetAndWrite` would drop negotiated modes (application cursor,
     * bracketed paste, kitty keyboard, mouse tracking) and desync input
     * encoding.
     */
    clearScreen() {
      this.ensureActive();
      this.write("\x1B[2J\x1B[3J");
    }
    replayDepth = 0;
    /**
     * Bracket a replay of output the process already emitted once. Replaying
     * bytes that contain terminal queries (DA, DSR, DECRQSS) re-answers them
     * through the PTY trampoline — the process is not re-asking, and a
     * duplicate reply confuses the shell — so the writer stays detached for
     * the whole bracket. Brackets nest by depth (attach() wraps a replay that
     * itself calls resetAndWrite).
     */
    beginReplay() {
      this.ensureActive();
      this.replayDepth += 1;
      if (this.replayDepth === 1 && this.ptyWriterId !== 0) {
        this.runtime.detachPtyWriter(this.terminal, this.ptyWriterId);
        this.ptyWriterId = 0;
      }
    }
    endReplay() {
      this.replayDepth = Math.max(0, this.replayDepth - 1);
      if (this.replayDepth === 0 && this.ptyWriter !== null && this.ptyWriterId === 0 && !this.disposed) {
        this.ptyWriterId = this.runtime.attachPtyWriter(this.terminal, this.ptyWriter);
      }
    }
    resetAndWrite(data) {
      this.ensureActive();
      this.runtime.call("ghostty_terminal_reset", this.terminal);
      this.applyDefaultCursorBlink();
      this.rows = [];
      if (data.length === 0) return;
      this.beginReplay();
      try {
        this.write(data);
      } finally {
        this.endReplay();
      }
    }
    resize(cols, rows, cellWidth, cellHeight) {
      this.ensureActive();
      this.assertSuccess(
        "ghostty_terminal_resize",
        this.runtime.call(
          "ghostty_terminal_resize",
          this.terminal,
          Math.max(1, Math.min(65535, cols)),
          Math.max(1, Math.min(65535, rows)),
          Math.max(1, Math.round(cellWidth)),
          Math.max(1, Math.round(cellHeight))
        )
      );
    }
    /**
     * Ghostty's built-in default cursor is steady, while the xterm.js renderer
     * this replaced ran with `cursorBlink: true`. Option 23 is the embedder's
     * default blink, which is the state a session starts in and returns to on
     * DECSCUSR reset (CSI 0 q), so programs that ask for a specific cursor
     * through DECSCUSR or DEC mode 12 still win.
     */
    applyDefaultCursorBlink() {
      const blink = this.runtime.alloc(1);
      this.runtime.bytes(blink, 1)[0] = 1;
      this.runtime.call("ghostty_terminal_set", this.terminal, 23, blink);
      this.runtime.free(blink, 1);
    }
    setTheme(theme) {
      this.ensureActive();
      const color = this.runtime.alloc(3);
      for (const [option, value] of [
        [11, theme.foreground],
        [12, theme.background],
        [13, theme.cursor]
      ]) {
        this.runtime.bytes(color, 3).set([value.r, value.g, value.b]);
        this.runtime.call("ghostty_terminal_set", this.terminal, option, color);
      }
      this.runtime.free(color, 3);
    }
    scroll(deltaRows) {
      this.ensureActive();
      const layout = this.runtime.layout("GhosttyTerminalScrollViewport");
      const scroll = this.runtime.alloc(layout.size);
      this.runtime.setField(scroll, "GhosttyTerminalScrollViewport", "tag", 2);
      const value = layout.fields.value;
      this.runtime.view(scroll + value.offset, value.size).setInt32(0, deltaRows, true);
      this.runtime.call("ghostty_terminal_scroll_viewport", this.terminal, scroll);
      this.runtime.free(scroll, layout.size);
    }
    scrollToBottom() {
      this.ensureActive();
      const layout = this.runtime.layout("GhosttyTerminalScrollViewport");
      const scroll = this.runtime.alloc(layout.size);
      this.runtime.setField(scroll, "GhosttyTerminalScrollViewport", "tag", 1);
      this.runtime.call("ghostty_terminal_scroll_viewport", this.terminal, scroll);
      this.runtime.free(scroll, layout.size);
    }
    isViewportActive() {
      this.ensureActive();
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_terminal_get", this.terminal, 32, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    scrollbarState() {
      this.ensureActive();
      const layout = this.runtime.layout("GhosttyTerminalScrollbar");
      this.runtime.bytes(this.scrollbar, layout.size).fill(0);
      if (this.runtime.call("ghostty_terminal_get", this.terminal, 9, this.scrollbar) !== GHOSTTY_SUCCESS) {
        return null;
      }
      return {
        total: this.runtime.readField(this.scrollbar, "GhosttyTerminalScrollbar", "total"),
        offset: this.runtime.readField(this.scrollbar, "GhosttyTerminalScrollbar", "offset"),
        len: this.runtime.readField(this.scrollbar, "GhosttyTerminalScrollbar", "len")
      };
    }
    isMouseTracking() {
      this.ensureActive();
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_terminal_get", this.terminal, 11, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    isMouseAnyEventTracking() {
      this.ensureActive();
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_terminal_mode_get", this.terminal, 1003, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    isAlternateScreen() {
      this.ensureActive();
      this.runtime.bytes(this.scratch, 4).fill(0);
      return this.runtime.call("ghostty_terminal_get", this.terminal, 6, this.scratch) === GHOSTTY_SUCCESS && this.runtime.view(this.scratch, 4).getUint32(0, true) === 1;
    }
    isApplicationCursorKeys() {
      this.ensureActive();
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_terminal_mode_get", this.terminal, 1, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    encodeKey(event, action = "press") {
      this.ensureActive();
      this.runtime.call("ghostty_key_encoder_setopt_from_terminal", this.keyEncoder, this.terminal);
      this.runtime.call(
        "ghostty_key_event_set_action",
        this.keyEvent,
        action === "release" ? 0 : event.repeat ? 2 : 1
      );
      this.runtime.call("ghostty_key_event_set_key", this.keyEvent, ghosttyKeyForCode(event.code));
      const mods = (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 1 << 1 : 0) | (event.altKey ? 1 << 2 : 0) | (event.metaKey ? 1 << 3 : 0) | (event.getModifierState("CapsLock") ? 1 << 4 : 0) | (event.getModifierState("NumLock") ? 1 << 5 : 0);
      this.runtime.call("ghostty_key_event_set_mods", this.keyEvent, mods);
      this.runtime.call(
        "ghostty_key_event_set_consumed_mods",
        this.keyEvent,
        ghosttyConsumedMods(event)
      );
      this.runtime.call("ghostty_key_event_set_composing", this.keyEvent, event.isComposing ? 1 : 0);
      this.runtime.call(
        "ghostty_key_event_set_unshifted_codepoint",
        this.keyEvent,
        ghosttyUnshiftedCodepoint(event, this.keyboardLayoutMap)
      );
      const text = event.key.length === 1 ? event.key : "";
      const textBytes = encoder.encode(text);
      const textPointer = textBytes.length === 0 ? 0 : this.runtime.alloc(textBytes.length);
      if (textPointer !== 0) this.runtime.bytes(textPointer, textBytes.length).set(textBytes);
      this.runtime.call("ghostty_key_event_set_utf8", this.keyEvent, textPointer, textBytes.length);
      const written = this.runtime.call("ghostty_wasm_alloc_usize");
      const encoded = this.encodeOutput(
        written,
        (output, outputSize) => this.runtime.call(
          "ghostty_key_encoder_encode",
          this.keyEncoder,
          this.keyEvent,
          output,
          outputSize,
          written
        )
      );
      this.runtime.call("ghostty_wasm_free_usize", written);
      if (textPointer !== 0) this.runtime.free(textPointer, textBytes.length);
      return encoded;
    }
    encodePaste(data) {
      this.ensureActive();
      const input = encoder.encode(data);
      if (input.length === 0) return "";
      const inputPointer = this.runtime.alloc(input.length);
      this.runtime.bytes(inputPointer, input.length).set(input);
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      const bracketed = this.runtime.call("ghostty_terminal_mode_get", this.terminal, 2004, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
      const written = this.runtime.call("ghostty_wasm_alloc_usize");
      let encoded = "";
      const sizeResult = this.runtime.call(
        "ghostty_paste_encode",
        inputPointer,
        input.length,
        bracketed ? 1 : 0,
        0,
        0,
        written
      );
      const outputSize = this.runtime.view(written, 4).getUint32(0, true);
      if (sizeResult === GHOSTTY_OUT_OF_SPACE && outputSize > 0) {
        const output = this.runtime.alloc(outputSize);
        const result = this.runtime.call(
          "ghostty_paste_encode",
          inputPointer,
          input.length,
          bracketed ? 1 : 0,
          output,
          outputSize,
          written
        );
        const outputLength = this.runtime.view(written, 4).getUint32(0, true);
        encoded = result === GHOSTTY_SUCCESS ? decoder.decode(this.runtime.bytes(output, outputLength)) : "";
        this.runtime.free(output, outputSize);
      }
      this.runtime.call("ghostty_wasm_free_usize", written);
      this.runtime.free(inputPointer, input.length);
      return encoded;
    }
    encodeMouse(input) {
      this.ensureActive();
      this.runtime.call(
        "ghostty_mouse_encoder_setopt_from_terminal",
        this.mouseEncoder,
        this.terminal
      );
      const sizeLayout = this.runtime.layout("GhosttyMouseEncoderSize");
      const size = this.runtime.alloc(sizeLayout.size);
      for (const [field, value] of [
        ["size", sizeLayout.size],
        ["screen_width", input.screenWidth],
        ["screen_height", input.screenHeight],
        ["cell_width", input.cellWidth],
        ["cell_height", input.cellHeight],
        ["padding_top", input.paddingTop],
        ["padding_bottom", input.paddingBottom],
        ["padding_right", input.paddingRight],
        ["padding_left", input.paddingLeft]
      ]) {
        this.runtime.setField(size, "GhosttyMouseEncoderSize", field, Math.max(0, Math.round(value)));
      }
      this.runtime.call("ghostty_mouse_encoder_setopt", this.mouseEncoder, 2, size);
      this.runtime.free(size, sizeLayout.size);
      this.runtime.bytes(this.scratch, 1)[0] = input.anyButtonPressed ? 1 : 0;
      this.runtime.call("ghostty_mouse_encoder_setopt", this.mouseEncoder, 3, this.scratch);
      this.runtime.bytes(this.scratch, 1)[0] = 1;
      this.runtime.call("ghostty_mouse_encoder_setopt", this.mouseEncoder, 4, this.scratch);
      this.runtime.call(
        "ghostty_mouse_event_set_action",
        this.mouseEvent,
        input.action === "press" ? 0 : input.action === "release" ? 1 : 2
      );
      if (input.button === null) {
        this.runtime.call("ghostty_mouse_event_clear_button", this.mouseEvent);
      } else {
        this.runtime.call("ghostty_mouse_event_set_button", this.mouseEvent, input.button);
      }
      this.runtime.call("ghostty_mouse_event_set_mods", this.mouseEvent, input.mods);
      const positionLayout = this.runtime.layout("GhosttyMousePosition");
      const position = this.runtime.alloc(positionLayout.size);
      const positionView = this.runtime.view(position, positionLayout.size);
      positionView.setFloat32(positionLayout.fields.x.offset, input.x, true);
      positionView.setFloat32(positionLayout.fields.y.offset, input.y, true);
      this.runtime.call("ghostty_mouse_event_set_position", this.mouseEvent, position);
      this.runtime.free(position, positionLayout.size);
      const written = this.runtime.call("ghostty_wasm_alloc_usize");
      const encoded = this.encodeOutput(
        written,
        (output, outputSize) => this.runtime.call(
          "ghostty_mouse_encoder_encode",
          this.mouseEncoder,
          this.mouseEvent,
          output,
          outputSize,
          written
        )
      );
      this.runtime.call("ghostty_wasm_free_usize", written);
      return encoded;
    }
    setSelection(anchor, end) {
      this.ensureActive();
      const selectionLayout = this.runtime.layout("GhosttySelection");
      const gridRefSize = this.runtime.layout("GhosttyGridRef").size;
      const selection = this.runtime.alloc(selectionLayout.size);
      let start = 0;
      let endRef = 0;
      try {
        this.runtime.setField(selection, "GhosttySelection", "size", selectionLayout.size);
        start = this.gridRef(anchor.x, anchor.y, anchor.tag ?? 1);
        endRef = this.gridRef(end.x, end.y, end.tag ?? 1);
        const startField = selectionLayout.fields.start;
        const endField = selectionLayout.fields.end;
        this.runtime.bytes(selection + startField.offset, startField.size).set(this.runtime.bytes(start, startField.size));
        this.runtime.bytes(selection + endField.offset, endField.size).set(this.runtime.bytes(endRef, endField.size));
        this.runtime.call("ghostty_terminal_set", this.terminal, 21, selection);
      } finally {
        this.runtime.free(start, gridRefSize);
        this.runtime.free(endRef, gridRefSize);
        this.runtime.free(selection, selectionLayout.size);
      }
    }
    selectAll() {
      this.ensureActive();
      const layout = this.runtime.layout("GhosttySelection");
      const selection = this.runtime.alloc(layout.size);
      this.runtime.setField(selection, "GhosttySelection", "size", layout.size);
      if (this.runtime.call("ghostty_terminal_select_all", this.terminal, selection) === GHOSTTY_SUCCESS) {
        this.runtime.call("ghostty_terminal_set", this.terminal, 21, selection);
      }
      this.runtime.free(selection, layout.size);
    }
    selectWord(col, row) {
      return this.selectAt(
        "GhosttyTerminalSelectWordOptions",
        "ghostty_terminal_select_word",
        col,
        row
      );
    }
    selectLine(col, row) {
      return this.selectAt(
        "GhosttyTerminalSelectLineOptions",
        "ghostty_terminal_select_line",
        col,
        row
      );
    }
    hyperlinkAt(col, row) {
      this.ensureActive();
      const ref = this.gridRef(col, row);
      const written = this.runtime.call("ghostty_wasm_alloc_usize");
      const sizeResult = this.runtime.call("ghostty_grid_ref_hyperlink_uri", ref, 0, 0, written);
      const outputSize = this.runtime.view(written, 4).getUint32(0, true);
      let hyperlink = null;
      if (sizeResult === GHOSTTY_OUT_OF_SPACE && outputSize > 0) {
        const output = this.runtime.alloc(outputSize);
        const result = this.runtime.call(
          "ghostty_grid_ref_hyperlink_uri",
          ref,
          output,
          outputSize,
          written
        );
        const outputLength = this.runtime.view(written, 4).getUint32(0, true);
        if (result === GHOSTTY_SUCCESS && outputLength > 0) {
          hyperlink = decoder.decode(this.runtime.bytes(output, outputLength));
        }
        this.runtime.free(output, outputSize);
      }
      this.runtime.call("ghostty_wasm_free_usize", written);
      this.runtime.free(ref, this.runtime.layout("GhosttyGridRef").size);
      return hyperlink;
    }
    clearSelection() {
      this.ensureActive();
      this.runtime.call("ghostty_terminal_set", this.terminal, 21, 0);
    }
    snapshot() {
      this.ensureActive();
      this.assertSuccess(
        "ghostty_render_state_update",
        this.runtime.call("ghostty_render_state_update", this.renderState, this.terminal)
      );
      const cols = this.getU16(RENDER_DATA.cols);
      const rowCount = this.getU16(RENDER_DATA.rows);
      const dirty = this.getU32(RENDER_DATA.dirty);
      const foreground = this.getColor(RENDER_DATA.foreground, { r: 229, g: 231, b: 235 });
      const background = this.getColor(RENDER_DATA.background, { r: 0, g: 0, b: 0 });
      const cursorHasValue = this.getBool(RENDER_DATA.cursorHasValue);
      const cursor = cursorHasValue ? this.getColor(RENDER_DATA.cursor, foreground) : foreground;
      const cursorInViewport = this.getBool(RENDER_DATA.cursorInViewport);
      const cursorVisible = this.getBool(RENDER_DATA.cursorVisible) && cursorInViewport;
      const cursorX = cursorInViewport ? this.getU16(RENDER_DATA.cursorX) : -1;
      const cursorY = cursorInViewport ? this.getU16(RENDER_DATA.cursorY) : -1;
      if (this.rows.length !== rowCount || this.rows.some((row) => row.cells.length !== cols)) {
        this.rows = Array.from({ length: rowCount }, () => ({
          cells: Array.from({ length: cols }, () => this.emptyCell(foreground, background)),
          text: "",
          isWrapContinuation: false,
          wrapsToNext: false
        }));
      }
      const dirtyRows = /* @__PURE__ */ new Set();
      if (dirty !== 0) {
        this.assertSuccess(
          "ghostty_render_state_get(row iterator)",
          this.runtime.call(
            "ghostty_render_state_get",
            this.renderState,
            RENDER_DATA.rowIterator,
            this.rowIteratorSlot
          )
        );
        const iterator = this.runtime.readPointer(this.rowIteratorSlot);
        let rowIndex = 0;
        while (rowIndex < rowCount && this.runtime.call("ghostty_render_state_row_iterator_next", iterator) !== 0) {
          const rowDirty = dirty === 2 || this.getRowBool(iterator, ROW_DATA.dirty);
          if (rowDirty) {
            this.rows[rowIndex] = this.readRow(iterator, cols, foreground, background);
            dirtyRows.add(rowIndex);
            this.runtime.bytes(this.scratch, 1)[0] = 0;
            this.runtime.call("ghostty_render_state_row_set", iterator, 0, this.scratch);
          }
          rowIndex += 1;
        }
        this.runtime.view(this.scratch, 4).setUint32(0, 0, true);
        this.runtime.call("ghostty_render_state_set", this.renderState, 0, this.scratch);
      }
      return {
        cols,
        rows: rowCount,
        foreground,
        background,
        cursor,
        cursorX,
        cursorY,
        cursorVisible,
        cursorBlinking: this.getBool(RENDER_DATA.cursorBlinking),
        cursorStyle: this.getU32(RENDER_DATA.cursorStyle),
        dirtyRows,
        rowData: this.rows
      };
    }
    selectionText() {
      this.ensureActive();
      const options = this.runtime.alloc(SELECTION_FORMAT_OPTIONS_SIZE);
      const optionsView = this.runtime.view(options, SELECTION_FORMAT_OPTIONS_SIZE);
      optionsView.setUint32(0, SELECTION_FORMAT_OPTIONS_SIZE, true);
      optionsView.setUint32(4, 0, true);
      optionsView.setUint8(8, 1);
      optionsView.setUint8(9, 1);
      optionsView.setUint32(12, 0, true);
      const written = this.runtime.call("ghostty_wasm_alloc_usize");
      const sizeResult = this.runtime.call(
        "ghostty_terminal_selection_format_buf",
        this.terminal,
        options,
        0,
        0,
        written
      );
      const outputSize = this.runtime.view(written, 4).getUint32(0, true);
      let text = "";
      if (sizeResult === GHOSTTY_OUT_OF_SPACE && outputSize > 0) {
        const output = this.runtime.alloc(outputSize);
        const result = this.runtime.call(
          "ghostty_terminal_selection_format_buf",
          this.terminal,
          options,
          output,
          outputSize,
          written
        );
        const outputLength = this.runtime.view(written, 4).getUint32(0, true);
        if (result === GHOSTTY_SUCCESS) {
          text = decoder.decode(this.runtime.bytes(output, outputLength));
        }
        this.runtime.free(output, outputSize);
      }
      this.runtime.call("ghostty_wasm_free_usize", written);
      this.runtime.free(options, SELECTION_FORMAT_OPTIONS_SIZE);
      return text;
    }
    viewportPointToScreen(col, row) {
      return this.convertPoint(col, row, 1, 2);
    }
    screenPointToViewport(col, row) {
      return this.convertPoint(col, row, 2, 1);
    }
    convertPoint(col, row, fromTag, toTag) {
      this.ensureActive();
      const ref = this.gridRef(col, row, fromTag);
      const point = this.pointFromGridRef(ref, toTag);
      this.runtime.free(ref, this.runtime.layout("GhosttyGridRef").size);
      return point;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this.mouseEvent) this.runtime.call("ghostty_mouse_event_free", this.mouseEvent);
      if (this.mouseEncoder) this.runtime.call("ghostty_mouse_encoder_free", this.mouseEncoder);
      if (this.keyEvent) this.runtime.call("ghostty_key_event_free", this.keyEvent);
      if (this.keyEncoder) this.runtime.call("ghostty_key_encoder_free", this.keyEncoder);
      if (this.rowCellsSlot) {
        const cells = this.runtime.readPointer(this.rowCellsSlot);
        if (cells) this.runtime.call("ghostty_render_state_row_cells_free", cells);
      }
      if (this.rowIteratorSlot) {
        const iterator = this.runtime.readPointer(this.rowIteratorSlot);
        if (iterator) this.runtime.call("ghostty_render_state_row_iterator_free", iterator);
      }
      if (this.renderState) this.runtime.call("ghostty_render_state_free", this.renderState);
      if (this.terminal) {
        if (this.ptyWriterId) this.runtime.detachPtyWriter(this.terminal, this.ptyWriterId);
        this.runtime.call("ghostty_terminal_free", this.terminal);
      }
      if (this.style) this.runtime.free(this.style, this.runtime.layout("GhosttyStyle").size);
      if (this.scrollbar) {
        this.runtime.free(this.scrollbar, this.runtime.layout("GhosttyTerminalScrollbar").size);
      }
      if (this.scratch) this.runtime.free(this.scratch, 16);
      if (this.graphemes) this.runtime.free(this.graphemes, this.graphemeCapacity);
      for (const slot of [
        this.mouseEventSlot,
        this.mouseEncoderSlot,
        this.keyEventSlot,
        this.keyEncoderSlot,
        this.rowCellsSlot,
        this.rowIteratorSlot,
        this.renderStateSlot,
        this.terminalSlot
      ]) {
        this.runtime.freeOpaque(slot);
      }
    }
    encodeOutput(written, encode) {
      const sizeResult = encode(0, 0);
      const outputSize = this.runtime.view(written, 4).getUint32(0, true);
      if (sizeResult === GHOSTTY_SUCCESS && outputSize === 0) return "";
      if (sizeResult !== GHOSTTY_OUT_OF_SPACE || outputSize === 0) return "";
      const output = this.runtime.alloc(outputSize);
      const result = encode(output, outputSize);
      const outputLength = this.runtime.view(written, 4).getUint32(0, true);
      const encoded = result === GHOSTTY_SUCCESS ? decoder.decode(this.runtime.bytes(output, outputLength)) : "";
      this.runtime.free(output, outputSize);
      return encoded;
    }
    readRow(iterator, cols, defaultForeground, defaultBackground) {
      this.assertSuccess(
        "ghostty_render_state_row_get(raw)",
        this.runtime.call("ghostty_render_state_row_get", iterator, ROW_DATA.raw, this.scratch)
      );
      const rawRow = this.runtime.view(this.scratch, 8).getBigUint64(0, true);
      this.runtime.bytes(this.scratch + 8, 1)[0] = 0;
      this.assertSuccess(
        "ghostty_row_get(wrap continuation)",
        this.runtime.call("ghostty_row_get", rawRow, 2, this.scratch + 8)
      );
      const isWrapContinuation = this.runtime.bytes(this.scratch + 8, 1)[0] !== 0;
      this.runtime.bytes(this.scratch + 8, 1)[0] = 0;
      this.assertSuccess(
        "ghostty_row_get(wrap)",
        this.runtime.call("ghostty_row_get", rawRow, 1, this.scratch + 8)
      );
      const wrapsToNext = this.runtime.bytes(this.scratch + 8, 1)[0] !== 0;
      this.assertSuccess(
        "ghostty_render_state_row_get(cells)",
        this.runtime.call(
          "ghostty_render_state_row_get",
          iterator,
          ROW_DATA.cells,
          this.rowCellsSlot
        )
      );
      const cellsIterator = this.runtime.readPointer(this.rowCellsSlot);
      const { size: styleSize, fields: styleFields } = this.runtime.layout("GhosttyStyle");
      const cells = [];
      while (cells.length < cols && this.runtime.call("ghostty_render_state_row_cells_next", cellsIterator) !== 0) {
        let foreground = this.getCellColor(cellsIterator, CELL_DATA.foreground, defaultForeground);
        let background = this.getCellColor(cellsIterator, CELL_DATA.background, defaultBackground);
        this.runtime.bytes(this.style, styleSize).fill(0);
        this.runtime.setField(this.style, "GhosttyStyle", "size", styleSize);
        this.runtime.call(
          "ghostty_render_state_row_cells_get",
          cellsIterator,
          CELL_DATA.style,
          this.style
        );
        const graphemeLength = this.getCellU32(cellsIterator, CELL_DATA.graphemesLength);
        let text = "";
        if (graphemeLength > 0) {
          const bufferSize = graphemeLength * 4;
          if (bufferSize > this.graphemeCapacity) {
            const capacity = Math.max(bufferSize, this.graphemeCapacity * 2);
            const buffer = this.runtime.alloc(capacity);
            this.runtime.free(this.graphemes, this.graphemeCapacity);
            this.graphemes = buffer;
            this.graphemeCapacity = capacity;
          }
          if (this.runtime.call(
            "ghostty_render_state_row_cells_get",
            cellsIterator,
            CELL_DATA.graphemes,
            this.graphemes
          ) === GHOSTTY_SUCCESS) {
            const codepointView = this.runtime.view(this.graphemes, bufferSize);
            text = ghosttyCellText(codepointView, graphemeLength);
          }
        }
        let wide = 0;
        if (text.length === 0 && cells.at(-1)?.text.length) {
          this.assertSuccess(
            "ghostty_render_state_row_cells_get(raw)",
            this.runtime.call(
              "ghostty_render_state_row_cells_get",
              cellsIterator,
              CELL_DATA.raw,
              this.scratch
            )
          );
          const rawCell = this.runtime.view(this.scratch, 8).getBigUint64(0, true);
          this.runtime.view(this.scratch + 8, 4).setUint32(0, 0, true);
          this.assertSuccess(
            "ghostty_cell_get(wide)",
            this.runtime.call("ghostty_cell_get", rawCell, RAW_CELL_DATA.wide, this.scratch + 8)
          );
          wide = this.runtime.view(this.scratch + 8, 4).getUint32(0, true);
        }
        const selected = this.getCellBool(cellsIterator, CELL_DATA.selected);
        const styleView = this.runtime.view(this.style, styleSize);
        if (styleView.getUint8(styleFields.inverse.offset) !== 0) {
          [foreground, background] = [background, foreground];
        }
        if (styleView.getUint8(styleFields.faint.offset) !== 0) {
          foreground = blend(foreground, background);
        }
        cells.push({
          text,
          wide,
          foreground,
          background,
          bold: styleView.getUint8(styleFields.bold.offset) !== 0,
          italic: styleView.getUint8(styleFields.italic.offset) !== 0,
          invisible: styleView.getUint8(styleFields.invisible.offset) !== 0,
          strikethrough: styleView.getUint8(styleFields.strikethrough.offset) !== 0,
          overline: styleView.getUint8(styleFields.overline.offset) !== 0,
          underline: styleView.getInt32(styleFields.underline.offset, true) !== 0,
          selected
        });
      }
      while (cells.length < cols) cells.push(this.emptyCell(defaultForeground, defaultBackground));
      return {
        cells,
        text: cells.map((cell) => cell.text || " ").join("").trimEnd(),
        isWrapContinuation,
        wrapsToNext
      };
    }
    gridRef(col, row, tag = 1) {
      const pointLayout = this.runtime.layout("GhosttyPoint");
      const point = this.runtime.alloc(pointLayout.size);
      this.runtime.setField(point, "GhosttyPoint", "tag", tag);
      const pointValue = pointLayout.fields.value;
      const valueOffset = pointValue.offset;
      const view = this.runtime.view(point + valueOffset, pointValue.size);
      view.setUint16(0, Math.max(0, col), true);
      view.setUint32(4, Math.max(0, row), true);
      const gridRefSize = this.runtime.layout("GhosttyGridRef").size;
      const gridRef = this.runtime.alloc(gridRefSize);
      this.runtime.setField(gridRef, "GhosttyGridRef", "size", gridRefSize);
      const result = this.runtime.call("ghostty_terminal_grid_ref", this.terminal, point, gridRef);
      this.runtime.free(point, pointLayout.size);
      if (result !== GHOSTTY_SUCCESS) {
        this.runtime.free(gridRef, gridRefSize);
        this.assertSuccess("ghostty_terminal_grid_ref", result);
      }
      return gridRef;
    }
    selectAt(optionsName, operation, col, row) {
      this.ensureActive();
      const optionsLayout = this.runtime.layout(optionsName);
      const selectionLayout = this.runtime.layout("GhosttySelection");
      const options = this.runtime.alloc(optionsLayout.size);
      let ref = 0;
      let selection = 0;
      let range = null;
      try {
        this.runtime.setField(options, optionsName, "size", optionsLayout.size);
        ref = this.gridRef(col, row);
        const refField = optionsLayout.fields.ref;
        this.runtime.bytes(options + refField.offset, refField.size).set(this.runtime.bytes(ref, refField.size));
        selection = this.runtime.alloc(selectionLayout.size);
        this.runtime.setField(selection, "GhosttySelection", "size", selectionLayout.size);
        const result = this.runtime.call(operation, this.terminal, options, selection);
        if (result === GHOSTTY_SUCCESS) {
          const start = selection + selectionLayout.fields.start.offset;
          const end = selection + selectionLayout.fields.end.offset;
          const viewportStart = this.pointFromGridRef(start, 1);
          const viewportEnd = this.pointFromGridRef(end, 1);
          const screenStart = this.pointFromGridRef(start, 2);
          const screenEnd = this.pointFromGridRef(end, 2);
          if (viewportStart && viewportEnd && screenStart && screenEnd) {
            range = {
              viewport: { start: viewportStart, end: viewportEnd },
              screen: { start: screenStart, end: screenEnd }
            };
          }
          this.runtime.call("ghostty_terminal_set", this.terminal, 21, selection);
        }
      } finally {
        this.runtime.free(selection, selectionLayout.size);
        this.runtime.free(ref, this.runtime.layout("GhosttyGridRef").size);
        this.runtime.free(options, optionsLayout.size);
      }
      return range;
    }
    pointFromGridRef(ref, tag) {
      const coordinateLayout = this.runtime.layout("GhosttyPointCoordinate");
      const coordinate = this.runtime.alloc(coordinateLayout.size);
      const result = this.runtime.call(
        "ghostty_terminal_point_from_grid_ref",
        this.terminal,
        ref,
        tag,
        coordinate
      );
      const point = result === GHOSTTY_SUCCESS ? {
        x: this.runtime.readField(coordinate, "GhosttyPointCoordinate", "x"),
        y: this.runtime.readField(coordinate, "GhosttyPointCoordinate", "y")
      } : null;
      this.runtime.free(coordinate, coordinateLayout.size);
      return point;
    }
    getU16(data) {
      this.runtime.bytes(this.scratch, 2).fill(0);
      this.assertSuccess(
        "ghostty_render_state_get",
        this.runtime.call("ghostty_render_state_get", this.renderState, data, this.scratch)
      );
      return this.runtime.view(this.scratch, 2).getUint16(0, true);
    }
    getU32(data) {
      this.runtime.bytes(this.scratch, 4).fill(0);
      this.assertSuccess(
        "ghostty_render_state_get",
        this.runtime.call("ghostty_render_state_get", this.renderState, data, this.scratch)
      );
      return this.runtime.view(this.scratch, 4).getUint32(0, true);
    }
    getBool(data) {
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      this.assertSuccess(
        "ghostty_render_state_get",
        this.runtime.call("ghostty_render_state_get", this.renderState, data, this.scratch)
      );
      return this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    getColor(data, fallback) {
      this.runtime.bytes(this.scratch, 3).fill(0);
      const result = this.runtime.call(
        "ghostty_render_state_get",
        this.renderState,
        data,
        this.scratch
      );
      return result === GHOSTTY_SUCCESS ? this.readColor(this.scratch) : fallback;
    }
    getRowBool(iterator, data) {
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_render_state_row_get", iterator, data, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    getCellU32(iterator, data) {
      this.runtime.bytes(this.scratch, 4).fill(0);
      const result = this.runtime.call(
        "ghostty_render_state_row_cells_get",
        iterator,
        data,
        this.scratch
      );
      return result === GHOSTTY_SUCCESS ? this.runtime.view(this.scratch, 4).getUint32(0, true) : 0;
    }
    getCellBool(iterator, data) {
      this.runtime.bytes(this.scratch, 1)[0] = 0;
      return this.runtime.call("ghostty_render_state_row_cells_get", iterator, data, this.scratch) === GHOSTTY_SUCCESS && this.runtime.bytes(this.scratch, 1)[0] !== 0;
    }
    getCellColor(iterator, data, fallback) {
      this.runtime.bytes(this.scratch, 3).fill(0);
      const result = this.runtime.call(
        "ghostty_render_state_row_cells_get",
        iterator,
        data,
        this.scratch
      );
      return result === GHOSTTY_SUCCESS ? this.readColor(this.scratch) : fallback;
    }
    readColor(pointer) {
      const bytes = this.runtime.bytes(pointer, 3);
      return { r: bytes[0] ?? 0, g: bytes[1] ?? 0, b: bytes[2] ?? 0 };
    }
    emptyCell(foreground, background) {
      return {
        text: "",
        wide: 0,
        foreground,
        background,
        bold: false,
        italic: false,
        invisible: false,
        strikethrough: false,
        overline: false,
        underline: false,
        selected: false
      };
    }
    assertSuccess(operation, result) {
      if (result !== GHOSTTY_SUCCESS) throw new Error(`${operation} failed with result ${result}`);
    }
    ensureActive() {
      if (this.disposed) throw new Error("libghostty-vt terminal has been disposed");
    }
  };
  function ghosttyColorsEqual(left, right) {
    return sameColor(left, right);
  }

  // node_modules/@t3tools/ghostty-terminal/src/renderer.ts
  var DEFAULT_SELECTION_BACKGROUND = "rgba(72, 122, 191, 0.35)";
  function cssColor(color) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  function sameTextStyle(left, right) {
    return ghosttyColorsEqual(left.foreground, right.foreground) && left.bold === right.bold && left.italic === right.italic && left.invisible === right.invisible;
  }
  function ghosttyTextRunEnd(cells, start, sameStyle) {
    let end = start + 1;
    while (end < cells.length) {
      const next = cells[end];
      if (!next) break;
      if (next.wide === GHOSTTY_CELL_WIDE.spacerTail) {
        end += 1;
        continue;
      }
      if (next.text.length === 0 || !sameStyle(next)) break;
      end += 1;
    }
    return end;
  }
  function fontForCell(cell, fontSize, fontFamily) {
    const style = cell.italic ? "italic" : "normal";
    const weight = cell.bold ? "700" : "400";
    return `${style} ${weight} ${fontSize}px ${fontFamily}`;
  }
  function measureGhosttyCell(context, fontSize, fontFamily) {
    context.font = `normal 400 ${fontSize}px ${fontFamily}`;
    const widthMeasurement = context.measureText("M");
    const verticalMeasurement = context.measureText("Mg");
    const ascent = verticalMeasurement.actualBoundingBoxAscent || fontSize;
    const descent = verticalMeasurement.actualBoundingBoxDescent;
    const glyphHeight = ascent + descent;
    const height = Math.max(1, Math.round(fontSize * 1.35), Math.ceil(glyphHeight));
    return {
      width: Math.max(1, widthMeasurement.width),
      height,
      baseline: Math.round((height - glyphHeight) / 2 + ascent)
    };
  }
  function terminalGridSize(width, height, metrics, padding) {
    return {
      cols: Math.max(1, Math.floor((width - padding * 2) / metrics.width)),
      rows: Math.max(1, Math.floor((height - padding * 2) / metrics.height))
    };
  }
  function renderGhosttySnapshot(options) {
    const {
      context,
      snapshot,
      metrics,
      fontSize,
      fontFamily,
      padding,
      forceFull,
      cursorOn,
      previousCursorY
    } = options;
    const focused = options.focused ?? true;
    const selectionBackground = options.selectionBackground ?? DEFAULT_SELECTION_BACKGROUND;
    const hoveredLinkRange = options.hoveredLinkRange ?? null;
    const originY = options.originY ?? padding;
    const rowsToDraw = forceFull ? Array.from({ length: snapshot.rows }, (_, index) => index) : [...snapshot.dirtyRows];
    if (previousCursorY !== null && previousCursorY !== void 0 && previousCursorY >= 0 && !rowsToDraw.includes(previousCursorY)) {
      rowsToDraw.push(previousCursorY);
    }
    if (snapshot.cursorVisible && snapshot.cursorY >= 0 && !rowsToDraw.includes(snapshot.cursorY)) {
      rowsToDraw.push(snapshot.cursorY);
    }
    if (forceFull) {
      context.save();
      context.resetTransform();
      context.fillStyle = cssColor(snapshot.background);
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
      context.restore();
    }
    context.textBaseline = "alphabetic";
    for (const rowIndex of rowsToDraw) {
      const row = snapshot.rowData[rowIndex];
      if (!row) continue;
      const top = originY + rowIndex * metrics.height;
      context.fillStyle = cssColor(snapshot.background);
      context.fillRect(padding, top, snapshot.cols * metrics.width, metrics.height);
      let backgroundStart = 0;
      while (backgroundStart < row.cells.length) {
        const first = row.cells[backgroundStart];
        if (!first) break;
        let backgroundEnd = backgroundStart + 1;
        while (backgroundEnd < row.cells.length) {
          const next = row.cells[backgroundEnd];
          if (!next || next.selected !== first.selected || !ghosttyColorsEqual(next.background, first.background)) {
            break;
          }
          backgroundEnd += 1;
        }
        if (first.selected || !ghosttyColorsEqual(first.background, snapshot.background)) {
          const left = padding + backgroundStart * metrics.width;
          const width = (backgroundEnd - backgroundStart) * metrics.width;
          if (!ghosttyColorsEqual(first.background, snapshot.background)) {
            context.fillStyle = cssColor(first.background);
            context.fillRect(left, top, width, metrics.height);
          }
          if (first.selected) {
            context.fillStyle = selectionBackground;
            context.fillRect(left, top, width, metrics.height);
          }
        }
        backgroundStart = backgroundEnd;
      }
      let runStart = 0;
      while (runStart < row.cells.length) {
        const first = row.cells[runStart];
        if (!first) break;
        if (first.text.length === 0) {
          runStart += 1;
          continue;
        }
        const runEnd = ghosttyTextRunEnd(row.cells, runStart, (cell) => sameTextStyle(cell, first));
        const text = row.cells.slice(runStart, runEnd).map((cell) => cell.text).join("");
        if (!first.invisible && text.trim().length > 0) {
          context.save();
          context.beginPath();
          context.rect(
            padding + runStart * metrics.width,
            top,
            (runEnd - runStart) * metrics.width,
            metrics.height
          );
          context.clip();
          context.font = fontForCell(first, fontSize, fontFamily);
          context.fillStyle = cssColor(first.foreground);
          context.fillText(
            text,
            padding + runStart * metrics.width,
            top + metrics.baseline,
            (runEnd - runStart) * metrics.width
          );
          context.restore();
        }
        runStart = runEnd;
      }
      for (let column = 0; column < row.cells.length; column += 1) {
        const cell = row.cells[column];
        const hoveredLink = hoveredLinkRange !== null && rowIndex >= hoveredLinkRange.start.y && rowIndex <= hoveredLinkRange.end.y && (rowIndex > hoveredLinkRange.start.y || column >= hoveredLinkRange.start.x) && (rowIndex < hoveredLinkRange.end.y || column <= hoveredLinkRange.end.x);
        if (!cell || !cell.underline && !cell.strikethrough && !cell.overline && !hoveredLink) {
          continue;
        }
        context.fillStyle = cssColor(cell.foreground);
        const left = padding + column * metrics.width;
        if (cell.underline || hoveredLink) {
          context.fillRect(left, top + metrics.height - 2, metrics.width, 1);
        }
        if (cell.strikethrough) {
          context.fillRect(left, top + Math.floor(metrics.height * 0.55), metrics.width, 1);
        }
        if (cell.overline) context.fillRect(left, top + 1, metrics.width, 1);
      }
    }
    if (cursorOn && snapshot.cursorVisible && snapshot.cursorX >= 0 && snapshot.cursorY >= 0) {
      const left = padding + snapshot.cursorX * metrics.width;
      const top = originY + snapshot.cursorY * metrics.height;
      context.fillStyle = cssColor(snapshot.cursor);
      if (!focused) {
        context.strokeStyle = cssColor(snapshot.cursor);
        context.strokeRect(left + 0.5, top + 0.5, metrics.width - 1, metrics.height - 1);
      } else if (snapshot.cursorStyle === 0) {
        context.fillRect(left, top, 2, metrics.height);
      } else if (snapshot.cursorStyle === 2) {
        context.fillRect(left, top + metrics.height - 2, metrics.width, 2);
      } else if (snapshot.cursorStyle === 3) {
        context.strokeStyle = cssColor(snapshot.cursor);
        context.strokeRect(left + 0.5, top + 0.5, metrics.width - 1, metrics.height - 1);
      } else {
        context.fillRect(left, top, metrics.width, metrics.height);
        const cell = snapshot.rowData[snapshot.cursorY]?.cells[snapshot.cursorX];
        if (cell?.text) {
          context.font = fontForCell(cell, fontSize, fontFamily);
          context.fillStyle = cssColor(snapshot.background);
          context.fillText(cell.text, left, top + metrics.baseline, metrics.width);
        }
      }
    }
  }

  // node_modules/@t3tools/ghostty-terminal/src/monospaceFonts.ts
  function quoteFontFamilyName(name) {
    const bare = name.trim();
    if (bare.length === 0) return "";
    if (/^(['"]).*\1$/.test(bare)) return bare;
    if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;
    return `"${bare.replaceAll('"', "")}"`;
  }
  function cssFontFamilies(input) {
    const families = input.split(",").map(quoteFontFamilyName).filter((name) => name.length > 0);
    return families.length > 0 ? families.join(", ") : null;
  }
  var fontProbeContext;
  var MONOSPACE_PROBE_VARIANTS = ["normal 400", "normal 700", "italic 400", "italic 700"];
  var MONOSPACE_PROBE_GLYPHS = ["i", "M", "W", "0", "@", "#", ".", " "];
  var MONOSPACE_ADVANCE_TOLERANCE = 0.01;
  function areFontAdvancesMonospace(advances) {
    const reference = advances[0];
    if (reference === void 0 || reference <= 0 || advances.some((advance) => !Number.isFinite(advance) || advance <= 0)) {
      return true;
    }
    return advances.every((advance) => Math.abs(advance - reference) < MONOSPACE_ADVANCE_TOLERANCE);
  }
  function isMonospaceFamily(family) {
    const families = cssFontFamilies(family);
    if (families === null) return true;
    try {
      if (fontProbeContext === void 0) {
        fontProbeContext = document.createElement("canvas").getContext("2d");
      }
      if (fontProbeContext === null) return true;
      const context = fontProbeContext;
      for (const variant of MONOSPACE_PROBE_VARIANTS) {
        context.font = `${variant} 32px ${families}, monospace`;
        const advances = MONOSPACE_PROBE_GLYPHS.map((glyph) => context.measureText(glyph).width);
        if (!areFontAdvancesMonospace(advances)) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  // node_modules/@t3tools/ghostty-terminal/src/surface.ts
  var DEFAULT_TERMINAL_FONT_SIZE = 12;
  var MIN_TERMINAL_FONT_SIZE = 6;
  var MAX_TERMINAL_FONT_SIZE = 32;
  var TERMINAL_GLYPH_FALLBACKS = '"Symbols Nerd Font Mono", "Symbols Nerd Font", "JetBrainsMono Nerd Font", "JetBrainsMono NF", "FiraCode Nerd Font", "Hack Nerd Font", "MesloLGS NF", "CaskaydiaCove Nerd Font", "PowerlineSymbols", monospace';
  var DEFAULT_TERMINAL_FONT_FAMILY = '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", ' + TERMINAL_GLYPH_FALLBACKS;
  var CONTENT_PADDING = 4;
  var MIN_SCROLLBAR_THUMB_HEIGHT = 18;
  var CURSOR_BLINK_INTERVAL_MS = 500;
  var TERMINAL_FONT_LOAD_TEXT = "iMW0@# .";
  var TERMINAL_FONT_LOAD_VARIANTS = [
    "normal 400",
    "normal 700",
    "italic 400",
    "italic 700"
  ];
  var symbolsFontLoad = null;
  function ensureTerminalSymbolsFont(symbolsFontUrl) {
    if (symbolsFontUrl === void 0) return Promise.resolve();
    if (symbolsFontLoad !== null) return symbolsFontLoad;
    symbolsFontLoad = (async () => {
      try {
        const face = new FontFace("Symbols Nerd Font Mono", `url(${symbolsFontUrl})`);
        document.fonts.add(await face.load());
      } catch {
      }
    })();
    return symbolsFontLoad;
  }
  function quoteTerminalFontFamilies(list) {
    return list.split(",").map((name) => {
      const bare = name.trim();
      if (bare.length === 0) return "";
      if (/^(['"]).*\1$/.test(bare)) return bare;
      if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;
      return `"${bare.replaceAll('"', "")}"`;
    }).filter((name) => name.length > 0).join(", ");
  }
  function uncheckedTerminalFontFamily(family) {
    const custom = family === void 0 ? "" : quoteTerminalFontFamilies(family);
    return custom.length === 0 ? DEFAULT_TERMINAL_FONT_FAMILY : `${custom}, ${TERMINAL_GLYPH_FALLBACKS}`;
  }
  function terminalFontFamily(family) {
    const custom = family === void 0 ? "" : quoteTerminalFontFamilies(family);
    if (custom.length === 0) return DEFAULT_TERMINAL_FONT_FAMILY;
    if (!isMonospaceFamily(custom)) return DEFAULT_TERMINAL_FONT_FAMILY;
    return uncheckedTerminalFontFamily(custom);
  }
  async function loadTerminalFontFamily(family, size, environment) {
    const candidate = uncheckedTerminalFontFamily(family);
    const load = environment?.load ?? ((font, text) => document.fonts.load(font, text));
    try {
      await Promise.all(
        TERMINAL_FONT_LOAD_VARIANTS.map(
          (variant) => load(`${variant} ${size}px ${candidate}`, TERMINAL_FONT_LOAD_TEXT)
        )
      );
    } catch {
    }
    return (environment?.resolve ?? terminalFontFamily)(family);
  }
  function terminalFontSize(size) {
    if (size === void 0 || !Number.isFinite(size)) return DEFAULT_TERMINAL_FONT_SIZE;
    return Math.max(MIN_TERMINAL_FONT_SIZE, Math.min(MAX_TERMINAL_FONT_SIZE, Math.round(size)));
  }
  function shouldBlinkTerminalCursor(state2) {
    return state2.focused && state2.cursorBlinking && state2.cursorVisible && !state2.reducedMotion;
  }
  function terminalContentOriginY(mountHeight, padding, rows, cellHeight, anchorBottom) {
    if (!anchorBottom) return padding;
    const slack = mountHeight - padding * 2 - rows * cellHeight;
    return padding + Math.max(0, slack);
  }
  function terminalScrollbarGeometry(state2, trackHeight) {
    const total = Math.max(0, state2.total);
    const len = Math.max(0, Math.min(state2.len, total));
    const maxOffset = Math.max(0, total - len);
    if (trackHeight <= 0 || len <= 0 || maxOffset === 0) return null;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(MIN_SCROLLBAR_THUMB_HEIGHT, trackHeight * len / total)
    );
    const travel = Math.max(0, trackHeight - thumbHeight);
    const offset = Math.max(0, Math.min(state2.offset, maxOffset));
    return {
      thumbHeight,
      thumbTop: travel * (offset / maxOffset),
      maxOffset
    };
  }
  function terminalScrollbarOffsetAtPointer(state2, trackHeight, pointerY, pointerOffset) {
    const geometry = terminalScrollbarGeometry(state2, trackHeight);
    if (geometry === null) return 0;
    const travel = Math.max(0, trackHeight - geometry.thumbHeight);
    if (travel === 0) return 0;
    const thumbTop = Math.max(0, Math.min(pointerY - pointerOffset, travel));
    return Math.round(thumbTop / travel * geometry.maxOffset);
  }
  function terminalGridCellAt(options) {
    const { bounds, clientX, clientY, cols, rows, metrics, padding, originY } = options;
    const gridX = clientX - bounds.left - padding;
    const gridY = clientY - bounds.top - originY;
    if (gridX < 0 || gridY < 0 || gridX >= cols * metrics.width || gridY >= rows * metrics.height) {
      return null;
    }
    return {
      x: Math.floor(gridX / metrics.width),
      y: Math.floor(gridY / metrics.height)
    };
  }
  function terminalRowText(row, trimRight) {
    const text = row.cells.map((cell) => cell.text || " ").join("");
    return trimRight ? text.trimEnd() : text;
  }
  function terminalColumnOffset(row, column) {
    let offset = 0;
    for (let cellIndex = 0; cellIndex < column; cellIndex += 1) {
      offset += row.cells[cellIndex]?.text.length || 1;
    }
    return offset;
  }
  function isSameTerminalLink(left, right) {
    return right?.text === left.text && right.range.start.x === left.range.start.x && right.range.start.y === left.range.start.y && right.range.end.x === left.range.end.x && right.range.end.y === left.range.end.y;
  }
  function terminalColumnAtOffset(row, offset) {
    for (let column = 0; column < row.cells.length; column += 1) {
      const nextOffset = terminalColumnOffset(row, column + 1);
      if (offset < nextOffset) return column;
    }
    return Math.max(0, row.cells.length - 1);
  }
  function terminalLinkAtPositionWithRange(rows, rowIndex, column) {
    const wrappedLine = collectWrappedTerminalLinkLine(rowIndex + 1, (index) => {
      const row2 = rows[index];
      if (!row2) return null;
      return {
        isWrapped: row2.isWrapContinuation,
        translateToString: (trimRight = false) => terminalRowText(row2, trimRight)
      };
    });
    if (!wrappedLine) return null;
    const firstSegment = wrappedLine.segments[0];
    if (firstSegment && rows[firstSegment.bufferLineNumber - 1]?.isWrapContinuation) {
      return null;
    }
    const segment = wrappedLine.segments.find((value) => value.bufferLineNumber === rowIndex + 1);
    const row = rows[rowIndex];
    if (!segment || !row) return null;
    const lastSegment = wrappedLine.segments.at(-1);
    const lastRow = lastSegment ? rows[lastSegment.bufferLineNumber - 1] : void 0;
    const continuesBelowViewport = lastRow !== void 0 && lastRow.wrapsToNext;
    const offset = segment.startIndex + terminalColumnOffset(row, column);
    for (const match of extractTerminalLinks(wrappedLine.text)) {
      if (offset >= match.start && offset < match.end) {
        if (match.end === wrappedLine.text.length && continuesBelowViewport) return null;
        const startSegment = wrappedLine.segments.find(
          (value) => match.start >= value.startIndex && match.start < value.endIndex
        );
        const endSegment = wrappedLine.segments.find(
          (value) => match.end - 1 >= value.startIndex && match.end - 1 < value.endIndex
        );
        const startRow = startSegment ? rows[startSegment.bufferLineNumber - 1] : void 0;
        const endRow = endSegment ? rows[endSegment.bufferLineNumber - 1] : void 0;
        if (!startSegment || !endSegment || !startRow || !endRow) return null;
        return {
          text: match.text,
          range: {
            start: {
              x: terminalColumnAtOffset(startRow, match.start - startSegment.startIndex),
              y: startSegment.bufferLineNumber - 1
            },
            end: {
              x: terminalColumnAtOffset(endRow, match.end - 1 - endSegment.startIndex),
              y: endSegment.bufferLineNumber - 1
            }
          }
        };
      }
    }
    return null;
  }
  function isTerminalCopyShortcut(event, platform = navigator.platform) {
    const key = event.key.toLowerCase();
    if (key === "insert" && !isMacPlatform(platform)) {
      return event.ctrlKey && !event.shiftKey && !event.metaKey;
    }
    if (key !== "c") return false;
    return isMacPlatform(platform) ? event.metaKey : event.ctrlKey;
  }
  function primeTerminalCopyInput(input, selection) {
    input.value = selection;
    if (selection.length === 0) return;
    input.select();
  }
  function clearPrimedTerminalCopyInput(input, primedSelection) {
    if (primedSelection.length === 0 || input.value !== primedSelection) return;
    input.value = "";
  }
  function applyTerminalCopyEvent(selection, clipboardData) {
    if (selection.length === 0 || !clipboardData) {
      return { preventDefault: false, claimWriteFallback: false };
    }
    clipboardData.setData("text/plain", selection);
    return { preventDefault: true, claimWriteFallback: true };
  }
  function isTerminalPasteShortcut(event, platform = navigator.platform) {
    const key = event.key.toLowerCase();
    if (key === "insert" && !isMacPlatform(platform)) {
      return event.shiftKey && !event.ctrlKey && !event.metaKey;
    }
    if (key !== "v") return false;
    return isMacPlatform(platform) ? event.metaKey : event.ctrlKey && event.shiftKey;
  }
  function isMiddleClickPastePlatform() {
    return /linux|bsd/i.test(navigator.platform);
  }
  function isTerminalCompositionCommitInput(event) {
    return event.inputType === "" || event.inputType === "insertCompositionText" || event.inputType === "insertFromComposition";
  }
  function isTerminalCompositionKey(event, composing) {
    return event.isComposing || composing || event.key === "Process" || event.keyCode === 229;
  }
  function isTerminalAltGraphText(event) {
    return event.getModifierState("AltGraph") && [...event.key].length === 1;
  }
  function shouldReportTerminalMouse(tracking, event) {
    return tracking && !event.shiftKey && !event.ctrlKey && !event.metaKey;
  }
  function resolveTerminalMouseData(action, data, previousMotionData) {
    const nextMotionData = action === "motion" ? data : "";
    return {
      send: data.length > 0 && (action !== "motion" || data !== previousMotionData),
      nextMotionData
    };
  }
  function resolveTerminalMouseTrackingState(previousTracking, tracking, motionData) {
    return {
      tracking,
      motionData: previousTracking === tracking ? motionData : ""
    };
  }
  function terminalWheelDeltaRows(event, cellHeight, viewportRows, remainder) {
    const pixels = event.deltaMode === 1 ? event.deltaY * cellHeight : event.deltaMode === 2 ? event.deltaY * viewportRows * cellHeight : event.deltaY;
    const total = remainder + pixels / cellHeight;
    const rows = Math.trunc(total);
    return { rows, remainder: total - rows };
  }
  function terminalWheelArrowData(rows, applicationCursorKeys) {
    if (rows === 0) return "";
    const sequence = rows < 0 ? applicationCursorKeys ? "\x1BOA" : "\x1B[A" : applicationCursorKeys ? "\x1BOB" : "\x1B[B";
    return sequence.repeat(Math.abs(rows));
  }
  function ghosttyMouseButton(button) {
    switch (button) {
      case 0:
        return 1;
      case 1:
        return 3;
      case 2:
        return 2;
      case 3:
        return 4;
      case 4:
        return 5;
      default:
        return null;
    }
  }
  var TERMINAL_LINK_DRAG_THRESHOLD_PX = 4;
  function advanceTerminalSelectionClickSequence(previous, event) {
    const repeats = previous !== null && event.timeStamp - previous.time <= SELECTION_MULTI_CLICK_INTERVAL_MS && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= TERMINAL_LINK_DRAG_THRESHOLD_PX;
    return {
      count: repeats ? previous.count >= 3 ? 1 : previous.count + 1 : 1,
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY
    };
  }
  var GhosttyTerminalSurface = class _GhosttyTerminalSurface {
    canvas;
    input;
    scrollbar;
    cols = 1;
    rows = 1;
    mount;
    context;
    core;
    options;
    visible;
    hasSize = false;
    metrics;
    fontFamily;
    requestedFontFamily;
    fontSize;
    fontEpoch = 0;
    pendingFontEpoch = null;
    resizeObserver;
    scrollbarThumb;
    snapshot = null;
    frame = 0;
    cursorTimer = null;
    compositionInputToSuppress = null;
    compositionSuppressionTimer = null;
    cursorOn = true;
    renderedCursorY = null;
    forceFullRender = true;
    scrollbarDirty = true;
    scrollbarState = null;
    scrollbarPointerId = null;
    scrollbarPointerOffset = 0;
    disposed = false;
    resizeNotifyTimer = null;
    originY = CONTENT_PADDING;
    mountHeight = 0;
    selectionEnd = null;
    selectionAnchorScreen = null;
    selectionEndScreen = null;
    selectionMode = "cell";
    // Word/line selection base in screen coordinates so streaming output cannot
    // shift the origin of a drag selection.
    selectionBase = null;
    selectionScrollTimer = null;
    selectionScrollDelta = 0;
    selectionPointer = null;
    mouseReportingPointerId = null;
    mouseReportingButton = null;
    linkActivationPointerId = null;
    linkActivationLink = null;
    linkActivationOrigin = null;
    hoveredLink = null;
    hoverPointer = null;
    selectionClickSequence = null;
    selectionMoved = false;
    composing = false;
    focused = false;
    resizeNotified = false;
    canvasConfigured = false;
    theme;
    /**
     * Codes whose latest press this surface encoded to the PTY. Only those get
     * a release: a press consumed anywhere else — beforeKey, copy/paste, or a
     * host dispatcher that stopped the keydown before it reached the input —
     * must not leak a Kitty report-event-types release the shell never saw
     * pressed.
     */
    encodedKeyCodes = /* @__PURE__ */ new Set();
    pasteShortcutToken = 0;
    copyShortcutToken = 0;
    clearSelectionAfterCopy = false;
    primedCopySelection = "";
    wheelRemainder = 0;
    lastMouseMotionData = "";
    mouseAnyEventTracking = false;
    dprMedia = null;
    // Read live on every blink decision, and watched so that dropping the
    // preference restarts a blink cycle that has no timer left to notice it.
    reducedMotionMedia = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    inputLeft = -1;
    inputTop = -1;
    constructor(mount, canvas, input, scrollbar, scrollbarThumb, context, core, metrics, fontFamily, options) {
      this.mount = mount;
      this.canvas = canvas;
      this.input = input;
      this.scrollbar = scrollbar;
      this.scrollbarThumb = scrollbarThumb;
      this.context = context;
      this.core = core;
      this.mouseAnyEventTracking = core.isMouseAnyEventTracking();
      this.metrics = metrics;
      this.options = options;
      this.visible = options.visible ?? true;
      this.theme = options.theme;
      this.fontFamily = fontFamily;
      this.requestedFontFamily = options.font?.family;
      this.fontSize = terminalFontSize(options.font?.size);
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.installEvents();
      this.watchDevicePixelRatio();
      this.reducedMotionMedia?.addEventListener("change", this.onReducedMotionChange);
      document.fonts.addEventListener("loadingdone", this.onFontsLoaded);
      this.resizeObserver.observe(mount);
    }
    static async create(mount, options) {
      const runtime = Promise.resolve(options.runtime);
      runtime.catch(() => {
      });
      const canvas = document.createElement("canvas");
      canvas.className = "block size-full cursor-text";
      canvas.setAttribute("aria-hidden", "true");
      const input = document.createElement("textarea");
      input.className = "t3-ghostty-input";
      input.setAttribute("aria-label", "Terminal input");
      input.autocapitalize = "off";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.style.cssText = "position:absolute;left:4px;top:4px;width:1px;height:1px;opacity:0;padding:0;border:0;resize:none;pointer-events:none;";
      const scrollbar = document.createElement("div");
      scrollbar.className = "group absolute top-1 right-px bottom-1 z-1 w-[var(--app-scrollbar-width)] cursor-default touch-none";
      scrollbar.setAttribute("role", "scrollbar");
      scrollbar.setAttribute("aria-label", "Terminal scrollback");
      scrollbar.setAttribute("aria-orientation", "vertical");
      scrollbar.tabIndex = 0;
      scrollbar.hidden = true;
      const scrollbarThumb = document.createElement("div");
      scrollbarThumb.className = "absolute inset-x-px top-0 rounded-[3px] bg-[var(--app-scrollbar-thumb)] transition-[background-color] duration-[120ms] ease-[ease-out] group-hover:bg-[var(--app-scrollbar-thumb-hover)] group-focus-visible:bg-[var(--app-scrollbar-thumb-hover)]";
      scrollbar.append(scrollbarThumb);
      mount.replaceChildren(canvas, input, scrollbar);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D is unavailable");
      context.fillStyle = `rgb(${options.theme.background.r}, ${options.theme.background.g}, ${options.theme.background.b})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const fontSize = terminalFontSize(options.font?.size);
      try {
        await ensureTerminalSymbolsFont(options.symbolsFontUrl);
      } catch {
      }
      const fontFamily = await loadTerminalFontFamily(options.font?.family, fontSize);
      const metrics = measureGhosttyCell(context, fontSize, fontFamily);
      const grid = terminalGridSize(mount.clientWidth, mount.clientHeight, metrics, CONTENT_PADDING);
      const core = await GhosttyTerminalCore.create(
        await runtime,
        grid.cols,
        grid.rows,
        metrics.width,
        metrics.height,
        options.theme,
        options.onData
      );
      const surface = new _GhosttyTerminalSurface(
        mount,
        canvas,
        input,
        scrollbar,
        scrollbarThumb,
        context,
        core,
        metrics,
        fontFamily,
        options
      );
      surface.fit();
      return surface;
    }
    /** Pause canvas work without interrupting output parsing or terminal replies. */
    setVisible(visible) {
      if (this.disposed || this.visible === visible) return;
      this.visible = visible;
      this.cursorOn = true;
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      if (!visible) {
        this.cancelRender();
        this.setSelectionAutoscroll(0);
        return;
      }
      this.fit();
    }
    write(data) {
      if (this.disposed) return;
      this.core.write(data);
      this.synchronizeMouseTrackingState();
      this.cursorOn = true;
      this.scrollbarDirty = true;
      this.requestRender();
    }
    resetAndWrite(data) {
      if (this.disposed) return;
      this.lastMouseMotionData = "";
      this.core.resetAndWrite(data);
      this.synchronizeMouseTrackingState();
      this.cursorOn = true;
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      this.requestRender();
    }
    /**
     * Bracket a whole remount replay (base + retained tail). Terminal queries
     * inside replayed bytes were already answered by the previous parser, so
     * the PTY writer stays detached for the bracket — the process is not
     * re-asking and a duplicate reply confuses the shell.
     */
    beginReplay() {
      if (this.disposed) return;
      this.core.beginReplay();
    }
    endReplay() {
      if (this.disposed) return;
      this.core.endReplay();
      this.synchronizeMouseTrackingState();
    }
    /**
     * Host history clear: the server dropped retained output only — the
     * process and its negotiated modes keep running. ED2+ED3 erase the
     * viewport and scrollback without the RIS that resetAndWrite performs, so
     * application-cursor, bracketed-paste, kitty-keyboard, and mouse state
     * survive and input keeps encoding the way the process expects.
     */
    clearScreen() {
      if (this.disposed) return;
      this.core.clearScreen();
      this.synchronizeMouseTrackingState();
      this.cursorOn = true;
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      this.scrollToBottom();
      this.requestRender();
    }
    setTheme(theme) {
      if (this.disposed) return;
      this.theme = theme;
      this.core.setTheme(theme);
      this.forceFullRender = true;
      this.requestRender();
    }
    async setFont(font) {
      if (this.disposed) return;
      const fontSize = terminalFontSize(font.size);
      const epoch = ++this.fontEpoch;
      this.pendingFontEpoch = epoch;
      const fontFamily = await loadTerminalFontFamily(font.family, fontSize);
      if (this.disposed || epoch !== this.fontEpoch) return;
      this.pendingFontEpoch = null;
      this.fontFamily = fontFamily;
      this.requestedFontFamily = font.family;
      this.fontSize = fontSize;
      this.applyFontMetrics();
    }
    applyFontMetrics() {
      this.metrics = measureGhosttyCell(this.context, this.fontSize, this.fontFamily);
      this.core.resize(this.cols, this.rows, this.metrics.width, this.metrics.height);
      this.inputLeft = -1;
      this.inputTop = -1;
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      this.fit();
      this.requestRender();
    }
    onReducedMotionChange = () => {
      if (this.disposed) return;
      this.cursorOn = true;
      this.requestRender();
    };
    onFontsLoaded = () => {
      if (this.disposed) return;
      if (this.pendingFontEpoch !== null) return;
      const fontFamily = terminalFontFamily(this.requestedFontFamily);
      if (fontFamily !== this.fontFamily) {
        this.fontFamily = fontFamily;
        this.applyFontMetrics();
        return;
      }
      const metrics = measureGhosttyCell(this.context, this.fontSize, this.fontFamily);
      if (metrics.width === this.metrics.width && metrics.height === this.metrics.height && metrics.baseline === this.metrics.baseline) {
        return;
      }
      this.applyFontMetrics();
    };
    fit() {
      if (this.disposed || !this.visible) return false;
      const width = this.mount.clientWidth;
      const height = this.mount.clientHeight;
      if (width <= 0 || height <= 0) {
        this.hasSize = false;
        this.forceFullRender = true;
        this.cancelRender();
        return false;
      }
      this.hasSize = true;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      let shouldRender = false;
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight || !this.canvasConfigured) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
        this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.canvasConfigured = true;
        this.forceFullRender = true;
        this.scrollbarDirty = true;
        shouldRender = true;
      }
      const grid = terminalGridSize(width, height, this.metrics, CONTENT_PADDING);
      this.mountHeight = height;
      if (grid.cols !== this.cols || grid.rows !== this.rows || !this.resizeNotified) {
        this.cols = grid.cols;
        this.rows = grid.rows;
        this.core.resize(grid.cols, grid.rows, this.metrics.width, this.metrics.height);
        this.notifyResize();
        this.forceFullRender = true;
        this.scrollbarDirty = true;
        shouldRender = true;
      }
      if (shouldRender || this.forceFullRender) this.renderFrame();
      return true;
    }
    /**
     * The local grid reflows immediately, but the PTY only hears about settled
     * dimensions: notifying on every drag step makes the shell reprint its
     * prompt mid-drag, which reads as jitter.
     */
    notifyResize() {
      this.resizeNotified = true;
      if (this.resizeNotifyTimer !== null) window.clearTimeout(this.resizeNotifyTimer);
      this.resizeNotifyTimer = window.setTimeout(() => {
        this.resizeNotifyTimer = null;
        if (!this.disposed) this.options.onResize(this.cols, this.rows);
      }, 150);
    }
    focus() {
      if (this.disposed || !this.visible) return;
      this.input.focus({ preventScroll: true });
    }
    /**
     * Pastes clipboard text read by the host (context menu) with the same
     * bracketed-paste encoding as a native paste event. The read joins the same
     * race the paste shortcut uses — the token is claimed before it starts — so
     * a shortcut or native paste arriving during the read supersedes this one
     * instead of both reaching the shell.
     */
    async pasteFromClipboard(readText, isCurrent = () => true) {
      const token = ++this.pasteShortcutToken;
      const text = await readText();
      if (this.disposed || this.pasteShortcutToken !== token || !isCurrent()) return;
      this.pasteShortcutToken += 1;
      if (text.length === 0) return;
      const encoded = this.core.encodePaste(text);
      if (encoded.length > 0) this.options.onData(encoded);
    }
    /**
     * Middle-click pastes the terminal's own selection, which is the only
     * primary-selection-like buffer a browser can read. It goes through
     * pasteFromClipboard so it joins the same paste race as every other path.
     * With nothing selected here there is no buffer to paste, and CLIPBOARD is
     * deliberately not substituted: middle-click must never emit text the user
     * only ever copied.
     */
    pasteTerminalSelection() {
      const selection = this.getSelection();
      if (selection.length === 0) return;
      void this.pasteFromClipboard(() => Promise.resolve(selection));
    }
    hasSelection() {
      return this.core.selectionText().length > 0;
    }
    getSelection() {
      return this.core.selectionText();
    }
    getSelectionPosition() {
      if (!this.selectionAnchorScreen || !this.selectionEndScreen || !this.hasSelection())
        return null;
      const before = this.selectionAnchorScreen.y < this.selectionEndScreen.y || this.selectionAnchorScreen.y === this.selectionEndScreen.y && this.selectionAnchorScreen.x <= this.selectionEndScreen.x;
      return before ? { start: this.selectionAnchorScreen, end: this.selectionEndScreen } : { start: this.selectionEndScreen, end: this.selectionAnchorScreen };
    }
    getSelectionEndClientRect() {
      const position = this.getSelectionPosition();
      if (!position) return null;
      const viewportEnd = this.core.screenPointToViewport(position.end.x, position.end.y);
      if (!viewportEnd) return null;
      const bounds = this.canvas.getBoundingClientRect();
      return {
        right: bounds.left + CONTENT_PADDING + (viewportEnd.x + 1) * this.metrics.width,
        bottom: bounds.top + this.originY + (viewportEnd.y + 1) * this.metrics.height
      };
    }
    clearSelection() {
      this.clearPrimedCopy();
      this.core.clearSelection();
      this.selectionEnd = null;
      this.selectionAnchorScreen = null;
      this.selectionEndScreen = null;
      this.selectionMode = "cell";
      this.selectionBase = null;
      this.setSelectionAutoscroll(0);
      this.options.onSelectionChange();
      this.forceFullRender = true;
      this.requestRender();
    }
    scrollToBottom() {
      this.core.scrollToBottom();
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      this.requestRender();
    }
    isAtBottom() {
      return this.core.isViewportActive();
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.resizeObserver.disconnect();
      document.fonts.removeEventListener("loadingdone", this.onFontsLoaded);
      this.dprMedia?.removeEventListener("change", this.onDevicePixelRatioChange);
      this.dprMedia = null;
      this.reducedMotionMedia?.removeEventListener("change", this.onReducedMotionChange);
      if (this.selectionScrollTimer !== null) window.clearInterval(this.selectionScrollTimer);
      if (this.resizeNotifyTimer !== null) {
        window.clearTimeout(this.resizeNotifyTimer);
        this.resizeNotifyTimer = null;
        this.options.onResize(this.cols, this.rows);
      }
      this.cancelRender();
      if (this.compositionSuppressionTimer !== null) {
        window.clearTimeout(this.compositionSuppressionTimer);
      }
      this.removeEvents();
      this.core.dispose();
      if (this.canvas.parentElement === this.mount || this.input.parentElement === this.mount || this.scrollbar.parentElement === this.mount) {
        this.canvas.remove();
        this.input.remove();
        this.scrollbar.remove();
      }
    }
    onKeyDown = (event) => {
      this.encodedKeyCodes.delete(event.code);
      if (isTerminalAltGraphText(event) || !this.options.beforeKey(event)) return;
      if (isTerminalCopyShortcut(event) && this.hasSelection()) {
        const selection = this.getSelection();
        this.primeCopy(selection);
        if (event.shiftKey || event.key.toLowerCase() === "insert") {
          event.preventDefault();
          document.execCommand("copy");
        } else {
          this.clearSelectionAfterCopy = !event.shiftKey && !isMacPlatform(navigator.platform);
          const clipboard = navigator.clipboard;
          if (typeof clipboard?.writeText === "function") {
            const token = ++this.copyShortcutToken;
            void Promise.resolve().then(() => {
              if (this.disposed || this.copyShortcutToken !== token) return;
              void clipboard.writeText(selection).then(
                () => {
                  if (this.disposed || this.copyShortcutToken !== token) return;
                  if (this.clearSelectionAfterCopy) {
                    this.clearSelectionAfterCopy = false;
                    this.clearSelection();
                  }
                },
                () => {
                  if (this.copyShortcutToken === token) {
                    this.clearSelectionAfterCopy = false;
                  }
                }
              );
            });
          }
        }
        return;
      }
      if (isTerminalPasteShortcut(event)) {
        const clipboard = navigator.clipboard;
        if (typeof clipboard?.readText === "function") {
          const token = ++this.pasteShortcutToken;
          void clipboard.readText().then(
            (text) => {
              if (this.disposed || this.pasteShortcutToken !== token) return;
              this.pasteShortcutToken += 1;
              if (text.length > 0) this.options.onData(this.core.encodePaste(text));
            },
            () => {
            }
          );
        }
        return;
      }
      if (isTerminalCompositionKey(event, this.composing)) {
        return;
      }
      this.clearPrimedCopy();
      const data = this.core.encodeKey(event);
      if (data.length === 0) return;
      this.encodedKeyCodes.add(event.code);
      event.preventDefault();
      event.stopPropagation();
      this.options.onData(data);
    };
    onKeyUp = (event) => {
      if (!this.encodedKeyCodes.delete(event.code)) return;
      if (isTerminalCompositionKey(event, this.composing)) {
        return;
      }
      const data = this.core.encodeKey(event, "release");
      if (data.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onData(data);
    };
    // A release delivered outside the textarea means the shell will never get
    // one from here; forget the press so a later host-consumed chord on the same
    // code cannot inherit it. Capture phase sees the keyup even if the focused
    // element stops it.
    onWindowKeyUp = (event) => {
      if (event.composedPath().includes(this.input)) return;
      this.encodedKeyCodes.delete(event.code);
    };
    // A release while another app has focus never reaches the page, but a later
    // keydown of the same code proves it happened. Retire the press here, in
    // capture phase before any host dispatcher can stop the event; onKeyDown
    // re-adds the code when this surface encodes the new press itself. A key
    // held across a window focus round trip keeps its press and its release.
    onWindowKeyDown = (event) => {
      this.encodedKeyCodes.delete(event.code);
    };
    onFocus = () => {
      this.focused = true;
      this.cursorOn = true;
      this.requestRender();
    };
    onBlur = () => {
      this.focused = false;
      this.refreshHoveredLink();
      this.cursorOn = true;
      this.requestRender();
    };
    onDevicePixelRatioChange = () => {
      this.watchDevicePixelRatio();
      this.fit();
    };
    watchDevicePixelRatio() {
      this.dprMedia?.removeEventListener("change", this.onDevicePixelRatioChange);
      this.dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      this.dprMedia.addEventListener("change", this.onDevicePixelRatioChange);
    }
    primeCopy(selection) {
      this.primedCopySelection = selection;
      primeTerminalCopyInput(this.input, selection);
    }
    clearPrimedCopy() {
      clearPrimedTerminalCopyInput(this.input, this.primedCopySelection);
      this.primedCopySelection = "";
    }
    onCopyEvent = (event) => {
      const selection = this.hasSelection() ? this.getSelection() : this.input.value;
      this.primeCopy(selection);
      const result = applyTerminalCopyEvent(selection, event.clipboardData);
      if (result.preventDefault) event.preventDefault();
      if (result.claimWriteFallback) {
        this.copyShortcutToken += 1;
        if (this.clearSelectionAfterCopy) {
          this.clearSelectionAfterCopy = false;
          this.clearSelection();
        }
      }
    };
    onPaste = (event) => {
      event.preventDefault();
      const data = event.clipboardData?.getData("text/plain") ?? "";
      if (data.length === 0) return;
      this.pasteShortcutToken += 1;
      this.options.onData(this.core.encodePaste(data));
    };
    onCompositionStart = () => {
      this.clearPrimedCopy();
      this.clearCompositionInputSuppression();
      this.composing = true;
    };
    onCompositionEnd = (event) => {
      this.composing = false;
      const data = this.input.value || event.data;
      if (data.length > 0) this.options.onData(data);
      this.input.value = "";
      this.compositionInputToSuppress = data;
      this.compositionSuppressionTimer = window.setTimeout(() => {
        this.compositionInputToSuppress = null;
        this.compositionSuppressionTimer = null;
      }, 100);
    };
    onInput = (event) => {
      const inputEvent = event;
      if (this.composing || inputEvent.isComposing) return;
      const data = this.input.value || inputEvent.data || "";
      if (data === this.compositionInputToSuppress && isTerminalCompositionCommitInput(inputEvent)) {
        this.clearCompositionInputSuppression();
        this.input.value = "";
        return;
      }
      this.clearCompositionInputSuppression();
      if (data.length > 0) this.options.onData(data);
      this.input.value = "";
    };
    clearCompositionInputSuppression() {
      if (this.compositionSuppressionTimer !== null) {
        window.clearTimeout(this.compositionSuppressionTimer);
        this.compositionSuppressionTimer = null;
      }
      this.compositionInputToSuppress = null;
    }
    onPointerDown = (event) => {
      this.focus();
      if (shouldReportTerminalMouse(this.core.isMouseTracking(), event)) {
        const button = ghosttyMouseButton(event.button);
        if (button === null) return;
        event.preventDefault();
        event.stopPropagation();
        this.clearHoveredLink("default");
        this.mouseReportingPointerId = event.pointerId;
        this.mouseReportingButton = button;
        this.sendMouse("press", button, event);
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button === 1 && isMiddleClickPastePlatform()) {
        this.pasteTerminalSelection();
        return;
      }
      if (event.button !== 0) return;
      const clickCount = this.recordSelectionClick(event);
      const link = this.linkAt(event.clientX, event.clientY);
      if (link && !event.shiftKey && clickCount === 1) {
        event.preventDefault();
        event.stopPropagation();
        this.linkActivationPointerId = event.pointerId;
        this.linkActivationLink = link;
        this.linkActivationOrigin = {
          x: event.clientX,
          y: event.clientY,
          clickCount
        };
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      this.clearHoveredLink();
      this.beginSelection(event, clickCount);
      this.canvas.setPointerCapture(event.pointerId);
    };
    recordSelectionClick(event) {
      this.selectionClickSequence = advanceTerminalSelectionClickSequence(
        this.selectionClickSequence,
        event
      );
      return this.selectionClickSequence.count;
    }
    beginSelection(event, clickCount) {
      const cell = this.cellAt(event.clientX, event.clientY);
      this.selectionMoved = false;
      this.selectionMode = clickCount >= 3 ? "line" : clickCount === 2 ? "word" : "cell";
      const range = this.selectionMode === "line" ? this.core.selectLine(cell.x, cell.y) : this.selectionMode === "word" ? this.core.selectWord(cell.x, cell.y) : null;
      if (range) {
        this.selectionBase = range.screen;
        this.selectionEnd = range.viewport.end;
        this.selectionAnchorScreen = range.screen.start;
        this.selectionEndScreen = range.screen.end;
        this.options.onSelectionChange();
      } else {
        this.selectionMode = "cell";
        this.selectionBase = null;
        this.selectionEnd = cell;
        const screen = this.core.viewportPointToScreen(cell.x, cell.y);
        this.selectionAnchorScreen = screen;
        this.selectionEndScreen = screen;
        if (screen) {
          this.core.setSelection({ ...screen, tag: 2 }, { ...screen, tag: 2 });
        } else {
          this.core.setSelection(cell, cell);
        }
      }
      this.forceFullRender = true;
      this.requestRender();
    }
    onPointerMove = (event) => {
      if (this.linkActivationPointerId === event.pointerId) {
        const origin = this.linkActivationOrigin;
        if (origin === null || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= TERMINAL_LINK_DRAG_THRESHOLD_PX) {
          return;
        }
        this.linkActivationPointerId = null;
        this.linkActivationLink = null;
        this.linkActivationOrigin = null;
        this.clearHoveredLink();
        this.beginSelection(
          {
            clientX: origin.x,
            clientY: origin.y
          },
          origin.clickCount
        );
      }
      const anyEventTracking = this.synchronizeMouseTrackingState();
      if (this.mouseReportingPointerId === event.pointerId || shouldReportTerminalMouse(anyEventTracking, event)) {
        event.preventDefault();
        this.hoverPointer = { x: event.clientX, y: event.clientY };
        this.setHoveredLink(null);
        this.canvas.style.cursor = "default";
        this.sendMouse("motion", this.buttonFromButtons(event.buttons), event);
        return;
      }
      this.lastMouseMotionData = "";
      if (!this.selectionAnchorScreen || !this.canvas.hasPointerCapture(event.pointerId)) {
        this.updateHoverCursor(event);
        return;
      }
      this.clearHoveredLink();
      this.selectionPointer = { x: event.clientX, y: event.clientY };
      const bounds = this.canvas.getBoundingClientRect();
      this.setSelectionAutoscroll(
        event.clientY < bounds.top ? -1 : event.clientY > bounds.bottom ? 1 : 0
      );
      const cell = this.cellAt(event.clientX, event.clientY);
      if (cell.x === this.selectionEnd?.x && cell.y === this.selectionEnd.y) return;
      this.extendSelectionTo(event.clientX, event.clientY);
    };
    extendSelectionTo(clientX, clientY) {
      const anchorScreen = this.selectionAnchorScreen;
      if (anchorScreen === null) return;
      const cell = this.cellAt(clientX, clientY);
      this.selectionMoved = true;
      this.selectionEnd = cell;
      const range = this.selectionMode === "line" ? this.core.selectLine(cell.x, cell.y) : this.selectionMode === "word" ? this.core.selectWord(cell.x, cell.y) : null;
      const cellScreen = this.core.viewportPointToScreen(cell.x, cell.y);
      if (cellScreen === null) return;
      const base = this.selectionBase;
      const beforeBase = base !== null && (cellScreen.y < base.start.y || cellScreen.y === base.start.y && cellScreen.x < base.start.x);
      const anchor = base === null ? anchorScreen : beforeBase ? base.end : base.start;
      const end = range === null ? cellScreen : beforeBase ? range.screen.start : range.screen.end;
      this.selectionAnchorScreen = anchor;
      this.selectionEndScreen = end;
      this.core.setSelection({ ...anchor, tag: 2 }, { ...end, tag: 2 });
      this.options.onSelectionChange();
      this.forceFullRender = true;
      this.requestRender();
    }
    setSelectionAutoscroll(delta) {
      this.selectionScrollDelta = delta;
      if (delta === 0) {
        if (this.selectionScrollTimer !== null) {
          window.clearInterval(this.selectionScrollTimer);
          this.selectionScrollTimer = null;
        }
        return;
      }
      if (this.selectionScrollTimer !== null) return;
      this.selectionScrollTimer = window.setInterval(() => {
        if (this.disposed || this.selectionScrollDelta === 0) return;
        this.scrollViewport(this.selectionScrollDelta);
        const pointer = this.selectionPointer;
        if (pointer) this.extendSelectionTo(pointer.x, pointer.y);
      }, 80);
    }
    updateHoverCursor(event) {
      this.hoverPointer = { x: event.clientX, y: event.clientY };
      this.refreshHoveredLink();
    }
    onPointerLeave = () => {
      this.lastMouseMotionData = "";
      this.clearHoveredLink();
    };
    clearHoveredLink(cursor = "") {
      this.hoverPointer = null;
      this.setHoveredLink(null);
      this.canvas.style.cursor = cursor;
    }
    refreshHoveredLink() {
      const pointer = this.hoverPointer;
      const link = pointer ? this.linkAt(pointer.x, pointer.y) : null;
      this.setHoveredLink(link);
    }
    setHoveredLink(link) {
      const previous = this.hoveredLink;
      const unchanged = previous?.text === link?.text && previous?.range.start.x === link?.range.start.x && previous?.range.start.y === link?.range.start.y && previous?.range.end.x === link?.range.end.x && previous?.range.end.y === link?.range.end.y;
      this.canvas.style.cursor = link ? "pointer" : "";
      if (unchanged) return;
      this.hoveredLink = link;
      this.forceFullRender = true;
      this.requestRender();
    }
    onPointerUp = (event) => {
      this.setSelectionAutoscroll(0);
      if (this.linkActivationPointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const link = this.linkActivationLink;
        this.linkActivationPointerId = null;
        this.linkActivationLink = null;
        this.linkActivationOrigin = null;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        if (event.type !== "pointercancel") {
          if (link && isSameTerminalLink(link, this.linkAt(event.clientX, event.clientY))) {
            this.options.onLinkActivate(link.text, event);
          }
        }
        return;
      }
      if (this.mouseReportingPointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        this.sendMouse("release", this.mouseReportingButton, event);
        this.mouseReportingPointerId = null;
        this.mouseReportingButton = null;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        if (event.type === "pointercancel") {
          this.clearHoveredLink();
        } else {
          this.hoverPointer = { x: event.clientX, y: event.clientY };
          this.refreshHoveredLink();
        }
        return;
      }
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      if (event.button === 1 && isMiddleClickPastePlatform()) {
        event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
      if (!this.selectionMoved && this.selectionMode === "cell") {
        this.clearSelection();
      }
      this.options.onSelectionChange();
    };
    onWheel = (event) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const delta = terminalWheelDeltaRows(
        event,
        this.metrics.height,
        this.rows,
        this.wheelRemainder
      );
      this.wheelRemainder = delta.remainder;
      if (delta.rows === 0) return;
      const magnitude = Math.abs(delta.rows);
      if (shouldReportTerminalMouse(this.core.isMouseTracking(), event)) {
        const button = delta.rows < 0 ? 4 : 5;
        for (let index = 0; index < magnitude; index += 1) {
          this.sendMouse("press", button, event);
        }
        return;
      }
      if (this.core.isAlternateScreen()) {
        this.options.onData(terminalWheelArrowData(delta.rows, this.core.isApplicationCursorKeys()));
        return;
      }
      this.scrollViewport(delta.rows);
    };
    onMouseDown = (event) => {
      if (event.button === 0 || event.button === 1 && isMiddleClickPastePlatform()) {
        event.preventDefault();
      }
      this.focus();
    };
    /**
     * Chromium pastes PRIMARY into the focused editable on a middle mouseup, and
     * the hidden textarea is focused, so leaving the default alive would deliver
     * a second paste through onPaste on top of the one onPointerDown sent.
     */
    onMouseUp = (event) => {
      if (event.button === 1 && isMiddleClickPastePlatform()) event.preventDefault();
    };
    onContextMenu = (event) => {
      if (shouldReportTerminalMouse(this.core.isMouseTracking(), event)) {
        event.preventDefault();
        return;
      }
      this.options.onContextMenu?.(event);
    };
    onScrollbarPointerDown = (event) => {
      if (event.button !== 0) return;
      const state2 = this.readScrollbarState();
      if (state2 === null) return;
      const bounds = this.scrollbar.getBoundingClientRect();
      const geometry = terminalScrollbarGeometry(state2, bounds.height);
      if (geometry === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.scrollbarPointerId = event.pointerId;
      this.scrollbarPointerOffset = event.target === this.scrollbarThumb ? event.clientY - bounds.top - geometry.thumbTop : geometry.thumbHeight / 2;
      this.scrollbar.setPointerCapture(event.pointerId);
      this.scrollbarToPointer(event.clientY, bounds);
    };
    onScrollbarPointerMove = (event) => {
      if (event.pointerId !== this.scrollbarPointerId || this.scrollbarState === null) return;
      event.preventDefault();
      this.scrollbarToPointer(event.clientY, this.scrollbar.getBoundingClientRect());
    };
    onScrollbarPointerUp = (event) => {
      if (event.pointerId !== this.scrollbarPointerId) return;
      event.preventDefault();
      this.scrollbarPointerId = null;
      if (this.scrollbar.hasPointerCapture(event.pointerId)) {
        this.scrollbar.releasePointerCapture(event.pointerId);
      }
    };
    onScrollbarKeyDown = (event) => {
      const state2 = this.readScrollbarState();
      if (state2 === null) return;
      let delta = 0;
      switch (event.key) {
        case "ArrowUp":
          delta = -1;
          break;
        case "ArrowDown":
          delta = 1;
          break;
        case "PageUp":
          delta = -Math.max(1, state2.len);
          break;
        case "PageDown":
          delta = Math.max(1, state2.len);
          break;
        case "Home":
          delta = -state2.offset;
          break;
        case "End":
          delta = state2.total - state2.len - state2.offset;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.scrollViewport(delta);
    };
    installEvents() {
      this.input.addEventListener("keydown", this.onKeyDown);
      this.input.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("keyup", this.onWindowKeyUp, { capture: true });
      window.addEventListener("keydown", this.onWindowKeyDown, { capture: true });
      this.input.addEventListener("focus", this.onFocus);
      this.input.addEventListener("blur", this.onBlur);
      this.input.addEventListener("input", this.onInput);
      this.input.addEventListener("paste", this.onPaste);
      this.input.addEventListener("copy", this.onCopyEvent);
      this.input.addEventListener("compositionstart", this.onCompositionStart);
      this.input.addEventListener("compositionend", this.onCompositionEnd);
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerUp);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.canvas.addEventListener("mousedown", this.onMouseDown);
      this.canvas.addEventListener("mouseup", this.onMouseUp);
      this.canvas.addEventListener("contextmenu", this.onContextMenu);
      this.scrollbar.addEventListener("pointerdown", this.onScrollbarPointerDown);
      this.scrollbar.addEventListener("pointermove", this.onScrollbarPointerMove);
      this.scrollbar.addEventListener("pointerup", this.onScrollbarPointerUp);
      this.scrollbar.addEventListener("pointercancel", this.onScrollbarPointerUp);
      this.scrollbar.addEventListener("keydown", this.onScrollbarKeyDown);
    }
    removeEvents() {
      this.input.removeEventListener("keydown", this.onKeyDown);
      this.input.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("keyup", this.onWindowKeyUp, { capture: true });
      window.removeEventListener("keydown", this.onWindowKeyDown, { capture: true });
      this.input.removeEventListener("focus", this.onFocus);
      this.input.removeEventListener("blur", this.onBlur);
      this.input.removeEventListener("input", this.onInput);
      this.input.removeEventListener("paste", this.onPaste);
      this.input.removeEventListener("copy", this.onCopyEvent);
      this.input.removeEventListener("compositionstart", this.onCompositionStart);
      this.input.removeEventListener("compositionend", this.onCompositionEnd);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
      this.canvas.removeEventListener("pointerup", this.onPointerUp);
      this.canvas.removeEventListener("pointercancel", this.onPointerUp);
      this.canvas.removeEventListener("wheel", this.onWheel);
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
      this.canvas.removeEventListener("mouseup", this.onMouseUp);
      this.canvas.removeEventListener("contextmenu", this.onContextMenu);
      this.scrollbar.removeEventListener("pointerdown", this.onScrollbarPointerDown);
      this.scrollbar.removeEventListener("pointermove", this.onScrollbarPointerMove);
      this.scrollbar.removeEventListener("pointerup", this.onScrollbarPointerUp);
      this.scrollbar.removeEventListener("pointercancel", this.onScrollbarPointerUp);
      this.scrollbar.removeEventListener("keydown", this.onScrollbarKeyDown);
    }
    scrollViewport(deltaRows) {
      let delta = Math.trunc(deltaRows);
      const state2 = this.readScrollbarState();
      if (state2 !== null) {
        const maxOffset = Math.max(0, state2.total - state2.len);
        const offset = Math.max(0, Math.min(state2.offset + delta, maxOffset));
        delta = offset - state2.offset;
        this.scrollbarState = { ...state2, offset };
      }
      if (delta === 0) return;
      this.core.scroll(delta);
      this.forceFullRender = true;
      this.scrollbarDirty = true;
      this.requestRender();
    }
    scrollbarToPointer(clientY, bounds) {
      const state2 = this.scrollbarState;
      if (state2 === null) return;
      const offset = terminalScrollbarOffsetAtPointer(
        state2,
        bounds.height,
        clientY - bounds.top,
        this.scrollbarPointerOffset
      );
      this.scrollViewport(offset - state2.offset);
    }
    updateScrollbar() {
      const state2 = this.readScrollbarState();
      const geometry = state2 === null ? null : terminalScrollbarGeometry(
        state2,
        Math.max(0, this.mount.clientHeight - CONTENT_PADDING * 2)
      );
      this.scrollbar.hidden = geometry === null;
      if (state2 === null || geometry === null) return;
      this.scrollbar.setAttribute("aria-valuemin", "0");
      this.scrollbar.setAttribute("aria-valuemax", String(geometry.maxOffset));
      this.scrollbar.setAttribute(
        "aria-valuenow",
        String(Math.max(0, Math.min(state2.offset, geometry.maxOffset)))
      );
      this.scrollbarThumb.style.height = `${geometry.thumbHeight}px`;
      this.scrollbarThumb.style.transform = `translateY(${geometry.thumbTop}px)`;
    }
    readScrollbarState() {
      const state2 = this.core.scrollbarState();
      this.scrollbarState = state2;
      return state2;
    }
    requestRender() {
      if (this.disposed || !this.visible || !this.hasSize || this.frame !== 0) return;
      this.frame = window.requestAnimationFrame(() => {
        this.frame = 0;
        this.renderFrame();
      });
    }
    cancelRender() {
      if (this.frame !== 0) {
        window.cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      if (this.cursorTimer !== null) {
        window.clearTimeout(this.cursorTimer);
        this.cursorTimer = null;
      }
    }
    renderFrame() {
      if (this.disposed || !this.visible) return;
      if (this.frame !== 0) {
        window.cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      if (this.mount.clientWidth === 0 || this.mount.clientHeight === 0) {
        this.hasSize = false;
        this.forceFullRender = true;
        this.cancelRender();
        return;
      }
      this.snapshot = this.core.snapshot();
      if (!this.blinkEnabled()) this.cursorOn = true;
      const scrollState = this.readScrollbarState();
      const anchorBottom = scrollState !== null && scrollState.total > scrollState.len;
      const nextOriginY = terminalContentOriginY(
        this.mountHeight,
        CONTENT_PADDING,
        this.rows,
        this.metrics.height,
        anchorBottom
      );
      if (nextOriginY !== this.originY) {
        this.originY = nextOriginY;
        this.forceFullRender = true;
      }
      this.refreshHoveredLink();
      renderGhosttySnapshot({
        context: this.context,
        snapshot: this.snapshot,
        metrics: this.metrics,
        fontSize: this.fontSize,
        fontFamily: this.fontFamily,
        padding: CONTENT_PADDING,
        originY: this.originY,
        forceFull: this.forceFullRender,
        cursorOn: this.cursorOn,
        previousCursorY: this.renderedCursorY,
        focused: this.focused,
        hoveredLinkRange: this.hoveredLink?.range ?? null,
        ...this.theme.selectionBackground !== void 0 ? { selectionBackground: this.theme.selectionBackground } : {}
      });
      this.positionInput();
      this.renderedCursorY = this.cursorOn && this.snapshot.cursorVisible && this.snapshot.cursorY >= 0 ? this.snapshot.cursorY : null;
      if (this.scrollbarDirty) {
        this.scrollbarDirty = false;
        this.updateScrollbar();
      }
      this.forceFullRender = false;
      this.scheduleCursorBlink();
    }
    scheduleCursorBlink() {
      if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
      this.cursorTimer = null;
      if (!this.blinkEnabled()) return;
      this.cursorTimer = window.setTimeout(() => {
        this.cursorTimer = null;
        this.cursorOn = !this.cursorOn;
        this.requestRender();
      }, CURSOR_BLINK_INTERVAL_MS);
    }
    blinkEnabled() {
      const snapshot = this.snapshot;
      if (!snapshot || !this.visible || !this.hasSize) return false;
      return shouldBlinkTerminalCursor({
        focused: this.focused,
        cursorBlinking: snapshot.cursorBlinking,
        cursorVisible: snapshot.cursorVisible,
        reducedMotion: this.reducedMotionMedia?.matches ?? false
      });
    }
    positionInput() {
      const snapshot = this.snapshot;
      if (!snapshot || !snapshot.cursorVisible || snapshot.cursorX < 0 || snapshot.cursorY < 0) {
        return;
      }
      const left = CONTENT_PADDING + snapshot.cursorX * this.metrics.width;
      const top = this.originY + snapshot.cursorY * this.metrics.height;
      if (left === this.inputLeft && top === this.inputTop) return;
      this.inputLeft = left;
      this.inputTop = top;
      this.input.style.left = `${left}px`;
      this.input.style.top = `${top}px`;
      this.input.style.height = `${this.metrics.height}px`;
    }
    cellAt(clientX, clientY) {
      const bounds = this.canvas.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            this.cols - 1,
            Math.floor((clientX - bounds.left - CONTENT_PADDING) / this.metrics.width)
          )
        ),
        y: Math.max(
          0,
          Math.min(
            this.rows - 1,
            Math.floor((clientY - bounds.top - this.originY) / this.metrics.height)
          )
        )
      };
    }
    linkAt(clientX, clientY) {
      if (!this.snapshot) return null;
      const cell = terminalGridCellAt({
        bounds: this.canvas.getBoundingClientRect(),
        clientX,
        clientY,
        cols: this.cols,
        rows: this.rows,
        metrics: this.metrics,
        padding: CONTENT_PADDING,
        originY: this.originY
      });
      if (!cell) return null;
      const explicitHyperlink = this.core.hyperlinkAt(cell.x, cell.y);
      if (explicitHyperlink) {
        const start = { ...cell };
        const end = { ...cell };
        while (true) {
          const previous = start.x > 0 ? { x: start.x - 1, y: start.y } : start.y > 0 && this.snapshot.rowData[start.y]?.isWrapContinuation ? { x: this.cols - 1, y: start.y - 1 } : null;
          if (!previous || this.core.hyperlinkAt(previous.x, previous.y) !== explicitHyperlink) break;
          start.x = previous.x;
          start.y = previous.y;
        }
        while (true) {
          const next = end.x + 1 < this.cols ? { x: end.x + 1, y: end.y } : end.y + 1 < this.rows && this.snapshot.rowData[end.y]?.wrapsToNext ? { x: 0, y: end.y + 1 } : null;
          if (!next || this.core.hyperlinkAt(next.x, next.y) !== explicitHyperlink) break;
          end.x = next.x;
          end.y = next.y;
        }
        return {
          text: explicitHyperlink,
          range: { start, end }
        };
      }
      return terminalLinkAtPositionWithRange(this.snapshot.rowData, cell.y, cell.x);
    }
    sendMouse(action, button, event) {
      const bounds = this.canvas.getBoundingClientRect();
      const data = this.core.encodeMouse({
        action,
        button,
        mods: (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 1 << 1 : 0) | (event.altKey ? 1 << 2 : 0) | (event.metaKey ? 1 << 3 : 0),
        x: Math.max(0, event.clientX - bounds.left),
        y: Math.max(0, event.clientY - bounds.top),
        screenWidth: bounds.width,
        screenHeight: bounds.height,
        cellWidth: this.metrics.width,
        cellHeight: this.metrics.height,
        paddingLeft: CONTENT_PADDING,
        paddingRight: CONTENT_PADDING,
        paddingTop: this.originY,
        paddingBottom: Math.max(0, bounds.height - this.originY - this.rows * this.metrics.height),
        anyButtonPressed: event.buttons !== 0
      });
      const resolution = resolveTerminalMouseData(action, data, this.lastMouseMotionData);
      this.lastMouseMotionData = resolution.nextMotionData;
      if (resolution.send) this.options.onData(data);
    }
    synchronizeMouseTrackingState() {
      const tracking = this.core.isMouseAnyEventTracking();
      const state2 = resolveTerminalMouseTrackingState(
        this.mouseAnyEventTracking,
        tracking,
        this.lastMouseMotionData
      );
      this.mouseAnyEventTracking = state2.tracking;
      this.lastMouseMotionData = state2.motionData;
      return tracking;
    }
    buttonFromButtons(buttons) {
      if ((buttons & 1) !== 0) return 1;
      if ((buttons & 4) !== 0) return 3;
      if ((buttons & 2) !== 0) return 2;
      if ((buttons & 8) !== 0) return 4;
      if ((buttons & 16) !== 0) return 5;
      return null;
    }
  };

  // node_modules/@t3tools/shared/src/semver.ts
  var satisfiesSemverRange = function satisfiesSemverRange2(rawVersion, range) {
    const normalizedVersion = String(rawVersion).trim().replace(/^v/, "");
    const versionMatch = normalizedVersion.match(
      /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/
    );
    if (!versionMatch) {
      return false;
    }
    const version = {
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
        const match = comparator.trim().match(/^(\^|>=|>|<=|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/);
        if (!match) {
          return false;
        }
        const targetVersion = match[2];
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
        const compared = version.major !== target.major ? version.major > target.major ? 1 : -1 : version.minor !== target.minor ? version.minor > target.minor ? 1 : -1 : version.patch !== target.patch ? version.patch > target.patch ? 1 : -1 : 0;
        const operator = match[1] || "=";
        switch (operator) {
          case "^":
            if (compared < 0) {
              return false;
            }
            if (target.major > 0) {
              return version.major === target.major;
            }
            if (target.minor > 0) {
              return version.major === 0 && version.minor === target.minor;
            }
            return version.major === 0 && version.minor === 0 && version.patch === target.patch;
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

  // inputQueue.ts
  var TERMINAL_INPUT_SERIALIZED_BUDGET = 48 * 1024;
  var TERMINAL_INPUT_PENDING_BUDGET = 256 * 1024;
  var TERMINAL_INPUT_WRITE_TIMEOUT_MS = 3e4;
  var textEncoder = new TextEncoder();
  function serializedWriteBytes(terminalId, data) {
    return textEncoder.encode(JSON.stringify({ terminalId, data })).byteLength;
  }
  function serializedStringBytes(data) {
    return textEncoder.encode(JSON.stringify(data)).byteLength;
  }
  function serializedHead(data, maxEscapedBytes) {
    if (maxEscapedBytes <= 0 || data.length === 0) return "";
    let used = 0;
    let units = 0;
    for (const char of data) {
      const cost = textEncoder.encode(JSON.stringify(char)).byteLength - 2;
      if (used + cost > maxEscapedBytes) break;
      used += cost;
      units += char.length;
    }
    return data.slice(0, units);
  }
  var PRE_WRITE_FAILURES = [
    "Terminal authority is unavailable.",
    "Terminal session is unavailable in the requested workspace.",
    "Terminal session cannot be inspected.",
    "Terminal control is scoped to the requested workspace.",
    "Terminal control takes the thread from the view context.",
    "Terminal control requires a thread scope.",
    "Terminal control method is unavailable.",
    "Invalid terminal control request.",
    "Capability denied",
    "Capability unavailable",
    "View is inactive",
    "Too many pending view calls"
  ];
  function isKnownNonWriteError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return PRE_WRITE_FAILURES.some((known) => message.includes(known));
  }
  var TerminalInputQueue = class {
    #write;
    #onChange;
    #serializedBudget;
    #pendingBudget;
    #writeTimeoutMs;
    #overhead;
    #pending = [];
    #pendingSerialized = 0;
    #ready = true;
    #draining = false;
    #stopped = null;
    #disposed = false;
    #sendTimer;
    constructor(options) {
      this.#write = options.write;
      this.#onChange = options.onChange;
      this.#serializedBudget = options.serializedBudget ?? TERMINAL_INPUT_SERIALIZED_BUDGET;
      this.#pendingBudget = options.pendingBudget ?? TERMINAL_INPUT_PENDING_BUDGET;
      this.#writeTimeoutMs = options.writeTimeoutMs ?? TERMINAL_INPUT_WRITE_TIMEOUT_MS;
      this.#overhead = serializedWriteBytes(options.terminalId, "");
    }
    get state() {
      return {
        stopped: this.#stopped !== null,
        message: this.#stopped?.message ?? null,
        queuedCount: this.#pending.length,
        queuedBytes: this.#pendingSerialized
      };
    }
    /**
     * Disposal is terminal for the queue object: a revived owner (StrictMode
     * effect replay) must construct a fresh queue rather than resurrect this
     * one — pending bytes dropped at dispose are never resent.
     */
    get disposed() {
      return this.#disposed;
    }
    enqueue(data) {
      if (this.#disposed || this.#stopped !== null) return "dropped-stopped";
      if (data.length === 0) return "accepted";
      const serialized = serializedStringBytes(data);
      if (this.#pendingSerialized + serialized > this.#pendingBudget) {
        return "dropped-full";
      }
      this.#pending.push({ data, serialized });
      this.#pendingSerialized += serialized;
      this.#onChange?.();
      void this.#drain();
      return "accepted";
    }
    /** Gate draining while the session is starting; pending input accumulates. */
    setReady(ready) {
      if (this.#ready === ready) return;
      this.#ready = ready;
      if (ready) void this.#drain();
    }
    /** Explicit user resume after a stopped write; only post-resume input flows. */
    resume() {
      if (this.#stopped === null) return;
      this.#stopped = null;
      this.#onChange?.();
      void this.#drain();
    }
    /**
     * New process epoch (restart/open/attach), close, or stream close: pending
     * input is stale for the new incarnation and the stop reason no longer
     * applies, so both clear. In-flight writes still evaluate normally.
     */
    reset() {
      this.#pending = [];
      this.#pendingSerialized = 0;
      if (this.#stopped !== null) this.#stopped = null;
      this.#onChange?.();
    }
    dispose() {
      this.#disposed = true;
      this.#pending = [];
      this.#pendingSerialized = 0;
      clearTimeout(this.#sendTimer);
    }
    /**
     * Longest pending prefix whose serialized invocation fits the budget.
     * Consumed items leave the queue before the write is sent — on an unknown
     * outcome they are discarded, not requeued.
     */
    #takeBatch() {
      const escapedBudget = this.#serializedBudget - this.#overhead;
      const parts = [];
      let used = 0;
      let first = true;
      while (this.#pending.length > 0) {
        const item = this.#pending[0];
        const escaped = item.serialized - 2;
        if (used + escaped <= escapedBudget) {
          parts.push(item.data);
          used += escaped;
          this.#pendingSerialized -= item.serialized;
          this.#pending.shift();
          first = false;
          continue;
        }
        if (!first) break;
        const head = serializedHead(item.data, escapedBudget);
        if (head.length === 0) {
          this.#pendingSerialized -= item.serialized;
          this.#pending.shift();
          continue;
        }
        const rest = item.data.slice(head.length);
        this.#pending[0] = { data: rest, serialized: serializedStringBytes(rest) };
        this.#pendingSerialized += this.#pending[0].serialized - item.serialized;
        parts.push(head);
        break;
      }
      return parts.join("");
    }
    async #send(data) {
      const timeout = new Promise((_resolve, reject) => {
        this.#sendTimer = setTimeout(
          () => reject(new Error("Terminal write timed out")),
          this.#writeTimeoutMs
        );
      });
      try {
        await Promise.race([this.#write(data), timeout]);
      } finally {
        clearTimeout(this.#sendTimer);
        this.#sendTimer = void 0;
      }
    }
    async #drain() {
      if (!this.#ready || this.#stopped !== null || this.#draining || this.#disposed) return;
      this.#draining = true;
      try {
        while (this.#ready && this.#stopped === null && !this.#disposed && this.#pending.length > 0) {
          const batch = this.#takeBatch();
          if (batch.length === 0) continue;
          try {
            await this.#send(batch);
          } catch (error) {
            this.#pending = [];
            this.#pendingSerialized = 0;
            const message = error instanceof Error ? error.message : "Terminal write failed";
            this.#stopped = isKnownNonWriteError(error) ? { message: `Input stopped \u2014 ${message}`, outcome: "known" } : {
              message: `Input stopped \u2014 the terminal may have received partial input (${message}). Resume to continue typing.`,
              outcome: "unknown"
            };
            break;
          }
        }
      } finally {
        this.#draining = false;
        this.#onChange?.();
      }
    }
  };

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
  var OutputReattach = class {
    #running;
    #pending = false;
    constructor(running) {
      this.#running = running;
    }
    noteRunning(running) {
      if (running && !this.#running) this.#pending = true;
      this.#running = running;
    }
    /** A subscription reads the current session, so it consumes a latched edge. */
    subscribed() {
      this.#pending = false;
    }
    /** Call only while no stream is attached; true when one should subscribe now. */
    take() {
      const pending = this.#pending;
      this.#pending = false;
      return pending;
    }
  };
  var textEncoder2 = new TextEncoder();
  var utf8Bytes = (value) => textEncoder2.encode(value).byteLength;
  function tailByBytes(value, maxBytes) {
    if (maxBytes <= 0) return "";
    const encoded = textEncoder2.encode(value);
    if (encoded.byteLength <= maxBytes) return value;
    let start = encoded.byteLength - maxBytes;
    while (start < encoded.length && (encoded[start] & 192) === 128) start += 1;
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoded.subarray(start));
  }
  function normalizeTerminalIds(ids) {
    const seen = /* @__PURE__ */ new Set();
    const next = [];
    for (const raw of ids) {
      const id2 = raw.trim();
      if (id2.length === 0 || id2.length > 128 || seen.has(id2)) continue;
      seen.add(id2);
      next.push(id2);
    }
    return next;
  }
  function resolveActiveTerminalId(ids, activeTerminalId) {
    if (ids.length === 0) return null;
    return activeTerminalId !== null && ids.includes(activeTerminalId) ? activeTerminalId : ids[0] ?? null;
  }
  var MAX_TERMINALS_PER_GROUP = 4;
  var fallbackGroupId = (terminalId) => `group-${terminalId}`;
  function assignUniqueGroupId(baseId, usedGroupIds) {
    let candidate = baseId;
    let index = 2;
    while (usedGroupIds.has(candidate)) {
      candidate = `${baseId}-${index}`;
      index += 1;
    }
    usedGroupIds.add(candidate);
    return candidate;
  }
  function normalizeTerminalGroups(groups, terminalIds) {
    if (terminalIds.length === 0) return [];
    const validTerminalIdSet = new Set(terminalIds);
    const assignedTerminalIds = /* @__PURE__ */ new Set();
    const nextGroups = [];
    const usedGroupIds = /* @__PURE__ */ new Set();
    for (const group of groups) {
      const groupTerminalIds = normalizeTerminalIds(group.terminalIds).filter(
        (terminalId) => validTerminalIdSet.has(terminalId) && !assignedTerminalIds.has(terminalId)
      );
      if (groupTerminalIds.length === 0) continue;
      for (const terminalId of groupTerminalIds) assignedTerminalIds.add(terminalId);
      const baseGroupId = group.id.trim().length > 0 ? group.id.trim() : fallbackGroupId(groupTerminalIds[0] ?? terminalIds[0] ?? "");
      const vertical = group.splitDirection === "vertical";
      for (let start = 0; start < groupTerminalIds.length; start += MAX_TERMINALS_PER_GROUP) {
        nextGroups.push({
          id: assignUniqueGroupId(
            start === 0 ? baseGroupId : `${baseGroupId}-${Math.floor(start / MAX_TERMINALS_PER_GROUP) + 1}`,
            usedGroupIds
          ),
          terminalIds: groupTerminalIds.slice(start, start + MAX_TERMINALS_PER_GROUP),
          ...vertical ? { splitDirection: "vertical" } : {}
        });
      }
    }
    for (const terminalId of terminalIds) {
      if (assignedTerminalIds.has(terminalId)) continue;
      nextGroups.push({
        id: assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
        terminalIds: [terminalId]
      });
    }
    return nextGroups;
  }
  function suspendedOutputStatus(state2) {
    return state2.status === "live" ? { ...state2, status: "connecting", statusText: "Reconnecting\u2026" } : state2;
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
    nativeWatermark: -1,
    ended: false
  };
  var TERMINAL_ESCAPE = (
    // eslint-disable-next-line no-control-regex
    /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][^\x07\x18\x1a\x1b\x80-\x9f]*(?:\x07|\x1b\\|\x9c|(?=[\x18\x1a\x1b\x80-\x9f])|$)|[ -/]*[0-~])|\x9b[0-?]*[ -/]*[@-~]|[\x90\x98\x9d-\x9f][^\x07\x18\x1a\x1b\x80-\x9f]*(?:\x07|\x1b\\|\x9c|(?=[\x18\x1a\x1b\x80-\x9f])|$)/g
  );
  var TRAILING_PARTIAL_ESCAPE = /(?:\x1b(?:\[[0-?]*[ -/]*|[ -/]*)|\x9b[0-?]*[ -/]*)$/;
  var TERMINAL_CONTROL2 = /[\x00-\x07\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
  function overstrikeLine(line) {
    if (!line.includes("\r") && !line.includes("\b")) return line;
    const cells = [];
    let cursor = 0;
    for (const char of line) {
      if (char === "\r") cursor = 0;
      else if (char === "\b") cursor = Math.max(0, cursor - 1);
      else cells[cursor++] = char;
    }
    return cells.join("");
  }
  function plainTerminalText(contents2) {
    return contents2.replace(TRAILING_PARTIAL_ESCAPE, "").replace(TERMINAL_ESCAPE, "").replace(TERMINAL_CONTROL2, "").replace(/\r+\n/g, "\n").split("\n").map(overstrikeLine).join("\n");
  }
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
      if (frame.sequence < 0 || !Number.isSafeInteger(value.boundarySequence) || !Number.isSafeInteger(value.contentsUnitStart))
        return fail("Output snapshot boundary is invalid.");
      const contents3 = tailByBytes(value.contents, TERMINAL_BUFFER_MAX_BYTES);
      const ended = value.status === "exited" || value.status === "error";
      const omitted = value.truncated || value.contentsUnitStart > 0;
      return {
        buffer: {
          contents: contents3,
          retainedBytes: utf8Bytes(contents3),
          truncated: omitted,
          status: ended ? "exited" : "live",
          statusText: ended ? `Terminal is ${value.status}.` : omitted ? "Watching live output. Older retained history was omitted." : "Watching live output.",
          exitCode: null,
          epoch: value.streamEpoch,
          sequence,
          nativeWatermark: value.boundarySequence,
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
      if (pending) return fail("Output chunk group is discontinuous.");
      if (value.sequence <= base.nativeWatermark)
        return fail("Output event sequence is not monotonic.");
      return {
        buffer: {
          ...base,
          contents: "",
          retainedBytes: 0,
          truncated: false,
          status: "live",
          statusText: "Terminal history cleared. Watching live output.",
          nativeWatermark: value.sequence
        },
        pending: null
      };
    }
    if (value.kind === "exit") {
      if (pending) return fail("Terminal exited with incomplete output.");
      if (value.sequence <= base.nativeWatermark)
        return fail("Output event sequence is not monotonic.");
      return {
        buffer: {
          ...base,
          status: "exited",
          statusText: `Terminal exited (code ${value.exitCode ?? "unknown"}).`,
          exitCode: value.exitCode,
          nativeWatermark: value.sequence,
          ended: true
        },
        pending: null
      };
    }
    if (!Number.isSafeInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > 64 || !Number.isSafeInteger(value.chunkIndex) || value.chunkIndex < 0 || value.chunkIndex >= value.chunkCount || typeof value.data !== "string" || value.data.length > 8192)
      return fail("Output chunk exceeds the public contract.");
    if (pending) {
      if (value.sequence !== pending.sequence || value.chunkCount !== pending.count || value.chunkIndex !== pending.parts.length)
        return fail("Output chunk group is discontinuous.");
      pending.parts.push(value.data);
      if (pending.parts.length < pending.count) return { buffer: base, pending };
      const data = pending.parts.join("");
      const contents3 = tailByBytes(base.contents + data, TERMINAL_BUFFER_MAX_BYTES);
      return {
        buffer: {
          ...base,
          contents: contents3,
          retainedBytes: utf8Bytes(contents3),
          status: "live",
          statusText: "Watching live output.",
          nativeWatermark: value.sequence
        },
        pending: null
      };
    }
    if (value.chunkIndex !== 0) return fail("Output chunk group is discontinuous.");
    if (value.sequence <= base.nativeWatermark)
      return fail("Output event sequence is not monotonic.");
    if (value.chunkCount > 1)
      return {
        buffer: base,
        pending: { sequence: value.sequence, count: value.chunkCount, parts: [value.data] }
      };
    const contents2 = tailByBytes(base.contents + value.data, TERMINAL_BUFFER_MAX_BYTES);
    return {
      buffer: {
        ...base,
        contents: contents2,
        retainedBytes: utf8Bytes(contents2),
        status: "live",
        statusText: "Watching live output.",
        nativeWatermark: value.sequence
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
    for (const id2 of serverIds) {
      if (!clientSet.has(id2)) return false;
    }
    return true;
  }
  function reconcileTerminalIds(clientIds, serverIds) {
    if (terminalIdListsEqual(clientIds, serverIds)) return [...clientIds];
    if (serverTerminalIdsStrictSubsetOfClient(serverIds, clientIds)) return [...clientIds];
    const serverSet = new Set(serverIds);
    const kept = clientIds.filter((id2) => serverSet.has(id2));
    const keptSet = new Set(kept);
    return [...kept, ...serverIds.filter((id2) => !keptSet.has(id2))];
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
  function openFailedLine(target, error) {
    const detail = describeGrantDenial(error)?.message ?? (error instanceof Error ? error.message : "unavailable");
    return `${target} could not be opened \u2014 ${detail}`;
  }
  async function openTerminalPath(editor, path3, cwd, signal) {
    try {
      const receipt2 = await editor.invoke("openPath", { path: path3, cwd }, signal);
      return receipt2.status === "opened" ? null : receipt2.message;
    } catch (error) {
      return openFailedLine(path3, error);
    }
  }
  async function openTerminalUrl(openLink, url) {
    try {
      const receipt2 = await openLink(url);
      return receipt2.status === "opened" ? null : `${url} was not opened (${receipt2.reason}).`;
    } catch (error) {
      return openFailedLine(url, error);
    }
  }
  var clampDimension = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max ? value : null;
  var TerminalPanel = class {
    #control;
    #launch;
    #canAllocatePaneStream;
    #onChange;
    #ids;
    #active;
    #groups = [];
    /** Empty string mirrors the native store's "no active group" sentinel. */
    #activeGroupId = "";
    #tabs = /* @__PURE__ */ new Map();
    /**
     * Exited sessions this panel closed whose server `remove` has not landed:
     * list frames still describing them are stale and must not re-add a tab.
     */
    #closing = /* @__PURE__ */ new Set();
    #stream = "connecting";
    #panelError = null;
    #disposed = false;
    constructor(options) {
      this.#control = options.control;
      this.#launch = options.launch;
      this.#canAllocatePaneStream = options.canAllocatePaneStream;
      this.#onChange = options.onChange;
      this.#ids = normalizeTerminalIds(options.restored?.terminalIds ?? []);
      this.#active = resolveActiveTerminalId(this.#ids, options.restored?.activeTerminalId ?? null);
      this.#groups = normalizeTerminalGroups(
        (options.restored?.terminalGroups ?? []).map((group) => ({
          id: group.id,
          terminalIds: [...group.terminalIds],
          ...group.splitDirection === "vertical" ? { splitDirection: "vertical" } : {}
        })),
        this.#ids
      );
      this.#activeGroupId = this.#resolveActiveGroupId(
        options.restored?.activeTerminalGroupId ?? null
      );
      for (const id2 of this.#ids) this.#tab(id2);
    }
    get snapshot() {
      return {
        terminalIds: [...this.#ids],
        activeTerminalId: this.#active,
        groups: this.#groups.map((group) => ({
          id: group.id,
          terminalIds: [...group.terminalIds],
          splitDirection: group.splitDirection ?? "horizontal"
        })),
        activeGroupId: this.#activeGroupId === "" ? null : this.#activeGroupId,
        tabs: this.#ids.map((id2) => {
          const tab = this.#tabs.get(id2);
          const meta = tab.meta;
          return {
            terminalId: id2,
            label: resolveTerminalSessionLabel(id2, meta),
            status: tab.starting ? "starting" : meta?.status ?? "closed",
            hasRunningSubprocess: meta?.hasRunningSubprocess ?? false,
            exitCode: meta?.exitCode ?? null,
            starting: tab.starting,
            exitBanner: tab.exitBanner,
            confirmAction: tab.confirm,
            error: tab.error,
            queuedInputCount: tab.input.state.queuedCount,
            inputStopped: tab.input.state.stopped,
            inputMessage: tab.input.state.message
          };
        }),
        stream: this.#stream,
        panelError: this.#panelError
      };
    }
    /** Ids eligible for allocation: client list plus any tab we are tracking. */
    get allocatableTerminalIds() {
      return [.../* @__PURE__ */ new Set([...this.#ids, ...this.#tabs.keys(), ...this.#closing])];
    }
    #emit() {
      this.#onChange?.();
    }
    #newInputQueue(terminalId) {
      return new TerminalInputQueue({
        terminalId,
        write: (data) => this.#control.write({ terminalId, data }),
        onChange: () => this.#emit()
      });
    }
    /**
     * A queue whose panel was disposed is permanently dead — React StrictMode
     * replays effect setup/cleanup/setup in dev and revives the panel, but the
     * old queue would keep dropping every send with no stopped banner. A fresh
     * queue takes over; the disposed one's pending bytes were dropped at
     * dispose and are never resent.
     */
    #liveInput(terminalId, tab) {
      if (tab.input.disposed) tab.input = this.#newInputQueue(terminalId);
      return tab.input;
    }
    #tab(terminalId) {
      let tab = this.#tabs.get(terminalId);
      if (!tab) {
        tab = {
          meta: null,
          starting: false,
          input: this.#newInputQueue(terminalId),
          exitBanner: null,
          confirm: null,
          error: null,
          resizeInFlight: null,
          resizePending: null,
          resizeSent: null
        };
        this.#tabs.set(terminalId, tab);
        if (!this.#ids.includes(terminalId)) this.#ids = [...this.#ids, terminalId];
      } else {
        this.#liveInput(terminalId, tab);
      }
      return tab;
    }
    /** Group containing a session, or the current active group as a fallback. */
    #groupIdOf(terminalId) {
      return this.#groups.find((group) => group.terminalIds.includes(terminalId))?.id ?? this.#activeGroupId;
    }
    /**
     * Native rule: the stored active group survives renormalization while it
     * still exists; otherwise the active terminal's group (or the first group)
     * takes over.
     */
    #resolveActiveGroupId(preferred) {
      if (preferred !== null && preferred !== "" && this.#groups.some((g) => g.id === preferred))
        return preferred;
      return (this.#active !== null ? this.#groupIdOf(this.#active) : "") || (this.#groups[0]?.id ?? "");
    }
    /** Re-partition groups after `#ids` changed and re-resolve the active group. */
    #syncGroups() {
      this.#groups = normalizeTerminalGroups(this.#groups, this.#ids);
      this.#activeGroupId = this.#resolveActiveGroupId(this.#activeGroupId);
    }
    /**
     * Native close/reconcile rule: when the active terminal itself may have
     * moved (the closed pane's slot-slide, or a server list that dropped it),
     * the visible group follows the POST-change active terminal. The stored
     * group preference would keep the old group — e.g. close the middle pane
     * of a split and the pane sliding into focus lands in another group,
     * leaving the active terminal hidden behind a group it is not in.
     */
    #syncGroupsFollowingActive() {
      this.#groups = normalizeTerminalGroups(this.#groups, this.#ids);
      this.#activeGroupId = (this.#active !== null ? this.#groupIdOf(this.#active) : "") || (this.#groups[0]?.id ?? "");
    }
    /**
     * Where a split lands: the stored active group, else the group holding the
     * active terminal. `null` means there is nothing to split into — the
     * native `effectiveMode === "new"` case.
     */
    #splitDestination() {
      if (this.#active === null) return null;
      const byId = this.#groups.find((group) => group.id === this.#activeGroupId);
      if (byId) return byId;
      return this.#groups.find((group) => group.terminalIds.includes(this.#active)) ?? null;
    }
    #removeTab(terminalId, fallback = "first") {
      this.#tabs.get(terminalId)?.input.dispose();
      this.#tabs.delete(terminalId);
      const closedIndex = this.#ids.indexOf(terminalId);
      this.#ids = this.#ids.filter((id2) => id2 !== terminalId);
      this.#active = this.#active === terminalId ? fallback === "index" ? this.#ids[Math.min(closedIndex, this.#ids.length - 1)] ?? this.#ids[0] ?? null : resolveActiveTerminalId(this.#ids, null) : resolveActiveTerminalId(this.#ids, this.#active);
      this.#syncGroupsFollowingActive();
      this.#emit();
    }
    /**
     * Absorbs server metadata (a list row or control result). It never closes
     * a session: a row can describe an older process than the one running
     * now, so exits are decided by the pane's output stream (noteOutputSnapshot).
     */
    #observeMeta(next) {
      this.#tab(next.terminalId).meta = next;
    }
    /** The pane's output stream saw a process exit: banner only, pending its fresh snapshot. */
    noteExit(terminalId, exitCode) {
      const tab = this.#tabs.get(terminalId);
      if (this.#disposed || !tab) return;
      tab.exitBanner = `Process exited (code ${exitCode ?? "unknown"})`;
      this.#emit();
    }
    /**
     * A pane's output snapshot is the server's current state for this id —
     * the authority the native drawer's attach stream is. `exited` closes the
     * session like the native drawer does (a failed close still leaves the
     * tab, like a user close); an `error` (failed start) keeps its diagnostic
     * and Start; anything live means any exit banner was an older process's.
     */
    noteOutputSnapshot(terminalId, status) {
      const tab = this.#tabs.get(terminalId);
      if (this.#disposed || !tab) return;
      if (status === "exited") {
        if (tab.starting) return;
        this.#closing.add(terminalId);
        void this.#control.close({ terminalId, deleteHistory: true }).catch(() => this.#closing.delete(terminalId));
        this.#removeTab(terminalId);
        return;
      }
      if (status !== "error" && tab.exitBanner !== null) {
        tab.exitBanner = null;
        this.#emit();
      }
    }
    applySessionsEvent(event) {
      if (this.#disposed) return;
      switch (event.kind) {
        case "snapshot": {
          this.#stream = "live";
          for (const id2 of this.#closing)
            if (!event.terminals.some((terminal) => terminal.terminalId === id2))
              this.#closing.delete(id2);
          const terminals = event.terminals.filter(
            (terminal) => !this.#closing.has(terminal.terminalId)
          );
          const serverIds = terminals.map((terminal) => terminal.terminalId);
          this.#ids = reconcileTerminalIds(this.#ids, serverIds);
          for (const terminal of terminals) this.#observeMeta(terminal);
          for (const id2 of this.#tabs.keys()) {
            if (!this.#ids.includes(id2)) this.#tabs.delete(id2);
          }
          this.#active = resolveActiveTerminalId(this.#ids, this.#active);
          this.#syncGroupsFollowingActive();
          break;
        }
        case "upsert":
          if (this.#closing.has(event.terminal.terminalId)) return;
          this.#observeMeta(event.terminal);
          this.#syncGroups();
          break;
        case "remove":
          this.#closing.delete(event.terminalId);
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
      for (const [terminalId, tab] of this.#tabs) this.#liveInput(terminalId, tab);
      if (this.#stream === "connecting") return;
      this.#stream = "connecting";
      this.#emit();
    }
    markStreamDisconnected(message) {
      this.#stream = "closed";
      this.#panelError = message;
      this.#emit();
    }
    /**
     * A failed panel-level op outside the session stream — e.g. a dispatched
     * keybinding command whose `t3.ui/panels` call the host rejected. The next
     * stream transition overwrites it; it must not masquerade as stream state.
     */
    notePanelError(message) {
      this.#panelError = message;
      this.#emit();
    }
    /** Open a fresh terminal in its own group; the client picks the id (#15). */
    async openTerminal() {
      return this.#open("new", "horizontal");
    }
    /**
     * `terminal.split`/`terminal.splitVertical`: a fresh session inserted into
     * the active group right after the focused pane, capped at
     * MAX_TERMINALS_PER_GROUP — at the cap the chord is refused before any PTY
     * spawns, exactly like the native `hasReachedSplitLimit` gate. With no
     * sessions yet the split degenerates to a plain open, as native does.
     */
    async splitTerminal(direction = "horizontal") {
      return this.#open("split", direction);
    }
    async #open(mode, direction) {
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
      const destination = mode === "split" ? this.#splitDestination() : null;
      if (destination !== null && destination.terminalIds.length >= MAX_TERMINALS_PER_GROUP) {
        return null;
      }
      if (this.#canAllocatePaneStream !== void 0 && !this.#canAllocatePaneStream()) {
        this.#panelError = "Terminal stream limit reached \u2014 close a pane or another terminal panel first.";
        this.#emit();
        return null;
      }
      const terminalId = nextTerminalId(this.allocatableTerminalIds);
      const tab = this.#tab(terminalId);
      tab.starting = true;
      tab.input.reset();
      tab.input.setReady(false);
      tab.error = null;
      this.#ids = [...this.#ids.filter((id2) => id2 !== terminalId), terminalId];
      if (destination !== null) {
        const anchorIndex = destination.terminalIds.indexOf(this.#active ?? "");
        if (anchorIndex >= 0) destination.terminalIds.splice(anchorIndex + 1, 0, terminalId);
        else destination.terminalIds.push(terminalId);
        if (direction === "vertical") destination.splitDirection = "vertical";
        else delete destination.splitDirection;
      }
      this.#active = terminalId;
      this.#syncGroups();
      this.#activeGroupId = this.#groupIdOf(terminalId);
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
        tab.input.setReady(true);
        this.#observeMeta(meta);
        await this.#drain(terminalId);
      } catch (error) {
        tab.starting = false;
        tab.input.reset();
        tab.input.setReady(true);
        tab.error = error instanceof Error ? error.message : "Terminal open failed";
        this.#emit();
      }
      return terminalId;
    }
    /**
     * Starts the shown panes the server has no session for — a restored tab
     * after an app or server restart. Native attaches every pane it shows with
     * its launch cwd, which spawns a fresh shell for a missing session; this
     * does the same once the list is live, so the pane does not sit closed
     * until Start. A server row (even an exited one) or a failed start is left
     * for the user, as native leaves it. Like native's automatic attach, this
     * never asks the server to restart: another client's restore may have
     * already created (and failed or exited) the session since our snapshot,
     * and only Start may relaunch it.
     */
    startMissingSessions(terminalIds) {
      if (this.#disposed || this.#stream !== "live") return;
      for (const terminalId of terminalIds) {
        const tab = this.#tabs.get(terminalId);
        if (tab && tab.meta === null && !tab.starting && tab.error === null)
          void this.#attach(terminalId, false);
      }
    }
    /** Start: attach a tracked id that has no live metadata, restarting a stopped session. */
    startSession(terminalId) {
      return this.#attach(terminalId, true);
    }
    async #attach(terminalId, restartIfNotRunning) {
      const launch = this.#launch;
      const tab = this.#tabs.get(terminalId);
      if (!tab || !launch || tab.starting) return;
      if (tab.meta !== null && tab.meta.status !== "exited" && tab.meta.status !== "error") return;
      tab.starting = true;
      this.#liveInput(terminalId, tab).setReady(false);
      tab.exitBanner = null;
      tab.error = null;
      this.#emit();
      try {
        const meta = await this.#control.attach({
          terminalId,
          cwd: launch.cwd,
          worktreePath: launch.worktreePath,
          ...restartIfNotRunning ? { restartIfNotRunning: true } : {},
          ...launch.cols !== void 0 ? { cols: launch.cols } : {},
          ...launch.rows !== void 0 ? { rows: launch.rows } : {},
          ...launch.env !== void 0 ? { env: launch.env } : {}
        });
        tab.starting = false;
        this.#liveInput(terminalId, tab).setReady(true);
        this.#observeMeta(meta);
        await this.#drain(terminalId);
      } catch (error) {
        tab.starting = false;
        this.#liveInput(terminalId, tab).setReady(true);
        tab.error = error instanceof Error ? error.message : "Terminal attach failed";
        this.#emit();
      }
    }
    /** Flush the pending fit-resize after a start resolves. */
    async #drain(terminalId) {
      const tab = this.#tabs.get(terminalId);
      if (!tab) return;
      const pending = tab.resizePending;
      tab.resizePending = null;
      if (pending) await this.#sendResize(terminalId, pending);
      this.#emit();
    }
    /**
     * Type into a terminal. Batches by serialized invocation bytes and stops on
     * an unknown write outcome — the queue owns ordering, bounds, and the
     * input-stopped halt; the panel only gates draining on `starting`.
     */
    sendInput(terminalId, data) {
      const tab = this.#tabs.get(terminalId);
      if (!tab || data.length === 0 || this.#disposed) return;
      const result = this.#liveInput(terminalId, tab).enqueue(data);
      if (result === "dropped-full") {
        tab.error = "Input dropped: the pending-input queue is full.";
        this.#emit();
      }
    }
    /** Explicit user resume after input-stopped. */
    resumeInput(terminalId) {
      const tab = this.#tabs.get(terminalId);
      if (tab) this.#liveInput(terminalId, tab).resume();
    }
    /** Output stream signalled a new process epoch or lifecycle end — pending input is stale. */
    resetInput(terminalId) {
      const tab = this.#tabs.get(terminalId);
      if (tab) this.#liveInput(terminalId, tab).reset();
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
        this.#removeTab(terminalId, "index");
        return;
      }
      const launch = this.#launch;
      try {
        if (action === "clear") {
          await this.#control.clear({ terminalId });
        } else {
          if (!launch) throw new Error("Terminal requires a workspace scope.");
          tab.starting = true;
          this.#liveInput(terminalId, tab).reset();
          tab.input.setReady(false);
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
          tab.input.setReady(true);
          tab.exitBanner = null;
          this.#observeMeta(meta);
          await this.#drain(terminalId);
          return;
        }
      } catch (error) {
        tab.starting = false;
        this.#liveInput(terminalId, tab).setReady(true);
        tab.error = error instanceof Error ? error.message : "Terminal action failed";
      }
      this.#emit();
    }
    /** Focus a pane — also surfaces its group, like the native setActiveTerminal. */
    activate(terminalId) {
      if (!this.#ids.includes(terminalId)) return;
      this.#active = terminalId;
      this.#activeGroupId = this.#groupIdOf(terminalId);
      this.#emit();
    }
    dispose() {
      this.#disposed = true;
      for (const tab of this.#tabs.values()) tab.input.dispose();
    }
  };
  var TERMINAL_SURFACE_ID = "t3.terminal/view";
  var TERMINAL_FOCUS_WHEN = `extension.${TERMINAL_SURFACE_ID}.focus`;
  var TERMINAL_VIEW_COMMANDS = [
    {
      id: "toggle",
      title: "Toggle terminal",
      description: "Close this terminal panel.",
      scope: "global",
      defaultKey: "mod+j"
    },
    {
      id: "new",
      title: "New terminal",
      scope: "surface",
      defaultKey: "mod+n",
      when: TERMINAL_FOCUS_WHEN
    },
    {
      id: "close",
      title: "Close terminal",
      scope: "surface",
      defaultKey: "mod+w",
      when: TERMINAL_FOCUS_WHEN
    },
    {
      id: "split",
      title: "Split terminal horizontally",
      scope: "surface",
      defaultKey: "mod+d",
      when: TERMINAL_FOCUS_WHEN
    },
    {
      id: "splitVertical",
      title: "Split terminal vertically",
      scope: "surface",
      defaultKey: "mod+shift+d",
      when: TERMINAL_FOCUS_WHEN
    }
  ];
  var TERMINAL_GLOBAL_COMMANDS = [
    {
      id: "toggle",
      title: "Toggle terminal",
      description: "Open the terminal panel, or close it when a terminal view answers.",
      scope: "global",
      defaultKey: "mod+j",
      activation: { surfaceId: TERMINAL_SURFACE_ID, placement: "bottom-dock" }
    }
  ];
  var TERMINAL_DEFAULT_CHORDS = /* @__PURE__ */ new Map([
    ["mod+d", "split"],
    ["mod+shift+d", "splitVertical"],
    ["mod+n", "new"],
    ["mod+w", "close"]
  ]);
  function terminalActionLabel(action, shortcutLabel, limitNote = null) {
    const note = limitNote ?? shortcutLabel;
    return note ? `${action} (${note})` : action;
  }
  var NATIVE_TERMINAL_CHORD_COMMANDS = /* @__PURE__ */ new Map([
    ["terminal.split", "split"],
    ["terminal.splitVertical", "splitVertical"],
    ["terminal.new", "new"],
    ["terminal.close", "close"]
  ]);
  function terminalChordFromEvent(event, isMac) {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey || (isMac ? event.ctrlKey : event.metaKey)) return null;
    if (event.key.length !== 1) return null;
    return `mod${event.shiftKey ? "+shift" : ""}+${event.key.toLowerCase()}`;
  }
  function terminalChordAction(event, keybindings, isMac) {
    if (keybindings !== void 0) {
      const command = keybindings.resolveTerminalFocusKey(event);
      return command === null ? null : NATIVE_TERMINAL_CHORD_COMMANDS.get(command) ?? null;
    }
    const chord = terminalChordFromEvent(event, isMac);
    return chord === null ? null : TERMINAL_DEFAULT_CHORDS.get(chord) ?? null;
  }
  function dispatchTerminalCommand(commandId, actions) {
    switch (commandId) {
      case "toggle":
        actions.toggleSurface();
        return true;
      case "new":
        actions.newTerminal();
        return true;
      case "close":
        actions.closeTerminal();
        return true;
      case "split":
        actions.splitTerminal("horizontal");
        return true;
      case "splitVertical":
        actions.splitTerminal("vertical");
        return true;
      default:
        return false;
    }
  }
  async function registerPanelCommands(options) {
    const api = bindApi(
      uiKeybindingsApi,
      options.client,
      options.context,
      options.versionRange ?? "^1.0.0"
    );
    const response = await api.invoke(
      "registerCommands",
      { commands: options.commands ?? TERMINAL_VIEW_COMMANDS },
      options.signal
    );
    const release = () => {
      void api.invoke(
        "unregisterCommands",
        { commandSetToken: response.commandSetToken },
        AbortSignal.timeout(5e3)
      ).catch(() => {
      });
    };
    if (options.signal.aborted) {
      release();
      return null;
    }
    const registered = new Set(
      response.results.filter((result) => result.status === "registered").map((result) => result.commandId)
    );
    try {
      options.bindCommands(response.commandSetToken, ({ commandId }) => {
        if (registered.has(commandId)) options.onCommand(commandId);
      });
    } catch (error) {
      release();
      throw error;
    }
    return { commandSetToken: response.commandSetToken, results: response.results, release };
  }
  var TERMINAL_THEME_VARS = {
    canvas: "--t3-terminal-canvas",
    text: "--t3-terminal-text",
    textMuted: "--t3-terminal-muted",
    border: "--t3-terminal-border",
    input: "--t3-terminal-input",
    accentSurface: "--t3-terminal-accent-surface",
    terminalBackground: "--t3-terminal-background",
    terminalForeground: "--t3-terminal-foreground",
    terminalSelection: "--t3-terminal-selection"
  };
  function themeVarOverrides(tokens, cssVars) {
    const overrides = {};
    for (const [role, property] of Object.entries(TERMINAL_THEME_VARS)) {
      const value = tokens[role];
      if (value === void 0) continue;
      const contractVar = cssVars[role];
      overrides[property] = contractVar ? `var(${contractVar}, ${value})` : value;
    }
    return overrides;
  }
  function terminalAppearanceVars(appearance) {
    const vars = {
      "--t3-terminal-background": appearance.theme.background,
      "--t3-terminal-foreground": appearance.theme.foreground,
      "--t3-terminal-color-scheme": appearance.appearance
    };
    if (appearance.theme.selectionBackground !== void 0)
      vars["--t3-terminal-selection"] = appearance.theme.selectionBackground;
    if (appearance.font.family !== void 0)
      vars["--t3-terminal-font-family"] = appearance.font.family;
    if (appearance.font.size !== void 0)
      vars["--t3-terminal-font-size"] = `${appearance.font.size}px`;
    if (appearance.font.lineHeight !== void 0)
      vars["--t3-terminal-line-height"] = String(appearance.font.lineHeight);
    if (appearance.font.ligatures !== void 0)
      vars["--t3-terminal-ligatures"] = appearance.font.ligatures ? "normal" : "none";
    return vars;
  }
  function asTerminalAppearance(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value;
    const theme = candidate.theme;
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) return null;
    const colors = theme;
    if (typeof colors.background !== "string" || typeof colors.foreground !== "string" || typeof colors.cursor !== "string" || colors.selectionBackground !== void 0 && typeof colors.selectionBackground !== "string")
      return null;
    const font = candidate.font;
    if (!font || typeof font !== "object" || Array.isArray(font)) return null;
    const fontFields = font;
    if (fontFields.family !== void 0 && typeof fontFields.family !== "string" || fontFields.size !== void 0 && (typeof fontFields.size !== "number" || !Number.isFinite(fontFields.size)) || fontFields.lineHeight !== void 0 && (typeof fontFields.lineHeight !== "number" || !Number.isFinite(fontFields.lineHeight)) || fontFields.ligatures !== void 0 && typeof fontFields.ligatures !== "boolean")
      return null;
    if (candidate.appearance !== "light" && candidate.appearance !== "dark") return null;
    return value;
  }
  function watchThemeVars(options) {
    const api = bindApi(uiThemeApi, options.client, options.context);
    const streams = bindStreamApi(uiThemeApi, options.client, options.context);
    if (!options.signal.aborted) options.apply(null);
    let generation = 0;
    const invalidate = () => {
      generation += 1;
      if (!options.signal.aborted) options.apply(null);
    };
    const refresh = () => {
      const at = ++generation;
      void api.invoke("getTokens", {}, options.signal).then(
        (value) => {
          if (!options.signal.aborted && at === generation)
            options.apply(themeVarOverrides(value.tokens, value.cssVars));
        },
        // A superseded rejection carries no fresh information — only the
        // newest read's failure may invalidate the published map.
        () => {
          if (at === generation) invalidate();
        }
      );
    };
    refresh();
    return (async () => {
      try {
        for await (const frame of streams.subscribe("subscribeState", {}, options.signal)) {
          if (options.signal.aborted) return;
          if (frame.type === "closed") break;
          refresh();
        }
        invalidate();
      } catch {
        invalidate();
      }
    })();
  }
  function watchTerminalAppearanceVars(options) {
    const streams = bindStreamApi(uiThemeApi, options.client, options.context);
    if (!options.signal.aborted) options.apply(null);
    return (async () => {
      try {
        for await (const frame of streams.subscribe(
          "subscribeTerminalAppearance",
          {},
          options.signal
        )) {
          if (options.signal.aborted) return;
          if (frame.type === "closed") break;
          const appearance = asTerminalAppearance(frame.value);
          options.apply(appearance === null ? null : terminalAppearanceVars(appearance));
        }
        if (!options.signal.aborted) options.apply(null);
      } catch {
        if (!options.signal.aborted) options.apply(null);
      }
    })();
  }

  // surfaceKeys.ts
  var TERMINAL_EDITING_INPUT = {
    clear: "\f",
    wordBackward: "\x1Bb",
    wordForward: "\x1Bf",
    lineStart: "",
    lineEnd: "",
    deleteToLineStart: ""
  };
  function isTerminalEditingCommand(commandId) {
    return Object.hasOwn(TERMINAL_EDITING_INPUT, commandId);
  }
  var LOGICAL_DEFAULTS_RANGE = "^1.2.0";
  function hostTakesLogicalDefaults(clientVersion, discovered) {
    const selected = discovered.find((api) => api.id === UI_KEYBINDINGS && api.selected);
    return clientVersion !== void 0 && selected !== void 0 && satisfiesSemverRange(clientVersion, LOGICAL_DEFAULTS_RANGE) && satisfiesSemverRange(selected.version, LOGICAL_DEFAULTS_RANGE);
  }
  async function negotiatedEditingCommands(host, context, signal, platform) {
    let logicalDefaults = false;
    try {
      logicalDefaults = hostTakesLogicalDefaults(
        host.keybindings?.version,
        await host.discoverApis(context, signal)
      );
    } catch {
    }
    return {
      commands: terminalEditingCommands(platform, logicalDefaults),
      versionRange: logicalDefaults ? LOGICAL_DEFAULTS_RANGE : "^1.0.0"
    };
  }
  function terminalEditingCommands(platform = typeof navigator === "undefined" ? "" : navigator.platform, logicalDefaults = true) {
    const mac = isMacPlatform(platform);
    const command = (id2, title, defaultKey) => ({
      id: id2,
      title,
      scope: "surface",
      // Native matches these on `event.key` alone, so a non-Latin layout's
      // Cmd+л reaches the shell instead of clearing through physical KeyK.
      ...defaultKey === null || !logicalDefaults ? {} : { defaultKey, defaultKeyLogicalOnly: true },
      when: TERMINAL_FOCUS_WHEN
    });
    return [
      command("clear", "Clear terminal screen", mac ? ["ctrl+l", "meta+k"] : "ctrl+l"),
      command(
        "wordBackward",
        "Move cursor back one word",
        mac ? "alt+arrowleft" : ["ctrl+arrowleft", "alt+arrowleft"]
      ),
      command(
        "wordForward",
        "Move cursor forward one word",
        mac ? "alt+arrowright" : ["ctrl+arrowright", "alt+arrowright"]
      ),
      command("lineStart", "Move cursor to line start", mac ? "meta+arrowleft" : null),
      command("lineEnd", "Move cursor to line end", mac ? "meta+arrowright" : null),
      command("deleteToLineStart", "Delete to line start", mac ? "meta+backspace" : null)
    ];
  }
  function normalizeEventKey(key) {
    const normalized = key.toLowerCase();
    if (normalized === "esc") return "escape";
    return normalized;
  }
  function defaultTerminalEditingCommand(event, platform = typeof navigator === "undefined" ? "" : navigator.platform) {
    if (event.type !== void 0 && event.type !== "keydown") return null;
    const mac = isMacPlatform(platform);
    const key = normalizeEventKey(event.key);
    const { metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event;
    if (key === "arrowleft" || key === "arrowright") {
      if (shift) return null;
      const left = key === "arrowleft";
      const word = left ? "wordBackward" : "wordForward";
      if (mac) {
        if (alt && !meta && !ctrl) return word;
        if (meta && !alt && !ctrl) return left ? "lineStart" : "lineEnd";
        return null;
      }
      if (ctrl && !meta && !alt) return word;
      if (alt && !meta && !ctrl) return word;
      return null;
    }
    if (key === "backspace") {
      return mac && meta && !ctrl && !alt && !shift ? "deleteToLineStart" : null;
    }
    if (key === "l" && ctrl && !meta && !alt && !shift) return "clear";
    if (mac && key === "k" && meta && !ctrl && !alt && !shift) return "clear";
    return null;
  }
  function terminalEditingCommandForKey(event, keybindings, options, platform = typeof navigator === "undefined" ? "" : navigator.platform) {
    if (event.type !== void 0 && event.type !== "keydown") return null;
    if (keybindings !== void 0) {
      const resolved = keybindings.resolveTerminalFocusKey(event);
      if (resolved === null) return defaultTerminalEditingCommand(event, platform);
      const prefix = `ext.${options.pluginId}.`;
      const own = resolved.startsWith(prefix) ? resolved.slice(prefix.length) : null;
      return own !== null && isTerminalEditingCommand(own) ? own : null;
    }
    const command = defaultTerminalEditingCommand(event, platform);
    if (command === null) return null;
    return options.binding === "pending" ? "hold" : command;
  }
  function terminalEditingBeforeKey(event, keybindings, options, send, platform = typeof navigator === "undefined" ? "" : navigator.platform) {
    const action = terminalEditingCommandForKey(event, keybindings, options, platform);
    if (action === null) return true;
    event.preventDefault();
    event.stopPropagation();
    if (action !== "hold") send(TERMINAL_EDITING_INPUT[action]);
    return false;
  }

  // selectionMenu.tsx
  var import_react = __toESM(require_react(), 1);

  // selectionMenuModel.ts
  function terminalSelectionMenuItems(options) {
    return [
      ...options?.canAddToChat === false ? [] : [{ id: "add-to-chat", label: "Add to chat" }],
      { id: "copy", label: "Copy" }
    ];
  }
  function terminalContextMenuItems(options) {
    const { hasSelection, canAddToChat = true } = options;
    return [
      ...terminalSelectionMenuItems({ canAddToChat }).map((item) => ({
        ...item,
        disabled: !hasSelection
      })),
      { id: "paste", label: "Paste" }
    ];
  }
  var TERMINAL_CHAT_TEXT_MAX_CHARS = 1e4;
  var TERMINAL_CHAT_LABEL_MAX_CHARS = 128;
  function terminalSelectionLineRange(position) {
    const lineStart = position.start.y + 1;
    return { lineStart, lineEnd: Math.max(lineStart, position.end.y + 1) };
  }
  function buildTerminalChatSelection(input) {
    const text = normalizeSelectionText(input.text);
    if (input.position === null || text.length === 0) return null;
    const label = input.terminalLabel.trim() || "Terminal";
    return {
      terminalId: input.terminalId,
      terminalLabel: truncateUtf16(label, TERMINAL_CHAT_LABEL_MAX_CHARS),
      ...terminalSelectionLineRange(input.position),
      text
    };
  }
  function terminalChatSelectionError(selection) {
    if (selection.text.length > TERMINAL_CHAT_TEXT_MAX_CHARS) {
      return "Selection is too long to add to chat (10,000 characters at most).";
    }
    if (selection.terminalLabel.length > TERMINAL_CHAT_LABEL_MAX_CHARS) {
      return "Terminal name is too long to add to chat (128 characters at most).";
    }
    return null;
  }
  async function addTerminalSelectionToChat(options) {
    try {
      const tooLong = terminalChatSelectionError(options.selection);
      if (tooLong !== null) throw new Error(tooLong);
      await options.insert(options.selection);
    } catch (error) {
      if (!options.isCurrent()) return;
      options.reportError(
        error instanceof Error ? error.message : "Unable to add the terminal selection to chat"
      );
      options.focusTerminal();
      return;
    }
    if (options.isCurrent()) options.clearSelection();
  }
  var TerminalChatTarget = class {
    availableValue = false;
    probing = false;
    probe;
    constructor(probe) {
      this.probe = probe;
    }
    get available() {
      return this.availableValue;
    }
    refresh() {
      if (this.availableValue || this.probing) return;
      this.probing = true;
      void this.probe().then(
        (available) => {
          this.availableValue = available;
        },
        () => {
        }
      ).finally(() => {
        this.probing = false;
      });
    }
  };
  function resolveSelectionActionPosition(options) {
    const { bounds, selectionRect, pointer, viewport } = options;
    const preferred = pointer ?? {
      x: selectionRect?.right ?? bounds.left + bounds.width - 140,
      y: selectionRect ? selectionRect.bottom + 4 : bounds.top + 12
    };
    return {
      x: Math.max(
        8,
        Math.min(Math.max(bounds.left, preferred.x), bounds.left + bounds.width, viewport.width - 8)
      ),
      y: Math.max(
        8,
        Math.min(Math.max(bounds.top, preferred.y), bounds.top + bounds.height, viewport.height - 8)
      )
    };
  }
  function clampMenuToViewport(options) {
    const { point, size, viewport, margin = 4 } = options;
    return {
      x: Math.min(Math.max(margin, point.x), Math.max(margin, viewport.width - size.width - margin)),
      y: Math.min(
        Math.max(margin, point.y),
        Math.max(margin, viewport.height - size.height - margin)
      )
    };
  }
  var TerminalSelectionMenuFlow = class {
    requestId = 0;
    open = null;
    onChange;
    canAddToChat;
    constructor(onChange = () => {
    }, options) {
      this.onChange = onChange;
      this.canAddToChat = options?.canAddToChat ?? (() => false);
    }
    get menu() {
      return this.open;
    }
    isCurrent(requestId) {
      return requestId === this.requestId;
    }
    /** A right-click supersedes a pending or open popup and any in-flight action. */
    openContextMenu(input) {
      const selectionText = nonEmpty(input.selectionText);
      const chatSelection = selectionText === null ? null : input.chatSelection ?? null;
      return this.show({
        requestId: ++this.requestId,
        kind: "context",
        items: withChatAvailability(
          terminalContextMenuItems({
            hasSelection: selectionText !== null,
            canAddToChat: this.canAddToChat()
          }),
          chatSelection
        ),
        position: input.position,
        clipboardText: selectionText,
        chatSelection
      });
    }
    /**
     * Opens the post-selection popup. A current popup stays as is (a repeated
     * selection-end must not reopen it); an empty selection opens nothing.
     */
    openSelectionPopup(input) {
      if (this.ownsOpenMenu("selection")) return this.open;
      const selectionText = nonEmpty(input.selectionText);
      if (selectionText === null) {
        this.supersede();
        return null;
      }
      const chatSelection = input.chatSelection ?? null;
      return this.show({
        requestId: ++this.requestId,
        kind: "selection",
        items: withChatAvailability(
          terminalSelectionMenuItems({ canAddToChat: this.canAddToChat() }),
          chatSelection
        ),
        position: input.position,
        clipboardText: selectionText,
        chatSelection
      });
    }
    /**
     * Resolves a click on an item of the menu opened as `requestId`. A stale
     * menu, a disabled item, or a missing selection resolves to null. The menu
     * closes but the id stays current, so the action it starts can still report
     * and return focus unless a newer flow supersedes it.
     */
    choose(requestId, action) {
      const menu = this.open;
      if (menu === null || menu.requestId !== requestId || !this.isCurrent(requestId)) return null;
      const item = menu.items.find((candidate) => candidate.id === action);
      this.close();
      if (!item || item.disabled === true) return null;
      if (action !== "paste" && menu.clipboardText === null) return null;
      if (action === "add-to-chat" && menu.chatSelection === null) return null;
      return {
        action,
        requestId,
        clipboardText: menu.clipboardText,
        chatSelection: menu.chatSelection
      };
    }
    /**
     * Passive cancellation (Escape, outside click, scroll, blur): closes the
     * open menu. It only invalidates the id when the menu it closes is current,
     * so it can never cancel a newer flow's in-flight action.
     */
    dismiss() {
      if (this.open === null) return;
      if (this.isCurrent(this.open.requestId)) this.requestId += 1;
      this.close();
    }
    /** Active cancellation: invalidates every flow, open or in flight. */
    supersede() {
      this.requestId += 1;
      this.close();
    }
    /**
     * An emptied selection may only cancel a selection flow that is still
     * current — a pending popup timer, or the open popup. A right-click menu
     * keeps the text it captured.
     */
    shouldClearOnEmptySelection(popupPending) {
      return popupPending || this.ownsOpenMenu("selection");
    }
    ownsOpenMenu(kind) {
      return this.open?.kind === kind && this.isCurrent(this.open.requestId);
    }
    show(menu) {
      this.open = menu;
      this.onChange(menu);
      return menu;
    }
    close() {
      if (this.open === null) return;
      this.open = null;
      this.onChange(null);
    }
  };
  function withChatAvailability(items, chatSelection) {
    if (chatSelection !== null) return items;
    return items.map((item) => item.id === "add-to-chat" ? { ...item, disabled: true } : item);
  }
  function truncateUtf16(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  }
  function normalizeSelectionText(text) {
    return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  }
  function nonEmpty(text) {
    if (text === null) return null;
    return normalizeSelectionText(text).length > 0 ? text : null;
  }

  // selectionMenu.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var TerminalSelectionMenuController = class {
    flow;
    deps;
    menuElement = null;
    timer = null;
    frame = null;
    gestureActive = false;
    chatTarget;
    constructor(deps, onChange) {
      this.deps = deps;
      this.chatTarget = deps.chat ? new TerminalChatTarget(deps.chat.probe) : null;
      this.flow = new TerminalSelectionMenuFlow(onChange, {
        canAddToChat: () => this.chatTarget?.available === true
      });
    }
    /** Ref callback for the rendered menu, used by the outside-click test. */
    setMenuElement = (element) => {
      this.menuElement = element;
    };
    /** Surface option: a right-click the running app did not claim through mouse reporting. */
    onContextMenu = (event) => {
      event.preventDefault();
      this.cancelPending();
      this.gestureActive = false;
      const surface = this.deps.getSurface();
      if (surface === null) return;
      surface.focus();
      this.chatTarget?.refresh();
      const selectionText = surface.hasSelection() ? surface.getSelection() : null;
      this.flow.openContextMenu({
        selectionText,
        chatSelection: this.readChatSelection(surface, selectionText),
        position: { x: event.clientX, y: event.clientY }
      });
    };
    /** Surface option: an emptied selection cancels a still-current popup flow. */
    onSelectionChange = () => {
      if (this.deps.getSurface()?.hasSelection()) return;
      if (!this.flow.shouldClearOnEmptySelection(this.pending)) return;
      this.cancelPending();
      this.flow.supersede();
    };
    choose = async (requestId, action) => {
      const choice = this.flow.choose(requestId, action);
      const surface = this.deps.getSurface();
      if (choice === null || surface === null) return;
      const reportIfCurrent = (error, fallback) => {
        if (this.flow.isCurrent(requestId)) {
          this.deps.reportError(surface, error instanceof Error ? error.message : fallback);
        }
      };
      if (choice.action === "add-to-chat" && choice.chatSelection !== null && this.deps.chat) {
        await addTerminalSelectionToChat({
          selection: choice.chatSelection,
          insert: this.deps.chat.insert,
          isCurrent: () => this.flow.isCurrent(requestId),
          clearSelection: () => surface.clearSelection(),
          focusTerminal: () => surface.focus(),
          reportError: (message) => this.deps.reportError(surface, message)
        });
        return;
      }
      if (choice.action === "copy" && choice.clipboardText !== null) {
        try {
          await copyText(choice.clipboardText, surface);
        } catch (error) {
          reportIfCurrent(error, "Unable to copy terminal selection");
        }
      } else if (choice.action === "paste") {
        try {
          await surface.pasteFromClipboard(readClipboardText, () => this.flow.isCurrent(requestId));
        } catch (error) {
          reportIfCurrent(error, "Unable to read the clipboard");
          return;
        }
      }
      if (this.flow.isCurrent(requestId)) surface.focus();
    };
    install(mount) {
      this.chatTarget?.refresh();
      const document2 = mount.ownerDocument;
      const view = document2.defaultView;
      const insideMenu = (event) => this.menuElement !== null && event.composedPath().includes(this.menuElement);
      const onMountPointerDown = (event) => {
        if (!event.isPrimary) return;
        this.cancelPending();
        this.gestureActive = event.button === 0 && !event.defaultPrevented;
      };
      const onDocumentPointerDown = (event) => {
        if (insideMenu(event)) return;
        this.cancelPending();
        this.flow.dismiss();
      };
      const onMouseUp = (event) => {
        if (event.button !== 0 || !this.gestureActive) return;
        this.gestureActive = false;
        const pointer = { x: event.clientX, y: event.clientY };
        this.schedule(pointer, event.detail >= 2 ? SELECTION_MULTI_CLICK_INTERVAL_MS : 0);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape" && this.flow.menu !== null) {
          this.flow.dismiss();
          if (event.composedPath().includes(mount)) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (!insideMenu(event)) this.cancelPending();
      };
      const dismiss = () => {
        this.cancelPending();
        this.gestureActive = false;
        this.flow.dismiss();
      };
      const onFocusOut = (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (mount.contains(next) || this.menuElement?.contains(next)))
          return;
        dismiss();
      };
      const onScroll = (event) => {
        const target = event.target;
        if (target === document2 || target instanceof Node && target.contains(mount)) dismiss();
      };
      mount.addEventListener("pointerdown", onMountPointerDown);
      mount.addEventListener("wheel", dismiss, { passive: true });
      document2.addEventListener("scroll", onScroll, true);
      document2.addEventListener("pointerdown", onDocumentPointerDown, true);
      document2.addEventListener("keydown", onKeyDown, true);
      mount.addEventListener("focusout", onFocusOut);
      view.addEventListener("mouseup", onMouseUp);
      view.addEventListener("pointercancel", dismiss);
      view.addEventListener("blur", dismiss);
      view.addEventListener("resize", dismiss);
      return () => {
        mount.removeEventListener("pointerdown", onMountPointerDown);
        mount.removeEventListener("wheel", dismiss);
        document2.removeEventListener("scroll", onScroll, true);
        document2.removeEventListener("pointerdown", onDocumentPointerDown, true);
        document2.removeEventListener("keydown", onKeyDown, true);
        mount.removeEventListener("focusout", onFocusOut);
        view.removeEventListener("mouseup", onMouseUp);
        view.removeEventListener("pointercancel", dismiss);
        view.removeEventListener("blur", dismiss);
        view.removeEventListener("resize", dismiss);
        this.cancelPending();
        this.gestureActive = false;
        this.flow.supersede();
      };
    }
    get pending() {
      return this.timer !== null || this.frame !== null;
    }
    // Timers and viewport reads use the global `window`, while install() binds
    // listeners through the mount's own document and view. Surfaces render
    // in-document, so both are one realm; a cross-document surface would need
    // these moved to the mount's defaultView.
    schedule(pointer, delay) {
      this.cancelPending();
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.frame = window.requestAnimationFrame(() => {
          this.frame = null;
          this.showSelectionPopup(pointer);
        });
      }, delay);
    }
    showSelectionPopup(pointer) {
      const surface = this.deps.getSurface();
      const mount = this.deps.getMount();
      if (surface === null || mount === null) {
        this.flow.supersede();
        return;
      }
      const hasSelection = surface.hasSelection();
      const selectionText = hasSelection ? surface.getSelection() : null;
      this.chatTarget?.refresh();
      this.flow.openSelectionPopup({
        selectionText,
        chatSelection: this.readChatSelection(surface, selectionText),
        position: resolveSelectionActionPosition({
          bounds: mount.getBoundingClientRect(),
          selectionRect: hasSelection ? surface.getSelectionEndClientRect() : null,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        })
      });
    }
    readChatSelection(surface, selectionText) {
      const chat = this.deps.chat;
      if (!chat || selectionText === null) return null;
      return buildTerminalChatSelection({
        terminalId: chat.terminalId,
        terminalLabel: chat.terminalLabel(),
        text: selectionText,
        position: surface.getSelectionPosition()
      });
    }
    cancelPending() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      if (this.frame !== null) window.cancelAnimationFrame(this.frame);
      this.timer = this.frame = null;
    }
  };
  async function copyText(text, surface) {
    let failure = new Error("Clipboard writes are unavailable in this browser.");
    const clipboard = navigator.clipboard;
    if (typeof clipboard?.writeText === "function") {
      try {
        await clipboard.writeText(text);
        return;
      } catch (error) {
        failure = error;
      }
    }
    if (surface.hasSelection() && surface.getSelection() === text) {
      surface.focus();
      if (document.execCommand("copy")) return;
    }
    throw failure;
  }
  async function readClipboardText() {
    const clipboard = navigator.clipboard;
    if (typeof clipboard?.readText !== "function") {
      throw new Error("Clipboard reads are unavailable in this browser.");
    }
    return clipboard.readText();
  }
  function useTerminalSelectionMenu(options) {
    const { mountRef, surfaceRef, reportError, chat } = options;
    const [menu, setMenu] = (0, import_react.useState)(null);
    const [controller] = (0, import_react.useState)(
      () => new TerminalSelectionMenuController(
        {
          getMount: () => mountRef.current,
          getSurface: () => surfaceRef.current,
          reportError,
          chat
        },
        setMenu
      )
    );
    (0, import_react.useEffect)(() => {
      const mount = mountRef.current;
      if (mount === null || typeof mount.addEventListener !== "function") return;
      return controller.install(mount);
    }, [controller, mountRef]);
    return {
      onContextMenu: controller.onContextMenu,
      onSelectionChange: controller.onSelectionChange,
      menu: menu === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        TerminalMenu,
        {
          menu,
          elementRef: controller.setMenuElement,
          onChoose: (action) => void controller.choose(menu.requestId, action)
        },
        menu.requestId
      )
    };
  }
  var MENU_STYLE = `
[data-t3-terminal-menu] button{display:flex;width:100%;align-items:center;min-height:26px;padding:4px 10px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}
[data-t3-terminal-menu] button:not(:disabled):hover,[data-t3-terminal-menu] button:not(:disabled):focus-visible{background:var(--t3-terminal-accent-surface,var(--accent,#e8eef7));outline:none}
[data-t3-terminal-menu] button:disabled{color:var(--t3-terminal-muted,var(--muted-foreground,#667085));opacity:.64}
`;
  function TerminalMenu(props) {
    const { menu, elementRef, onChoose } = props;
    const ref = (0, import_react.useRef)(null);
    (0, import_react.useLayoutEffect)(() => {
      const element = ref.current;
      if (element === null) return;
      element.style.left = `${menu.position.x}px`;
      element.style.top = `${menu.position.y}px`;
      const rect = element.getBoundingClientRect();
      const clamped = clampMenuToViewport({
        point: menu.position,
        size: rect,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      });
      element.style.left = `${clamped.x - (rect.left - menu.position.x)}px`;
      element.style.top = `${clamped.y - (rect.top - menu.position.y)}px`;
    }, [menu]);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: (element) => {
          ref.current = element;
          elementRef(element);
        },
        role: "menu",
        "aria-label": menu.kind === "selection" ? "Selection actions" : "Terminal actions",
        "data-t3-terminal-menu": menu.kind,
        onMouseDown: (event) => event.preventDefault(),
        onContextMenu: (event) => event.preventDefault(),
        style: {
          position: "fixed",
          left: menu.position.x,
          top: menu.position.y,
          zIndex: 1e4,
          minWidth: 120,
          padding: 4,
          borderRadius: 6,
          border: "1px solid var(--t3-terminal-border, var(--border, #dfe3e8))",
          background: "var(--t3-terminal-canvas, var(--popover, var(--background, #fff)))",
          color: "var(--t3-terminal-text, var(--foreground, #20252d))",
          boxShadow: "0 4px 16px rgb(0 0 0 / 0.18)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          fontSize: 13,
          lineHeight: "18px"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: MENU_STYLE }),
          menu.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              role: "menuitem",
              disabled: item.disabled === true,
              onClick: () => onChoose(item.id),
              children: item.label
            },
            item.id
          ))
        ]
      }
    );
  }

  // assetLoader.ts
  var ASSET_READ_RETRY_DELAYS_MS = [250, 500, 1e3, 2e3];
  function isAssetReadLimitError(error) {
    return error instanceof Error && /asset read limit reached/i.test(error.message);
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function readAssetWithRetry(read, path3, signal, delays = ASSET_READ_RETRY_DELAYS_MS, wait = sleep) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await read(path3, signal);
      } catch (error) {
        const delay = delays[attempt];
        if (delay === void 0 || signal.aborted || !isAssetReadLimitError(error)) throw error;
        await wait(delay);
        if (signal.aborted) throw error;
      }
    }
  }
  function sharedLoad(load) {
    const loads = /* @__PURE__ */ new WeakMap();
    return (key) => {
      const existing = loads.get(key);
      if (existing) return existing;
      const promise = load(key).catch((error) => {
        if (loads.get(key) === promise) loads.delete(key);
        throw error;
      });
      loads.set(key, promise);
      return promise;
    };
  }

  // streamHub.ts
  var BROKER_STREAM_CAP = 8;
  var FEED_REPLAY_MAX_FRAMES = 64;
  function isBrokerStreamRefusal(error) {
    if (!(error instanceof Error)) return false;
    return error.message === "Plugin stream limit reached" || error.message === "Environment stream limit reached" || error.message === "Worker stream limit reached";
  }
  var advanceReplay = (replay, frame, policy) => {
    if (policy === void 0 || policy.isStateFrame(frame)) return [frame];
    if (replay.length === 0) return [];
    if (replay.length >= FEED_REPLAY_MAX_FRAMES) return [...replay.slice(1), frame];
    return [...replay, frame];
  };
  var TerminalStreamHub = class {
    #feeds = /* @__PURE__ */ new Map();
    #panes = /* @__PURE__ */ new Map();
    #paneWaiters = /* @__PURE__ */ new Set();
    /** Evicted victims whose teardown is draining — resolves their replacements' admission. */
    #drainResolvers = /* @__PURE__ */ new Map();
    #now;
    constructor(options = {}) {
      this.#now = options.now ?? (() => Date.now());
    }
    /** Slots the installation budget leaves for pane output streams. */
    paneStreamBudget() {
      return Math.max(0, BROKER_STREAM_CAP - this.#feeds.size);
    }
    /** Whether a new mandatory pane slot can be granted right now. */
    paneSlotAvailable() {
      return this.#panes.size < this.paneStreamBudget() || this.#evictablePane() !== null;
    }
    /**
     * Joins a shared fixed feed. The driver starts on the first listener and
     * stops when the last one leaves; frames and status fan out to every
     * listener, and a late joiner immediately hears the current status and
     * then the replayed frames (per the feed's policy) so a placement that
     * mounts while the feed is already live catches up instead of waiting
     * for the next server event. Returns the detach function (a plain
     * cleanup so React effects can hand it straight back).
     */
    acquireFixedFeed(key, listener, driver, replayPolicy) {
      let feed = this.#feeds.get(key);
      if (feed === void 0) {
        const drains = [];
        while (this.#panes.size + this.#feeds.size >= BROKER_STREAM_CAP) {
          const victim = this.#evictablePane();
          if (victim === null) break;
          this.#panes.delete(victim.key);
          drains.push(this.#beginDrain(victim.state));
          victim.state.onEvicted();
        }
        feed = {
          controller: new AbortController(),
          driver,
          listeners: /* @__PURE__ */ new Set(),
          lastStatus: null,
          replay: [],
          // The generic policy is wrapped, not cast: isStateFrame must only
          // ever see frames the driver emits through this typed call.
          replayPolicy: replayPolicy === void 0 ? void 0 : { isStateFrame: (frame) => replayPolicy.isStateFrame(frame) }
        };
        this.#feeds.set(key, feed);
        const entry2 = feed;
        if (drains.length > 0) {
          void Promise.all(drains).then(() => this.#startDriver(key, entry2));
        } else {
          this.#startDriver(key, entry2);
        }
      }
      const entry = feed;
      const bound = listener;
      const anchorEvicted = entry.replayPolicy !== void 0 && entry.replay.length > 0 && !entry.replayPolicy.isStateFrame(entry.replay[0]);
      if (anchorEvicted && this.#feeds.get(key) === entry) this.#restartFeed(key, entry);
      const replayFrames = entry.replay;
      entry.listeners.add(bound);
      if (entry.lastStatus !== null)
        bound.onStatus(entry.lastStatus.status, entry.lastStatus.message);
      for (const frame of replayFrames) bound.onFrame(frame);
      return () => {
        if (!entry.listeners.delete(bound)) return;
        if (entry.listeners.size === 0 && this.#feeds.get(key) === entry) {
          this.#feeds.delete(key);
          entry.controller.abort();
        }
      };
    }
    /**
     * Takes a pane slot. `null` means the budget is exhausted by mandatory
     * slots — the caller shows a waiting state and retries via
     * `onPaneSlotFree`. An optional (hidden-pane) lease can be preempted at
     * any later acquisition; its `onEvicted` fires exactly once.
     */
    acquirePaneStream(key, options) {
      const existing = this.#panes.get(key);
      if (existing !== void 0) {
        const wasMandatory = existing.mandatory;
        existing.mandatory = options.mandatory;
        existing.demotedAt = options.mandatory ? Number.POSITIVE_INFINITY : this.#now();
        existing.onEvicted = options.onEvicted;
        if (wasMandatory && !options.mandatory) this.#wakeWaiters();
        return this.#lease(key, existing, Promise.resolve());
      }
      let evicted = null;
      let victimState = null;
      if (this.#panes.size >= this.paneStreamBudget()) {
        if (!options.mandatory) return null;
        const victim = this.#evictablePane();
        if (victim === null) return null;
        this.#panes.delete(victim.key);
        victimState = victim.state;
        evicted = victim.state.onEvicted;
      }
      const state2 = {
        mandatory: options.mandatory,
        demotedAt: options.mandatory ? Number.POSITIVE_INFINITY : this.#now(),
        onEvicted: options.onEvicted,
        draining: null
      };
      this.#panes.set(key, state2);
      const admitted = victimState === null ? Promise.resolve() : this.#beginDrain(victimState);
      evicted?.();
      return this.#lease(key, state2, admitted);
    }
    /**
     * One-shot notification that a pane slot freed (release or eviction) —
     * waiters are dropped after firing, so a caller whose acquire fails again
     * simply registers a fresh one.
     */
    onPaneSlotFree(listener) {
      this.#paneWaiters.add(listener);
      return () => {
        this.#paneWaiters.delete(listener);
      };
    }
    /**
     * Runs the feed's driver against its current controller. The sink captures
     * that controller, so a restart (or the last detach) renders the previous
     * sink inert — an in-flight frame from the old subscription can no longer
     * advance the new replay window.
     */
    #startDriver(key, feed) {
      if (feed.controller.signal.aborted || this.#feeds.get(key) !== feed) return;
      const controller = feed.controller;
      const sink = {
        frame: (frame) => {
          if (controller.signal.aborted) return;
          feed.replay = advanceReplay(feed.replay, frame, feed.replayPolicy);
          for (const listener of feed.listeners) listener.onFrame(frame);
        },
        status: (status, message) => {
          if (controller.signal.aborted) return;
          feed.lastStatus = { status, message };
          for (const listener of feed.listeners) listener.onStatus(status, message);
        }
      };
      feed.driver(sink, controller.signal);
    }
    /**
     * Tears the feed's subscription down and starts it again. The old
     * subscription's broker-side teardown resolves on the microtask queue, so
     * the replacement starts one microtask later — overlapping the two would
     * transiently exceed the stream cap.
     */
    #restartFeed(key, feed) {
      feed.controller.abort();
      feed.controller = new AbortController();
      feed.replay = [];
      queueMicrotask(() => this.#startDriver(key, feed));
    }
    #lease(key, state2, admitted) {
      const hub = this;
      return {
        admitted,
        setPriority(mandatory) {
          if (hub.#panes.get(key) !== state2) return;
          const wasMandatory = state2.mandatory;
          state2.mandatory = mandatory;
          state2.demotedAt = mandatory ? Number.POSITIVE_INFINITY : hub.#now();
          if (wasMandatory && !mandatory) hub.#wakeWaiters();
        },
        release() {
          if (hub.#panes.get(key) !== state2) return;
          hub.#panes.delete(key);
          hub.#wakeWaiters();
        },
        streamSettled() {
          const settle = hub.#drainResolvers.get(state2);
          if (settle === void 0) return;
          hub.#drainResolvers.delete(state2);
          state2.draining = null;
          settle();
        }
      };
    }
    /**
     * Marks an evicted victim's teardown as draining and returns the promise
     * its replacement's admission (or a preempting feed's driver start)
     * waits on. The victim's caller resolves it with `streamSettled()` once
     * its pump has fully exited; a state that was never evicted has none.
     */
    #beginDrain(state2) {
      if (state2.draining !== null) return state2.draining;
      let settle;
      state2.draining = new Promise((resolve) => {
        settle = resolve;
      });
      this.#drainResolvers.set(state2, settle);
      return state2.draining;
    }
    #evictablePane() {
      let victim = null;
      for (const [key, state2] of this.#panes) {
        if (state2.mandatory) continue;
        if (victim === null || state2.demotedAt < victim.state.demotedAt) victim = { key, state: state2 };
      }
      return victim;
    }
    #wakeWaiters() {
      const waiters = [...this.#paneWaiters];
      this.#paneWaiters.clear();
      for (const waiter of waiters) waiter();
    }
  };

  // terminalTheme.ts
  function parseTerminalColor(value, fallback) {
    if (typeof document === "undefined") return fallback;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fallback;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    if (alpha === 0) return fallback;
    return {
      r: red ?? fallback.r,
      g: green ?? fallback.g,
      b: blue ?? fallback.b
    };
  }
  function normalizeComputedColor(value, fallback) {
    const normalizedValue = value?.trim().toLowerCase();
    if (!normalizedValue || normalizedValue === "transparent" || normalizedValue === "rgba(0, 0, 0, 0)" || normalizedValue === "rgba(0 0 0 / 0)") {
      return fallback;
    }
    return value ?? fallback;
  }
  function readThemeColor(styles, variable, fallback) {
    let value = styles.getPropertyValue(variable).trim();
    for (let depth = 0; depth < 4; depth += 1) {
      if (!value.startsWith("var(") || !value.endsWith(")")) break;
      const inner = value.slice(4, -1);
      let split = -1;
      let nested = 0;
      for (let i = 0; i < inner.length; i += 1) {
        const char = inner[i];
        if (char === "(") nested += 1;
        else if (char === ")") nested -= 1;
        else if (char === "," && nested === 0) {
          split = i;
          break;
        }
      }
      const name = (split === -1 ? inner : inner.slice(0, split)).trim();
      const next = styles.getPropertyValue(name).trim();
      value = next !== "" ? next : split === -1 ? "" : inner.slice(split + 1).trim();
      if (value === "") return fallback;
    }
    return normalizeComputedColor(value, fallback);
  }
  function terminalThemeFromApp(mountElement) {
    if (typeof document === "undefined") {
      return {
        background: { r: 255, g: 255, b: 255 },
        foreground: { r: 28, g: 33, b: 41 },
        cursor: { r: 38, g: 56, b: 78 }
      };
    }
    const themeStyles = getComputedStyle(mountElement ?? document.body);
    const colorScheme = themeStyles.colorScheme;
    const isDark = colorScheme === "dark" ? true : colorScheme === "light" ? false : document.documentElement.classList.contains("dark");
    const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)";
    const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)";
    const bodyStyles = getComputedStyle(document.body);
    const rootThemeStyles = getComputedStyle(document.documentElement);
    const background = normalizeComputedColor(
      themeStyles.backgroundColor,
      normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground)
    );
    const foreground = normalizeComputedColor(
      themeStyles.color,
      normalizeComputedColor(bodyStyles.color, fallbackForeground)
    );
    const terminalBackground = readThemeColor(
      themeStyles,
      "--t3-terminal-background",
      readThemeColor(
        themeStyles,
        "--terminal-background",
        readThemeColor(rootThemeStyles, "--terminal-background", background)
      )
    );
    const terminalForeground = readThemeColor(
      themeStyles,
      "--t3-terminal-foreground",
      readThemeColor(
        themeStyles,
        "--terminal-foreground",
        readThemeColor(rootThemeStyles, "--terminal-foreground", foreground)
      )
    );
    const terminalCursor = readThemeColor(
      themeStyles,
      "--terminal-cursor",
      isDark ? "rgb(180, 203, 255)" : "rgb(38, 56, 78)"
    );
    const terminalSelection = readThemeColor(
      themeStyles,
      "--t3-terminal-selection",
      readThemeColor(
        themeStyles,
        "--terminal-selection-background",
        isDark ? "rgba(180, 203, 255, 0.25)" : "rgba(37, 63, 99, 0.2)"
      )
    );
    return {
      background: parseTerminalColor(
        terminalBackground,
        isDark ? { r: 14, g: 18, b: 24 } : { r: 255, g: 255, b: 255 }
      ),
      foreground: parseTerminalColor(
        terminalForeground,
        isDark ? { r: 237, g: 241, b: 247 } : { r: 28, g: 33, b: 41 }
      ),
      cursor: parseTerminalColor(
        terminalCursor,
        isDark ? { r: 180, g: 203, b: 255 } : { r: 38, g: 56, b: 78 }
      ),
      selectionBackground: terminalSelection
    };
  }
  function terminalFontFromVars(vars) {
    if (vars === null) return {};
    const family = vars["--t3-terminal-font-family"]?.trim();
    const sizeMatch = /^\s*([0-9]*\.?[0-9]+)px\s*$/.exec(vars["--t3-terminal-font-size"] ?? "");
    return {
      family: family === void 0 || family === "" || family.startsWith("var(") ? void 0 : family,
      size: sizeMatch === null ? void 0 : Number.parseFloat(sizeMatch[1] ?? "")
    };
  }

  // vtAttachment.ts
  var MAX_OUTPUT_CHUNK_DATA_LENGTH = 8192;
  var MAX_OUTPUT_CHUNKS = 64;
  var MAX_PRE_SINK_OUTPUT_LENGTH = 512 * 1024;
  var TerminalVtAttachment = class {
    terminalId;
    #onChange;
    #sink = null;
    /**
     * Retained post-base output for remount replay — both pre-sink bytes and
     * the bounded tail of what a live sink already rendered, so a recreated
     * surface (theme/font swap) sees the same screen instead of losing every
     * byte since the snapshot. Bounded by MAX_PRE_SINK_OUTPUT_LENGTH.
     */
    #buffered = [];
    #bufferedLength = 0;
    /** The last snapshot contents that seeded parser state, if any. */
    #base = null;
    /**
     * Whether `#base` + `#buffered` reconstructs full parser state — i.e. the
     * base was seeded by a snapshot proven to carry every byte since process
     * start (`clearGeneration === 0 && contentsUnitStart === 0`). A history
     * clear, any retention eviction, or a dropped pre-sink overflow makes the
     * replay base unfaithful; a remount still replays it and flags degraded
     * instead of pretending the modes are known.
     */
    #replayFaithful = true;
    /**
     * Renderer start failure message, or null when the surface is healthy.
     * Sticky across frames: output/snapshot frames keep feeding the bounded
     * replay buffer for a later remount, but they must not re-flag the pane
     * "live" while no renderer ever started. Only a successful `attach` (a
     * renderer that actually mounted) clears it.
     */
    #sinkFailure = null;
    /**
     * Contiguous runs of live output that were never parsed with the PTY
     * reply writer attached, in stream order. Each run carries its POSITION
     * in the replay stream (base + buffered), adjusted as snapshots re-base
     * the stream and eviction trims it — identical queries recur, so a run
     * is identified by where its bytes sit, never by rightmost content
     * match. Bytes delivered to a live sink answered their terminal queries
     * at write time; bytes buffered while detached produced no replies, so
     * replaying them suppressed would silently drop queries the process is
     * still waiting on. Replayed once with replies enabled, then cleared.
     * Snapshot/history bytes are treated as already-rendered history and
     * stay suppressed (native parity), with one exception: the first
     * snapshot proven to cover the whole window since process start is
     * claimed as the window's first gap — its queries' owning process is
     * still waiting on answers (R7).
     */
    #unanswered = [];
    /**
     * The stream epoch that owns the pending runs. A reply queued while
     * detached belongs to the process that asked — an incarnation change
     * discards the claims before any content reconciliation.
     */
    #unansweredEpoch = null;
    /**
     * Code units evicted from the front of `#buffered` since `#base` was
     * set. The hole sits at stream position `base.length`: a run at
     * `start >= base.length` occupies absolute window position
     * `#receivedUnitStart + start + hole`, one inside the base
     * `#receivedUnitStart + start`.
     */
    #bufferedHole = 0;
    /**
     * Absolute UTF-16 unit offset of `#base`'s first unit inside the
     * retained-history window — the snapshot's `contentsUnitStart`, or 0
     * after an observed reset (the post-clear stream restarts at the new
     * window's origin). Claims translate through it into window positions,
     * so line eviction, byte eviction and tail truncation are all just
     * arithmetic — never text matching. null before the first snapshot
     * (no claims can exist then: deliveries require an epoch).
     */
    #receivedUnitStart = null;
    /**
     * Identity of the retained-history window the received stream belongs
     * to — the last snapshot's or observed reset's epoch +
     * `clearGeneration`. A history clear does NOT end the epoch, so a
     * clear inside a subscription gap is otherwise invisible: the next
     * snapshot's `truncated:false` only means "all CURRENT retained
     * bytes", not "same history origin". Same epoch with a different
     * generation means the old window's bytes are gone. null only before
     * the first snapshot.
     */
    #baseWindow = null;
    #pending = null;
    #state = {
      status: "connecting",
      statusText: "Connecting\u2026",
      degraded: false,
      exitCode: null,
      ended: false
    };
    #sequence = 0;
    #epoch = null;
    /**
     * Last accepted native event sequence (the session's monotonic
     * eventSequence — distinct from the broker's per-subscription frame
     * sequence). Seeded by the snapshot's boundarySequence; every later
     * output/reset/exit must strictly increase, catching replays and gaps the
     * outer fence cannot see. `closed` frames carry no native sequence.
     */
    #nativeWatermark = -1;
    constructor(terminalId, onChange) {
      this.terminalId = terminalId;
      this.#onChange = onChange;
    }
    get state() {
      return this.#state;
    }
    /**
     * Re-parse `stream` into a parser, splitting at each unanswered run:
     * bytes already parsed with replies enabled (or never seen live — plain
     * retained history) replay suppressed, unanswered runs replay with the
     * PTY writer attached so their queries get their single reply.
     */
    #replayInto(sink, stream, resetBase) {
      const releasable = this.#unansweredEpoch === this.#epoch;
      const ranges = [];
      if (releasable) {
        for (const run of this.#unanswered) {
          if (stream.startsWith(run.data, run.start)) {
            ranges.push([run.start, run.start + run.data.length]);
          }
        }
      }
      const suppressed = (write) => {
        sink.beginReplay?.();
        try {
          write();
        } finally {
          sink.endReplay?.();
        }
      };
      let pos = ranges[0]?.[0] ?? stream.length;
      if (resetBase) {
        suppressed(() => sink.resetAndWrite(stream.slice(0, pos)));
      } else if (pos > 0) {
        suppressed(() => sink.write(stream.slice(0, pos)));
      }
      for (const [start, end] of ranges) {
        if (start > pos) suppressed(() => sink.write(stream.slice(pos, start)));
        sink.write(stream.slice(start, end));
        pos = end;
      }
      if (pos < stream.length) suppressed(() => sink.write(stream.slice(pos)));
      if (releasable) this.#clearUnanswered();
    }
    /**
     * A snapshot re-bases the stream. Claims survive only by authoritative
     * position: the host reports `contentsUnitStart` — the absolute UTF-16
     * offset of contents[0] inside the retained window (epoch +
     * clearGeneration) — and every run's absolute position is known from
     * the stream's own recorded start. Line eviction, byte eviction and
     * tail truncation are all the same arithmetic then; equal text is
     * never consulted. A run whose absolute position precedes the new
     * contents start is provably evicted — drop it, never migrate it onto
     * a later identical query. A run inside the window is still verified
     * byte-for-byte at its computed position; any disagreement drops it.
     * Without a known stream start (never happens once deliveries exist)
     * or a window that moved backwards (host corruption), drop all.
     */
    #reconcileUnanswered(contents2, contentsUnitStart, priorUnitStart, priorBaseLength, priorHole) {
      if (this.#unanswered.length === 0) return;
      if (priorUnitStart === null || contentsUnitStart < priorUnitStart) {
        this.#unanswered = [];
        return;
      }
      const drop = contentsUnitStart - priorUnitStart;
      this.#unanswered = this.#unanswered.flatMap((run) => {
        const start = run.start + (run.start >= priorBaseLength ? priorHole : 0) - drop;
        if (start + run.data.length <= 0) return [];
        const data = start < 0 ? run.data.slice(-start) : run.data;
        const at = Math.max(start, 0);
        return contents2.startsWith(data, at) ? [{ start: at, data }] : [];
      });
    }
    /**
     * The retained buffer dropped `cutLength` bytes starting at `cutStart`
     * (the buffered tail's front). Runs never straddle the base|buffered
     * boundary, so each is either before the cut, inside it, or after it.
     */
    #mapRunsAfterCut(cutStart, cutLength) {
      const cutEnd = cutStart + cutLength;
      this.#unanswered = this.#unanswered.flatMap((run) => {
        const end = run.start + run.data.length;
        if (end <= cutStart) return [run];
        if (run.start >= cutEnd) return [{ start: run.start - cutLength, data: run.data }];
        const keep = end - Math.max(run.start, cutEnd);
        if (keep <= 0) return [];
        return [{ start: cutStart, data: run.data.slice(run.data.length - keep) }];
      });
    }
    #clearUnanswered() {
      this.#unanswered = [];
      this.#unansweredEpoch = null;
    }
    /**
     * Surface mounted (or remounted after a theme/font swap): replay the base
     * snapshot plus every live byte seen since. `resetAndWrite` rebuilds parser
     * state, so a late surface sees the same screen as a live one — unless the
     * replay base is unfaithful (truncated attach, history clear, dropped
     * pre-sink overflow), in which case the modes it cannot reconstruct leave
     * the pane degraded.
     */
    attach(sink) {
      const previousFailure = this.#sinkFailure;
      this.#sink = sink;
      try {
        this.#replayInto(sink, (this.#base ?? "") + this.#buffered.join(""), this.#base !== null);
      } catch (error) {
        this.#sink = null;
        this.#sinkFailure = previousFailure ?? (error instanceof Error ? `Terminal renderer failed to start: ${error.message}` : "Terminal renderer failed to start.");
        if (!this.#state.ended) {
          this.#emit({
            status: "error",
            statusText: this.#sinkFailure,
            degraded: this.#state.degraded,
            exitCode: null,
            ended: false
          });
        }
        throw error;
      }
      this.#sinkFailure = null;
      if (this.#state.ended) return;
      const unfaithful = !this.#replayFaithful;
      if (previousFailure !== null || unfaithful && !this.#state.degraded) {
        this.#emit({
          ...this.#state,
          status: "live",
          statusText: unfaithful ? "Replayed without full history \u2014 modes and screen state before the retained tail are unknown, so interactive parity is not claimed." : "Watching live output.",
          degraded: unfaithful || this.#state.degraded
        });
      }
    }
    detach() {
      this.#sink = null;
    }
    /**
     * A (re)subscription starts its frame sequence at 1; reset the cursor and
     * clear `ended` — a resumable close must not wedge the next incarnation.
     * The degraded flag survives: a truncated base stays truncated until a
     * full snapshot or reset re-bases the parser.
     */
    beginStream() {
      this.#sequence = 0;
      this.#pending = null;
      this.#epoch = null;
      this.#nativeWatermark = -1;
      this.#emit({
        ...this.#state,
        status: "connecting",
        statusText: "Connecting\u2026",
        ended: false
      });
    }
    /** The host is waiting to resume a dropped transport (`onSuspended`). */
    noteSuspended() {
      const state2 = suspendedOutputStatus(this.#state);
      if (state2 !== this.#state) this.#emit(state2);
    }
    /** The stream itself failed (network/authority), not the terminal. */
    applyTransportError(message) {
      this.#pending = null;
      this.#clearUnanswered();
      this.#emit({
        status: "error",
        statusText: message,
        degraded: this.#state.degraded,
        exitCode: null,
        ended: true
      });
    }
    /**
     * The surface failed to mount (asset decode, DOM). The stream keeps
     * running into the bounded pre-sink buffer so a later remount can still
     * attach; the failure is visible instead of a silently dead pane. The
     * failure is sticky — later snapshot/output frames must not claim the
     * pane is live while the renderer never started.
     */
    applySinkFailure(message) {
      this.#sinkFailure = message;
      if (this.#state.ended) return;
      this.#emit({
        status: "error",
        statusText: message,
        degraded: this.#state.degraded,
        exitCode: null,
        ended: false
      });
    }
    #emit(state2) {
      this.#state = state2;
      this.#onChange?.();
    }
    /**
     * Status a non-lifecycle frame may claim. While a renderer start failure
     * is unresolved the pane stays visibly errored — a snapshot arriving
     * after the failure is not proof the renderer exists.
     */
    #runningStatus() {
      return this.#sinkFailure === null ? { status: "live", statusText: "Watching live output." } : { status: "error", statusText: this.#sinkFailure };
    }
    #fail(message) {
      this.#pending = null;
      this.#clearUnanswered();
      this.#emit({
        status: "error",
        statusText: message,
        degraded: this.#state.degraded,
        exitCode: null,
        ended: true
      });
    }
    #deliver(data) {
      const tail = (this.#base?.length ?? 0) + this.#bufferedLength;
      if (this.#sink !== null) {
        this.#sink.write(data);
      } else {
        const last = this.#unanswered[this.#unanswered.length - 1];
        if (last !== void 0 && last.start + last.data.length === tail) {
          last.data += data;
        } else {
          this.#unanswered.push({ start: tail, data });
        }
        this.#unansweredEpoch = this.#epoch;
      }
      this.#buffered.push(data);
      this.#bufferedLength += data.length;
      if (this.#bufferedLength <= MAX_PRE_SINK_OUTPUT_LENGTH) return;
      let evicted = 0;
      while (this.#buffered.length > 0 && this.#bufferedLength > MAX_PRE_SINK_OUTPUT_LENGTH) {
        evicted += this.#buffered[0].length;
        this.#bufferedLength -= this.#buffered[0].length;
        this.#buffered.shift();
      }
      this.#bufferedHole += evicted;
      this.#mapRunsAfterCut(this.#base?.length ?? 0, evicted);
      this.#replayFaithful = false;
      if (this.#sink === null && !this.#state.degraded && !this.#state.ended) {
        this.#emit({
          ...this.#state,
          degraded: true,
          statusText: this.#sinkFailure ?? "Output outran the renderer before it attached \u2014 early bytes were dropped, so interactive parity is not claimed."
        });
      }
    }
    /**
     * Apply one public `t3.terminal/output-events` frame. Mirrors the native
     * attach reducer — snapshot resets parser state, chunked output reassembles
     * before it reaches the parser, lifecycle frames end or re-base the stream.
     */
    applyFrame(frame, value) {
      if (this.#state.ended && value.kind !== "closed") return;
      if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== this.#sequence + 1) {
        this.#fail("Output transport sequence is discontinuous.");
        return;
      }
      this.#sequence = frame.sequence;
      if (value.kind === "snapshot") {
        if (!Number.isSafeInteger(value.boundarySequence) || value.boundarySequence < 0 || !Number.isSafeInteger(value.clearGeneration) || value.clearGeneration < 0 || !Number.isSafeInteger(value.contentsUnitStart) || value.contentsUnitStart < 0) {
          this.#fail("Output snapshot boundary is invalid.");
          return;
        }
        this.#pending = null;
        const priorUnitStart = this.#receivedUnitStart;
        const priorBaseLength = this.#base?.length ?? 0;
        const priorHole = this.#bufferedHole;
        const priorBufferedLength = this.#bufferedLength;
        const priorWindow = this.#baseWindow;
        this.#epoch = value.streamEpoch;
        this.#nativeWatermark = value.boundarySequence;
        this.#base = value.contents;
        this.#receivedUnitStart = value.contentsUnitStart;
        this.#buffered = [];
        this.#bufferedLength = 0;
        this.#bufferedHole = 0;
        this.#baseWindow = { epoch: value.streamEpoch, generation: value.clearGeneration };
        const missedClear = priorWindow !== null && priorWindow.epoch === value.streamEpoch && priorWindow.generation !== value.clearGeneration;
        if (this.#unanswered.length > 0 && (this.#unansweredEpoch !== value.streamEpoch || missedClear)) {
          this.#clearUnanswered();
        } else {
          this.#reconcileUnanswered(
            value.contents,
            value.contentsUnitStart,
            priorUnitStart,
            priorBaseLength,
            priorHole
          );
        }
        const firstWindow = priorWindow === null && priorUnitStart === null && !value.truncated && value.clearGeneration === 0 && value.contentsUnitStart === 0;
        const sameWindow = firstWindow || priorWindow !== null && priorWindow.epoch === value.streamEpoch && !missedClear;
        const priorEnd = firstWindow ? 0 : priorUnitStart === null ? null : priorUnitStart + priorBaseLength + priorHole + priorBufferedLength;
        const boundaryEnd = value.contentsUnitStart + value.contents.length;
        const coversPriorEnd = priorEnd !== null && value.contentsUnitStart <= priorEnd;
        const heldClaims = this.#unanswered.length > 0;
        let gapRun = null;
        if (sameWindow && priorEnd !== null && boundaryEnd > priorEnd && coversPriorEnd) {
          const gapStart = Math.max(0, priorEnd - value.contentsUnitStart);
          gapRun = { start: gapStart, data: value.contents.slice(gapStart) };
          this.#unanswered.push(gapRun);
          this.#unansweredEpoch = value.streamEpoch;
        }
        const caughtUp = sameWindow && priorEnd !== null && boundaryEnd >= priorEnd && coversPriorEnd && !heldClaims;
        this.#replayFaithful = !missedClear && !value.truncated && value.clearGeneration === 0 && value.contentsUnitStart === 0;
        const unfaithful = !this.#replayFaithful;
        if (this.#sink) {
          if (caughtUp) {
            if (gapRun !== null) {
              this.#sink.write(gapRun.data);
              this.#unanswered = this.#unanswered.filter((run) => run !== gapRun);
              if (this.#unanswered.length === 0) this.#unansweredEpoch = null;
            }
          } else {
            this.#replayInto(this.#sink, value.contents, true);
          }
        }
        const ended = value.status === "exited" || value.status === "error";
        const running = this.#runningStatus();
        const degraded = caughtUp ? this.#state.degraded : unfaithful;
        this.#emit({
          status: ended ? "exited" : running.status,
          statusText: ended ? `Terminal is ${value.status}.` : this.#sinkFailure !== null ? this.#sinkFailure : caughtUp ? "Watching live output." : value.truncated ? "Watching live output \u2014 earlier history was truncated, so terminal state may be incomplete." : value.clearGeneration > 0 ? "Watching live output \u2014 history was cleared, so terminal modes may be incomplete." : unfaithful ? "Watching live output \u2014 earlier output exceeded retention, so terminal state may be incomplete." : "Watching live output.",
          degraded: degraded && !ended,
          exitCode: null,
          ended
        });
        return;
      }
      if (this.#epoch === null || value.streamEpoch !== this.#epoch) {
        this.#fail("Output incarnation changed.");
        return;
      }
      if (value.kind === "closed") {
        this.#pending = null;
        if (value.reason !== "overflow") this.#clearUnanswered();
        this.#emit({
          status: "closed",
          statusText: `Output unavailable: ${value.reason}.`,
          degraded: this.#state.degraded,
          exitCode: null,
          ended: true
        });
        return;
      }
      if (!Number.isSafeInteger(value.sequence)) {
        this.#fail("Output native sequence is invalid.");
        return;
      }
      if (value.kind === "reset") {
        if (this.#pending !== null) {
          this.#fail("Output chunk group is discontinuous.");
          return;
        }
        if (!Number.isSafeInteger(value.clearGeneration) || value.clearGeneration < 0) {
          this.#fail("Output reset window is invalid.");
          return;
        }
        if (value.sequence <= this.#nativeWatermark) {
          this.#fail("Output event sequence is not monotonic.");
          return;
        }
        this.#nativeWatermark = value.sequence;
        this.#pending = null;
        this.#base = "";
        this.#receivedUnitStart = 0;
        this.#baseWindow = { epoch: value.streamEpoch, generation: value.clearGeneration };
        this.#buffered = [];
        this.#bufferedLength = 0;
        this.#bufferedHole = 0;
        this.#clearUnanswered();
        this.#replayFaithful = false;
        if (this.#sink) {
          this.#sink.clearScreen();
        }
        const running = this.#runningStatus();
        this.#emit({
          status: running.status,
          statusText: this.#sinkFailure !== null ? this.#sinkFailure : this.#sink !== null ? "Terminal history cleared. Watching live output." : "Terminal history cleared before the renderer attached \u2014 earlier modes are unknown.",
          degraded: this.#sink === null || this.#state.degraded,
          exitCode: null,
          ended: false
        });
        return;
      }
      if (value.kind === "exit") {
        if (this.#pending !== null) {
          this.#fail("Terminal exited with incomplete output.");
          return;
        }
        if (value.sequence <= this.#nativeWatermark) {
          this.#fail("Output event sequence is not monotonic.");
          return;
        }
        this.#nativeWatermark = value.sequence;
        this.#clearUnanswered();
        this.#emit({
          status: "exited",
          statusText: `Terminal exited (code ${value.exitCode ?? "unknown"}).`,
          degraded: this.#state.degraded,
          exitCode: value.exitCode,
          ended: true
        });
        return;
      }
      if (!Number.isSafeInteger(value.chunkCount) || value.chunkCount < 1 || value.chunkCount > MAX_OUTPUT_CHUNKS || !Number.isSafeInteger(value.chunkIndex) || value.chunkIndex < 0 || value.chunkIndex >= value.chunkCount || typeof value.data !== "string" || value.data.length > MAX_OUTPUT_CHUNK_DATA_LENGTH) {
        this.#fail("Output chunk exceeds the public contract.");
        return;
      }
      if (this.#pending !== null) {
        if (value.sequence !== this.#pending.sequence || value.chunkCount !== this.#pending.count || value.chunkIndex !== this.#pending.parts.length) {
          this.#fail("Output chunk group is discontinuous.");
          return;
        }
        this.#pending.parts.push(value.data);
        if (this.#pending.parts.length < this.#pending.count) return;
        const data = this.#pending.parts.join("");
        this.#pending = null;
        this.#nativeWatermark = value.sequence;
        this.#deliver(data);
        return;
      }
      if (value.chunkIndex !== 0) {
        this.#fail("Output chunk group is discontinuous.");
        return;
      }
      if (value.sequence <= this.#nativeWatermark) {
        this.#fail("Output event sequence is not monotonic.");
        return;
      }
      if (value.chunkCount > 1) {
        this.#pending = {
          sequence: value.sequence,
          count: value.chunkCount,
          parts: [value.data]
        };
        return;
      }
      this.#nativeWatermark = value.sequence;
      this.#deliver(value.data);
    }
  };
  async function pumpTerminalOutput(options) {
    const { attachment, signal } = options;
    const sleep2 = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = options.now ?? Date.now;
    let streak = EMPTY_OVERFLOW_STREAK;
    while (!signal.aborted) {
      attachment.beginStream();
      let resurrect = false;
      let overflowClose = false;
      let started = false;
      try {
        for await (const frame of options.subscribe(signal, () => attachment.noteSuspended())) {
          if (signal.aborted) return;
          if (frame.sequence === 1 && started) attachment.beginStream();
          started = true;
          streak = noteOutputFrameForStreak(frame.value, streak, now());
          attachment.applyFrame(frame, frame.value);
          if (frame.value.kind === "exit") {
            resurrect = true;
            break;
          }
          if (frame.value.kind === "closed") {
            overflowClose = frame.value.reason === "overflow";
            resurrect = isResumableOutputClose(
              frame.value.reason,
              streak.attempts
            );
            break;
          }
        }
      } catch (error) {
        if (options.refusal?.(error) === true) {
          options.onRefused?.();
          return;
        }
        if (!signal.aborted) {
          attachment.applyTransportError(
            error instanceof Error ? error.message : "Terminal output unavailable"
          );
        }
        return;
      }
      if (signal.aborted || !resurrect) return;
      if (overflowClose && streak.attempts > 1) await sleep2(300 * streak.attempts);
    }
  }

  // extension.tsx
  var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
  var manifestId = "t3.terminal";
  var streamHub = new TerminalStreamHub();
  var GHOSTTY_VT_ASSET = "assets/ghostty-vt.wasm";
  var GHOSTTY_WRITE_PTY_ASSET = "assets/ghostty-write-pty.wasm";
  var SYMBOLS_FONT_ASSET = "assets/SymbolsNerdFontMono-Regular.woff2";
  var TERMINAL_BODY_MIN_HEIGHT = 120;
  var SESSION_SIDEBAR_WIDTH = 144;
  var TERMINAL_PANES_MIN_WIDTH = 160;
  var RESTORED_GROUP_KEYS = /* @__PURE__ */ new Set(["id", "terminalIds", "splitDirection"]);
  function isRestoredGroup(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value;
    return Object.keys(value).every((key) => RESTORED_GROUP_KEYS.has(key)) && typeof candidate.id === "string" && Array.isArray(candidate.terminalIds) && candidate.terminalIds.every((id2) => typeof id2 === "string") && (candidate.splitDirection === void 0 || candidate.splitDirection === "horizontal" || candidate.splitDirection === "vertical");
  }
  function restoreState(value) {
    if (value === null) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value;
    return Object.keys(value).every(
      (key) => key === "terminalIds" || key === "activeTerminalId" || key === "terminalGroups" || key === "activeTerminalGroupId"
    ) && (candidate.terminalIds === void 0 || Array.isArray(candidate.terminalIds) && candidate.terminalIds.every((id2) => typeof id2 === "string")) && (candidate.activeTerminalId === void 0 || typeof candidate.activeTerminalId === "string" || candidate.activeTerminalId === null) && (candidate.terminalGroups === void 0 || Array.isArray(candidate.terminalGroups) && candidate.terminalGroups.every(isRestoredGroup)) && (candidate.activeTerminalGroupId === void 0 || typeof candidate.activeTerminalGroupId === "string" || candidate.activeTerminalGroupId === null);
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
  var loadGhosttyAssets = sharedLoad(async (host) => {
    if (!host.readAsset) throw new Error("This host cannot load package assets.");
    const read = host.readAsset.bind(host);
    const signal = new AbortController().signal;
    const vt = await readAssetWithRetry(read, GHOSTTY_VT_ASSET, signal);
    const writePty = await readAssetWithRetry(read, GHOSTTY_WRITE_PTY_ASSET, signal);
    const font = await readAssetWithRetry(read, SYMBOLS_FONT_ASSET, signal);
    if (vt.mediaType !== "application/wasm" || writePty.mediaType !== "application/wasm") {
      throw new Error("Terminal WASM assets failed package verification.");
    }
    if (font.mediaType !== "font/woff2") {
      throw new Error("Terminal symbols font failed package verification.");
    }
    const runtime = await loadGhosttyRuntime({
      vt: vt.bytes.slice(),
      writePty: writePty.bytes.slice()
    });
    return { runtime, symbolsFont: font.bytes };
  });
  function useGhosttyAssets(host, session) {
    const [state2, setState] = (0, import_react2.useState)({ kind: "loading" });
    (0, import_react2.useEffect)(() => {
      let cancelled = false;
      let symbolsFontUrl = null;
      loadGhosttyAssets(host).then(
        ({ runtime, symbolsFont }) => {
          if (cancelled || session.signal.aborted) return;
          symbolsFontUrl = URL.createObjectURL(
            new Blob([symbolsFont], { type: "font/woff2" })
          );
          setState({ kind: "ready", runtime, symbolsFontUrl });
        },
        (error) => {
          if (cancelled || session.signal.aborted) return;
          setState({
            kind: "unavailable",
            message: error instanceof Error ? error.message : "Terminal renderer unavailable"
          });
        }
      );
      return () => {
        cancelled = true;
        if (symbolsFontUrl !== null) URL.revokeObjectURL(symbolsFontUrl);
      };
    }, [host, session]);
    return state2;
  }
  function useSessionsStream(host, session, panel, visible) {
    (0, import_react2.useLayoutEffect)(() => {
      if (!visible) return;
      const environmentId = session.context.resource.environmentId ?? "";
      const threadId = session.context.resource.threadId ?? "";
      return streamHub.acquireFixedFeed(
        `sessions:${environmentId}:${threadId}`,
        {
          onFrame: (frame) => panel.applySessionsEvent(frame),
          onStatus: (status, message) => {
            if (status === "connecting") panel.beginListStream();
            else panel.markStreamDisconnected(message);
          }
        },
        (sink, signal) => {
          void (async () => {
            let refusals = 0;
            for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
              sink.status("connecting", null);
              let closed = false;
              try {
                const stream = bindStreamApi(terminalSessionsApi, host, session.context).subscribe(
                  "list",
                  {},
                  signal,
                  resolveResumableStreams(host) ? {
                    resume: "fresh-snapshot",
                    onSuspended: () => sink.status("connecting", null)
                  } : void 0
                );
                for await (const frame of stream) {
                  if (signal.aborted) return;
                  sink.frame(frame.value);
                  if (frame.value.kind === "closed") {
                    closed = true;
                    break;
                  }
                }
              } catch (error) {
                if (!signal.aborted && isBrokerStreamRefusal(error)) {
                  refusals += 1;
                  if (refusals > 8) {
                    sink.status("disconnected", "Session list stream was refused repeatedly.");
                    return;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 400 * refusals));
                  attempt = 0;
                  continue;
                }
                if (!signal.aborted)
                  sink.status(
                    "disconnected",
                    error instanceof Error ? error.message : "Session list unavailable"
                  );
                return;
              }
              if (signal.aborted) return;
              if (!closed) {
                sink.status("disconnected", null);
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
            }
            if (!signal.aborted) sink.status("disconnected", "Session list stream ended repeatedly.");
          })();
        },
        // The feed is shared across placements, and a placement that mounts
        // while the feed is already live never sees a fresh snapshot — the
        // replayed [snapshot … deltas] history is what makes its panel go
        // live. Deltas only count on top of a snapshot.
        { isStateFrame: (frame) => frame.kind === "snapshot" }
      );
    }, [host, session, panel, visible]);
  }
  function useThemeVars(host, session, visible) {
    const [vars, setVars] = (0, import_react2.useState)(null);
    (0, import_react2.useLayoutEffect)(() => {
      if (!visible) return;
      return streamHub.acquireFixedFeed(
        `theme:${session.context.resource.environmentId ?? ""}`,
        { onFrame: setVars, onStatus: () => {
        } },
        (sink, signal) => {
          void watchThemeVars({
            client: host,
            context: session.context,
            signal,
            apply: (value) => sink.frame(value)
          });
        }
      );
    }, [host, session, visible]);
    return vars;
  }
  function useTerminalAppearanceVars(host, session, visible) {
    const [vars, setVars] = (0, import_react2.useState)(null);
    (0, import_react2.useLayoutEffect)(() => {
      if (!visible) return;
      return streamHub.acquireFixedFeed(
        `appearance:${session.context.resource.environmentId ?? ""}`,
        { onFrame: setVars, onStatus: () => {
        } },
        (sink, signal) => {
          void watchTerminalAppearanceVars({
            client: host,
            context: session.context,
            signal,
            apply: (value) => sink.frame(value)
          });
        }
      );
    }, [host, session, visible]);
    return vars;
  }
  function closeOwnSurface(host, session) {
    const threadId = session.context.resource.threadId;
    if (threadId === void 0) return Promise.resolve();
    return bindApi(uiPanelsApi, host, session.context).invoke("closeSurface", { surfaceId: TERMINAL_SURFACE_ID, threadId }, session.signal).then(
      () => void 0,
      () => {
        throw new Error("The host could not close this panel.");
      }
    );
  }
  function usePanelCommands(host, session, panel, visible, actions) {
    (0, import_react2.useEffect)(() => {
      if (!visible) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      let release = null;
      void registerPanelCommands({
        client: host,
        context: session.context,
        signal,
        bindCommands: (token, handler) => session.bindCommands(token, handler),
        onCommand: (commandId) => void dispatchTerminalCommand(commandId, actions)
      }).then(
        (registration) => {
          if (registration === null) return;
          if (signal.aborted) registration.release();
          else release = registration.release;
        },
        () => {
        }
      );
      return () => {
        controller.abort();
        release?.();
      };
    }, [host, session, panel, visible, actions]);
  }
  function focusedVtTerminalId() {
    const active = document.activeElement;
    const pane = active?.closest("[data-t3-terminal-output]")?.closest("[data-t3-terminal-pane]");
    return pane instanceof HTMLElement ? pane.dataset.t3TerminalPane ?? null : null;
  }
  function useEditingCommands(host, session, panel, active) {
    const binding = (0, import_react2.useRef)("pending");
    (0, import_react2.useEffect)(() => {
      if (!active) return;
      binding.current = "pending";
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      let release = null;
      void negotiatedEditingCommands(host, session.context, signal).then(
        ({ commands, versionRange }) => registerPanelCommands({
          client: host,
          context: session.context,
          signal,
          commands,
          versionRange,
          bindCommands: (token, handler) => session.bindCommands(token, handler),
          onCommand: (commandId) => {
            if (!isTerminalEditingCommand(commandId)) return;
            const terminalId = focusedVtTerminalId() ?? panel.snapshot.activeTerminalId;
            if (terminalId !== null) panel.sendInput(terminalId, TERMINAL_EDITING_INPUT[commandId]);
          }
        })
      ).then(
        (registration) => {
          if (registration === null) return;
          if (signal.aborted) registration.release();
          else {
            release = registration.release;
            binding.current = "bound";
          }
        },
        () => {
          if (!signal.aborted) binding.current = "unavailable";
        }
      );
      return () => {
        controller.abort();
        binding.current = "pending";
        release?.();
      };
    }, [host, session, panel, active]);
    return binding;
  }
  function handleBeforeKey(event, panel, terminalId, keybindings, binding) {
    return terminalEditingBeforeKey(
      event,
      keybindings,
      { pluginId: manifestId, binding },
      (data) => panel.sendInput(terminalId, data)
    );
  }
  function writeSystemMessage(surface, message) {
    surface.write(`\r
[terminal] ${message}\r
`);
  }
  function composerChatSink(host, session, panel, terminalId) {
    if (session.context.resource.threadId === void 0) return void 0;
    const composer = bindApi(composerContextApi, host, session.context);
    return {
      terminalId,
      terminalLabel: () => panel.snapshot.tabs.find((tab) => tab.terminalId === terminalId)?.label ?? getTerminalLabel(terminalId),
      probe: async () => {
        const capabilities = await composer.invoke("getCapabilities", {}, session.signal);
        return capabilities.transport === "client" && capabilities.operations.insertTerminalContext;
      },
      insert: (selection) => composer.invoke("insertTerminalContext", selection, session.signal)
    };
  }
  function TerminalPane(props) {
    const {
      host,
      session,
      panel,
      terminalId,
      streamKeyPrefix,
      active,
      shown,
      visible,
      running,
      assets,
      themeVars,
      appearanceVars,
      editingBinding
    } = props;
    const [, bump] = (0, import_react2.useReducer)((value) => value + 1, 0);
    const [attachment] = (0, import_react2.useState)(
      () => new TerminalVtAttachment(terminalId, () => {
        bump();
      })
    );
    const mountRef = (0, import_react2.useRef)(null);
    const surfaceRef = (0, import_react2.useRef)(null);
    const [chatSink] = (0, import_react2.useState)(() => composerChatSink(host, session, panel, terminalId));
    const selectionMenu = useTerminalSelectionMenu({
      mountRef,
      surfaceRef,
      reportError: writeSystemMessage,
      ...chatSink ? { chat: chatSink } : {}
    });
    const shownRef = (0, import_react2.useRef)(shown && visible);
    const runningRef = (0, import_react2.useRef)(running);
    runningRef.current = running;
    const activeRef = (0, import_react2.useRef)(active);
    activeRef.current = active;
    const appearanceVarsRef = (0, import_react2.useRef)(appearanceVars);
    appearanceVarsRef.current = appearanceVars;
    const [streamBlocked, setStreamBlocked] = (0, import_react2.useState)(false);
    const acquireStreamRef = (0, import_react2.useRef)((_mandatory) => {
    });
    const runningChangedRef = (0, import_react2.useRef)((_running) => {
    });
    (0, import_react2.useEffect)(() => {
      if (!visible) return;
      let stopped = false;
      let run = null;
      const reattach = new OutputReattach(runningRef.current);
      let retryRegistration = null;
      let brokerRefusals = 0;
      let brokerRefusalTimer = null;
      const stopRun = () => {
        retryRegistration?.();
        retryRegistration = null;
        if (brokerRefusalTimer !== null) {
          clearTimeout(brokerRefusalTimer);
          brokerRefusalTimer = null;
        }
        const current = run;
        run = null;
        current?.lease.release();
        current?.controller.abort();
      };
      const acquire = (mandatory) => {
        if (stopped || run !== null) return;
        const lease = streamHub.acquirePaneStream(`${streamKeyPrefix}/${terminalId}`, {
          mandatory,
          onEvicted: () => {
            if (run?.lease === lease) stopRun();
          }
        });
        if (lease === null) {
          setStreamBlocked(true);
          retryRegistration = streamHub.onPaneSlotFree(() => acquire(shownRef.current));
          return;
        }
        setStreamBlocked(false);
        const controller = new AbortController();
        run = { controller, lease };
        void lease.admitted.then(() => {
          if (stopped || run?.controller !== controller) {
            lease.streamSettled();
            return;
          }
          let refused = false;
          void pumpTerminalOutput({
            subscribe: (subscribeSignal, onSuspended) => {
              reattach.subscribed();
              const source = subscribeOutput(
                host,
                session.context,
                terminalId,
                subscribeSignal,
                onSuspended
              );
              return (async function* () {
                for await (const frame of source) {
                  const value = frame.value;
                  if (value.kind === "closed" && value.reason !== "overflow") {
                    panel.resetInput(terminalId);
                  }
                  if (value.kind === "snapshot") panel.noteOutputSnapshot(terminalId, value.status);
                  if (value.kind === "exit") {
                    const surface = surfaceRef.current;
                    if (surface !== null)
                      writeSystemMessage(
                        surface,
                        `Process exited (code ${value.exitCode ?? "unknown"})`
                      );
                    panel.noteExit(terminalId, value.exitCode);
                  }
                  yield { streamId: frame.streamId, sequence: frame.sequence, value };
                }
              })();
            },
            attachment,
            signal: AbortSignal.any([controller.signal, session.signal]),
            refusal: isBrokerStreamRefusal,
            onRefused: () => {
              refused = true;
              brokerRefusals += 1;
              setStreamBlocked(true);
              brokerRefusalTimer = setTimeout(
                () => {
                  brokerRefusalTimer = null;
                  if (!stopped) acquire(shownRef.current);
                },
                Math.min(400 * brokerRefusals, 3200)
              );
            }
          }).finally(() => {
            const endedOnItsOwn = run?.controller === controller;
            if (endedOnItsOwn) {
              run = null;
              lease.release();
            }
            lease.streamSettled();
            if (!refused) brokerRefusals = 0;
            if (endedOnItsOwn && !refused) resume();
          });
        });
      };
      acquireStreamRef.current = (mandatory) => {
        if (run === null) {
          if (mandatory) acquire(true);
          return;
        }
        run.lease.setPriority(mandatory);
      };
      const resume = () => {
        if (!stopped && run === null && reattach.take()) acquire(shownRef.current);
      };
      runningChangedRef.current = (next) => {
        reattach.noteRunning(next);
        resume();
      };
      acquire(shownRef.current);
      return () => {
        stopped = true;
        acquireStreamRef.current = () => {
        };
        runningChangedRef.current = () => {
        };
        stopRun();
      };
    }, [host, session, panel, terminalId, attachment, visible, streamKeyPrefix]);
    (0, import_react2.useEffect)(() => {
      runningChangedRef.current(running);
    }, [running]);
    (0, import_react2.useEffect)(() => {
      acquireStreamRef.current(shown && visible);
    }, [shown, visible]);
    (0, import_react2.useEffect)(() => {
      const mount = mountRef.current;
      if (mount === null || assets.kind !== "ready") return;
      let cancelled = false;
      let surface = null;
      const themeObserver = new MutationObserver(() => {
        surface?.setTheme(terminalThemeFromApp(mount));
      });
      void (async () => {
        const createdFont = terminalFontFromVars(appearanceVarsRef.current);
        const options = {
          runtime: assets.runtime,
          symbolsFontUrl: assets.symbolsFontUrl,
          theme: terminalThemeFromApp(mount),
          font: createdFont,
          get visible() {
            return shownRef.current;
          },
          onData: (data) => panel.sendInput(terminalId, data),
          onResize: (cols, rows) => panel.resize(terminalId, cols, rows),
          onSelectionChange: selectionMenu.onSelectionChange,
          onContextMenu: selectionMenu.onContextMenu,
          beforeKey: (event) => handleBeforeKey(event, panel, terminalId, host.keybindings, editingBinding.current),
          onLinkActivate: (text, event) => {
            if (surface === null) return;
            const paneSurface = surface;
            const signal = session.signal;
            const report = (failure) => {
              if (failure !== null && !signal.aborted && surfaceRef.current === paneSurface)
                writeSystemMessage(paneSurface, failure);
            };
            if (isTerminalUrl(text)) {
              const forceSystem = event.metaKey || event.ctrlKey;
              void openTerminalUrl(
                (url) => openExternalLink(host, session.context, url, { forceSystem, signal }),
                text
              ).then(report);
              return;
            }
            const workspace = workspaceLaunchFromRevision(session.context.workspaceRevision);
            if (workspace === null) {
              report(`${text} cannot be opened \u2014 the workspace is not available.`);
              return;
            }
            void openTerminalPath(
              bindApi(uiEditorApi, host, session.context),
              text,
              workspace.cwd,
              signal
            ).then(report);
          }
        };
        try {
          surface = await GhosttyTerminalSurface.create(mount, options);
        } catch (error) {
          if (!cancelled) {
            attachment.applySinkFailure(
              error instanceof Error ? `Terminal renderer failed to start: ${error.message}` : "Terminal renderer failed to start."
            );
          }
          return;
        }
        if (cancelled) {
          surface.dispose();
          surface = null;
          return;
        }
        surface.setVisible(shownRef.current);
        surface.setTheme(terminalThemeFromApp(mount));
        const latestFont = terminalFontFromVars(appearanceVarsRef.current);
        if (latestFont.family !== createdFont.family || latestFont.size !== createdFont.size) {
          void surface.setFont(latestFont).catch(() => {
          });
        }
        surfaceRef.current = surface;
        if (activeRef.current && shownRef.current) surface.focus();
        try {
          attachment.attach(surface);
        } catch {
          surface.dispose();
          surface = null;
          surfaceRef.current = null;
          return;
        }
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style"]
        });
      })();
      return () => {
        cancelled = true;
        themeObserver.disconnect();
        attachment.detach();
        surface?.dispose();
        surfaceRef.current = null;
      };
    }, [
      host,
      session,
      assets,
      attachment,
      panel,
      terminalId,
      selectionMenu.onContextMenu,
      selectionMenu.onSelectionChange
    ]);
    (0, import_react2.useEffect)(() => {
      shownRef.current = shown && visible;
      surfaceRef.current?.setVisible(shown && visible);
      if (active && shown && visible) surfaceRef.current?.focus();
    }, [active, shown, visible]);
    (0, import_react2.useEffect)(() => {
      const mount = mountRef.current;
      if (mount !== null) surfaceRef.current?.setTheme(terminalThemeFromApp(mount));
      void surfaceRef.current?.setFont(terminalFontFromVars(appearanceVars)).catch(() => {
      });
    }, [themeVars, appearanceVars]);
    const state2 = attachment.state;
    const muted = "var(--muted-foreground, #667085)";
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          minWidth: 0
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "output",
            {
              "aria-label": "Output status",
              style: { padding: "6px 10px", color: muted, fontSize: 12, flexShrink: 0 },
              children: [
                terminalId,
                ": ",
                state2.statusText
              ]
            }
          ),
          state2.degraded && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Attach degraded",
              style: { padding: "4px 10px", color: muted, fontSize: 12, flexShrink: 0 },
              children: "Attached with truncated history \u2014 modes and screen state before the retained tail are unknown, so interactive parity is not claimed until the next full snapshot."
            }
          ),
          streamBlocked && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Stream budget",
              style: { padding: "4px 10px", color: muted, fontSize: 12, flexShrink: 0 },
              children: "Waiting for a free output stream \u2014 close a pane here or in another terminal panel, and this pane attaches as soon as one frees."
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "div",
            {
              ref: mountRef,
              "aria-label": "Terminal output",
              "data-t3-terminal-output": true,
              style: {
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // Real properties carrying the contract chains — they resolve
                // var() references at use time, which is exactly what
                // terminalThemeFromApp needs (getPropertyValue on a custom
                // property would return the unresolved token stream).
                background: "var(--t3-terminal-background, var(--terminal-background, transparent))",
                color: "var(--t3-terminal-foreground, var(--terminal-foreground, inherit))",
                // Bridges the published --t3-terminal-color-scheme into the real
                // property terminalThemeFromApp reads for its dark fallback.
                colorScheme: "var(--t3-terminal-color-scheme, normal)"
              }
            }
          ),
          selectionMenu.menu
        ]
      }
    );
  }
  function subscribeOutput(host, context, terminalId, signal, onSuspended) {
    return bindStreamApi(terminalOutputEventsApi, host, context).subscribe(
      "subscribe",
      { terminalId },
      signal,
      resolveResumableStreams(host) ? { resume: "fresh-snapshot", onSuspended } : void 0
    );
  }
  function useTerminalOutput(host, session, panel, terminalId, visible, running) {
    const [state2, setState] = (0, import_react2.useState)(null);
    const pendingRef = (0, import_react2.useRef)(null);
    const runningRef = (0, import_react2.useRef)(running);
    runningRef.current = running;
    const runningChangedRef = (0, import_react2.useRef)((_running) => {
    });
    (0, import_react2.useEffect)(() => {
      pendingRef.current = null;
      if (!visible || terminalId === null) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, session.signal]);
      const reattach = new OutputReattach(runningRef.current);
      let attached = false;
      const attach = () => {
        attached = true;
        void pump().finally(() => {
          attached = false;
          resume();
        });
      };
      const resume = () => {
        if (!signal.aborted && !attached && reattach.take()) attach();
      };
      runningChangedRef.current = (next) => {
        reattach.noteRunning(next);
        resume();
      };
      const pump = async () => {
        let streak = EMPTY_OVERFLOW_STREAK;
        let overflowClose = false;
        while (!signal.aborted) {
          pendingRef.current = null;
          const stateRef = { current: EMPTY_OUTPUT_BUFFER };
          let resurrect = false;
          try {
            reattach.subscribed();
            const stream = subscribeOutput(host, session.context, terminalId, signal, () => {
              const suspended = suspendedOutputStatus(stateRef.current);
              if (suspended === stateRef.current) return;
              stateRef.current = suspended;
              setState({ terminalId, buffer: suspended });
            });
            for await (const frame of stream) {
              if (signal.aborted) return;
              if (frame.sequence === 1 && stateRef.current.sequence > 0) {
                pendingRef.current = null;
                stateRef.current = EMPTY_OUTPUT_BUFFER;
              }
              const value = frame.value;
              streak = noteOutputFrameForStreak(value, streak, Date.now());
              if (value.kind === "snapshot") panel.noteOutputSnapshot(terminalId, value.status);
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
              if (value.kind === "exit") {
                panel.noteExit(terminalId, value.exitCode);
                overflowClose = false;
                resurrect = true;
                break;
              }
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
      };
      attach();
      return () => {
        runningChangedRef.current = () => {
        };
        controller.abort();
      };
    }, [host, session, panel, terminalId, visible]);
    (0, import_react2.useEffect)(() => {
      runningChangedRef.current(running);
    }, [running]);
    return state2?.terminalId === terminalId ? state2.buffer : null;
  }
  function useFitResize(panel, terminalId, ref) {
    (0, import_react2.useEffect)(() => {
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
  function sessionStatusText(tab) {
    const parts = [];
    if (tab.exitBanner !== null) parts.push(tab.exitBanner);
    else if (tab.status !== "running")
      parts.push(
        tab.status === "exited" && tab.exitCode !== null ? `exited (code ${tab.exitCode})` : tab.status
      );
    if (tab.error !== null) parts.push(tab.error);
    if (tab.queuedInputCount > 0) parts.push(`queued ${tab.queuedInputCount}`);
    return parts.length === 0 ? null : parts.join(" \xB7 ");
  }
  var control = {
    padding: "4px 8px",
    border: "1px solid transparent",
    borderRadius: 5,
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 14,
    cursor: "pointer"
  };
  function TerminalView(props) {
    const { host, session } = props;
    const [, bump] = (0, import_react2.useReducer)((value) => value + 1, 0);
    const streamKeyPrefix = (0, import_react2.useId)();
    const [panel] = (0, import_react2.useState)(() => {
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
        // The installation-wide pane budget gates open/split BEFORE any PTY
        // spawns: a terminal that could never get an output stream would
        // render as a dead pane until something else closed.
        canAllocatePaneStream: () => streamHub.paneSlotAvailable(),
        onChange: () => {
          const snapshot2 = panel2.snapshot;
          session.save({
            terminalIds: [...snapshot2.terminalIds],
            activeTerminalId: snapshot2.activeTerminalId,
            terminalGroups: snapshot2.groups.map((group) => ({
              id: group.id,
              terminalIds: [...group.terminalIds],
              // The native group shape stores only "vertical"; absent reads
              // as horizontal, so the default direction stays unwritten.
              ...group.splitDirection === "vertical" ? { splitDirection: "vertical" } : {}
            })),
            activeTerminalGroupId: snapshot2.activeGroupId
          });
          bump();
        }
      });
      return panel2;
    });
    const [visible, setVisible] = (0, import_react2.useState)(session.visible);
    const [input, setInput] = (0, import_react2.useState)("");
    const outputRef = (0, import_react2.useRef)(null);
    (0, import_react2.useEffect)(() => session.onVisibility(setVisible), [session]);
    (0, import_react2.useEffect)(() => () => panel.dispose(), [panel]);
    useSessionsStream(host, session, panel, visible);
    const panelActions = (0, import_react2.useMemo)(
      () => ({
        newTerminal: () => void panel.openTerminal(),
        closeTerminal: () => {
          const activeId2 = panel.snapshot.activeTerminalId;
          if (activeId2 !== null) panel.requestAction(activeId2, "close");
        },
        splitTerminal: (direction) => void panel.splitTerminal(direction),
        toggleSurface: () => void closeOwnSurface(host, session).catch(
          (error) => panel.notePanelError(error instanceof Error ? error.message : "Panel action failed")
        )
      }),
      [panel, host, session]
    );
    usePanelCommands(host, session, panel, visible, panelActions);
    const themeVars = useThemeVars(host, session, visible);
    const appearanceVars = useTerminalAppearanceVars(host, session, visible);
    const assets = useGhosttyAssets(host, session);
    const editingBinding = useEditingCommands(
      host,
      session,
      panel,
      visible && assets.kind === "ready"
    );
    const snapshot = panel.snapshot;
    const activeId = snapshot.activeTerminalId;
    const activeTab = snapshot.tabs.find((tab) => tab.terminalId === activeId) ?? null;
    const shortcutLabel = (command) => host.keybindings?.terminalFocusShortcutLabel?.(command) ?? null;
    const closeShortcutLabel = shortcutLabel("terminal.close");
    const activeGroup = snapshot.groups.find((group) => group.id === snapshot.activeGroupId) ?? null;
    const visibleTerminalIds = activeGroup?.terminalIds ?? (activeId !== null ? [activeId] : []);
    const visibleSet = new Set(visibleTerminalIds);
    const splitDirection = activeGroup?.splitDirection ?? "horizontal";
    const paneOrder = [
      ...visibleTerminalIds,
      ...snapshot.terminalIds.filter((id2) => !visibleSet.has(id2))
    ];
    const tabById = new Map(snapshot.tabs.map((tab) => [tab.terminalId, tab]));
    const missingShownKey = visibleTerminalIds.filter((id2) => tabById.get(id2)?.status === "closed").join("\n");
    (0, import_react2.useEffect)(() => {
      if (visible && missingShownKey !== "") panel.startMissingSessions(missingShownKey.split("\n"));
    }, [panel, visible, missingShownKey, snapshot.stream]);
    const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;
    const splitLimitNote = hasReachedSplitLimit ? `max ${MAX_TERMINALS_PER_GROUP} per group` : null;
    const newTerminalLabel = terminalActionLabel("New Terminal", shortcutLabel("terminal.new"));
    const splitHorizontalLabel = terminalActionLabel(
      "Split Terminal Horizontally",
      shortcutLabel("terminal.split"),
      splitLimitNote
    );
    const splitVerticalLabel = terminalActionLabel(
      "Split Terminal Vertically",
      shortcutLabel("terminal.splitVertical"),
      splitLimitNote
    );
    const showGroupHeaders = snapshot.groups.length > 1 || snapshot.groups.some((group) => group.terminalIds.length > 1);
    const textFallback = assets.kind === "unavailable";
    const output = useTerminalOutput(
      host,
      session,
      panel,
      textFallback ? activeId : null,
      visible && textFallback,
      activeTab?.status === "running"
    );
    useFitResize(panel, textFallback ? activeId : null, outputRef);
    const outputContents = output?.contents ?? "";
    const plainOutput = (0, import_react2.useMemo)(() => plainTerminalText(outputContents), [outputContents]);
    const send = () => {
      if (activeId === null || input.length === 0) return;
      panel.sendInput(activeId, input + "\r");
      setInput("");
    };
    const muted = "var(--t3-terminal-muted, var(--muted-foreground, #667085))";
    const border = "1px solid var(--t3-terminal-border, var(--border, #dfe3e8))";
    const sessionSidebar = snapshot.tabs.length > 1;
    const sessionList = /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "ul",
      {
        "aria-label": "Terminal sessions",
        style: {
          listStyle: "none",
          margin: 0,
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          // In the sidebar the list takes the body's height and scrolls, so
          // adding sessions never takes height from the panes.
          ...sessionSidebar ? { flex: 1, minHeight: 0, overflowY: "auto" } : { flexShrink: 0 }
        },
        children: snapshot.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
          showGroupHeaders && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "button",
            {
              type: "button",
              "aria-label": `Activate terminal group ${group.id}`,
              onClick: () => {
                const target = group.terminalIds.includes(activeId ?? "") ? activeId : group.terminalIds[0];
                if (target !== void 0) panel.activate(target);
              },
              style: {
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "2px 6px",
                border: "1px solid transparent",
                borderRadius: 5,
                cursor: "pointer",
                font: "inherit",
                fontSize: 11,
                color: snapshot.activeGroupId === group.id ? "inherit" : muted,
                background: snapshot.activeGroupId === group.id ? "var(--t3-terminal-accent-surface, var(--accent, #e8eef7))" : "transparent"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: 1, minWidth: 0, textAlign: "left" }, children: group.terminalIds.length === 1 ? "Single" : group.splitDirection === "vertical" ? "Stacked" : "Side by side" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 10 }, children: group.terminalIds.length })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "ul",
            {
              style: {
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 2
              },
              children: group.terminalIds.map((terminalId) => {
                const tab = tabById.get(terminalId);
                if (!tab) return null;
                const status = sessionStatusText(tab);
                return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { "data-t3-terminal-session": tab.terminalId, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: status ?? tab.label, side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    "aria-label": status ? [tab.label, status].join(" \u2014 ") : void 0,
                    "aria-current": tab.terminalId === activeId ? "true" : void 0,
                    onClick: () => panel.activate(tab.terminalId),
                    style: {
                      display: "block",
                      width: "100%",
                      height: 24,
                      textAlign: "left",
                      padding: "0 6px",
                      border: "1px solid transparent",
                      borderRadius: 5,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: tab.terminalId === activeId ? "inherit" : muted,
                      background: tab.terminalId === activeId ? "var(--t3-terminal-accent-surface, var(--accent, #e8eef7))" : "transparent"
                    },
                    children: tab.label
                  }
                ) }) }, tab.terminalId);
              })
            }
          )
        ] }, group.id))
      }
    );
    const iconControl = { ...control, padding: "0 6px", fontSize: 13, lineHeight: "22px" };
    const activeStatus = activeTab === null ? null : sessionStatusText(activeTab);
    const closeLabel = terminalActionLabel("Close Terminal", closeShortcutLabel);
    const sessionActions = activeTab !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        role: "toolbar",
        "aria-label": "Session actions",
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          padding: "0 4px",
          minHeight: 22,
          flexShrink: 0,
          fontSize: 12,
          ...sessionSidebar ? { borderBottom: border } : {}
        },
        children: activeTab.confirmAction === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          activeStatus !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "span",
            {
              style: {
                flex: 1,
                minWidth: 0,
                color: muted,
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: activeStatus
            }
          ),
          (activeTab.status === "exited" || activeTab.status === "error" || activeTab.status === "closed") && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: "Start", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": `Start ${activeTab.terminalId}`,
              onClick: () => void panel.startSession(activeTab.terminalId),
              style: iconControl,
              children: "\u25B6"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: "Clear history", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": `Clear ${activeTab.terminalId}`,
              onClick: () => panel.requestAction(activeTab.terminalId, "clear"),
              style: iconControl,
              children: "\u232B"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: "Restart", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": `Restart ${activeTab.terminalId}`,
              onClick: () => panel.requestAction(activeTab.terminalId, "restart"),
              style: iconControl,
              children: "\u21BB"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: closeLabel, side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": closeLabel,
              onClick: () => panel.requestAction(activeTab.terminalId, "close"),
              style: iconControl,
              children: "\xD7"
            }
          ) })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: "1 1 100%", color: muted, fontSize: 12 }, children: activeTab.confirmAction === "close" ? "Close this terminal?" : activeTab.confirmAction === "restart" ? "Restart this terminal?" : "Clear history?" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": `Confirm ${activeTab.confirmAction} ${activeTab.terminalId}`,
              onClick: () => void panel.confirmAction(activeTab.terminalId),
              style: { ...control, fontSize: 12, padding: "2px 6px" },
              children: "Confirm"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              "aria-label": `Cancel ${activeTab.confirmAction} ${activeTab.terminalId}`,
              onClick: () => panel.cancelAction(activeTab.terminalId),
              style: { ...control, fontSize: 12, padding: "2px 6px" },
              children: "Cancel"
            }
          )
        ] })
      }
    );
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "section",
      {
        "aria-label": "Terminal",
        onKeyDownCapture: (event) => {
          if (event.defaultPrevented) return;
          const action = terminalChordAction(
            event.nativeEvent,
            host.keybindings,
            isMacPlatform(navigator.platform)
          );
          if (action !== null && dispatchTerminalCommand(action, panelActions)) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        style: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          // A dock shorter than the chrome plus the body floor scrolls rather
          // than collapsing the panes.
          overflowY: "auto",
          color: "var(--t3-terminal-text, var(--foreground, #20252d))",
          background: "var(--t3-terminal-canvas, var(--background, #fff))",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          // Contract-derived custom properties inherit to every descendant —
          // the chrome's var() chains, the fallback <pre>, and the mount div
          // terminalThemeFromApp resolves into the Ghostty theme.
          ...themeVars,
          ...appearanceVars
        },
        "data-t3-terminal-panel": true,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: `[data-t3-terminal-output]::selection{background:var(--t3-terminal-selection,Highlight)}
[data-t3-terminal-panel] :is(button,input,select,textarea):focus-visible{outline:none;box-shadow:0 0 0 1px var(--t3-terminal-canvas, var(--background, #fff)),0 0 0 3px var(--ring, var(--primary, #1b4ed8))}` }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "header",
            {
              style: {
                display: "flex",
                gap: 6,
                padding: 8,
                borderBottom: border,
                flexShrink: 0,
                alignItems: "center",
                flexWrap: "wrap"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: newTerminalLabel, side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    onClick: () => void panel.openTerminal(),
                    disabled: snapshot.stream !== "live",
                    style: control,
                    children: "New terminal"
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: splitHorizontalLabel, side: "bottom", showWhenDisabled: true, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "button",
                  {
                    type: "button",
                    onClick: () => void panel.splitTerminal("horizontal"),
                    disabled: snapshot.stream !== "live" || hasReachedSplitLimit,
                    style: control,
                    children: [
                      "Split horizontally",
                      splitLimitNote === null ? "" : ` (${splitLimitNote})`
                    ]
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tooltip, { host, label: splitVerticalLabel, side: "bottom", showWhenDisabled: true, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "button",
                  {
                    type: "button",
                    onClick: () => void panel.splitTerminal("vertical"),
                    disabled: snapshot.stream !== "live" || hasReachedSplitLimit,
                    style: control,
                    children: [
                      "Split vertically",
                      splitLimitNote === null ? "" : ` (${splitLimitNote})`
                    ]
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: muted, fontSize: 12 }, children: snapshot.stream === "closed" ? "Session list disconnected" : snapshot.stream === "connecting" ? "Connecting\u2026" : "" })
              ]
            }
          ),
          !sessionSidebar && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { flex: 1, minWidth: 0 }, children: sessionList }),
            sessionActions
          ] }),
          snapshot.tabs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }, children: "No terminals yet. New terminal opens a shell in this workspace." }),
          snapshot.panelError && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Panel status",
              style: { padding: "4px 10px", color: muted, fontSize: 12 },
              children: snapshot.panelError
            }
          ),
          activeTab?.inputStopped && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "div",
            {
              role: "alert",
              style: {
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "6px 10px",
                fontSize: 12,
                color: muted,
                borderTop: border,
                flexShrink: 0
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: 1, minWidth: 0 }, children: activeTab.inputMessage }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    onClick: () => activeId !== null && panel.resumeInput(activeId),
                    style: control,
                    children: "Resume input"
                  }
                )
              ]
            }
          ),
          assets.kind === "loading" && activeId !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Renderer status",
              style: { padding: "6px 10px", color: muted, fontSize: 12 },
              children: "Loading terminal renderer\u2026"
            }
          ),
          assets.kind === "unavailable" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "output",
            {
              "aria-label": "Renderer status",
              style: { padding: "6px 10px", color: muted, fontSize: 12 },
              children: [
                "VT renderer unavailable (",
                assets.message,
                ") \u2014 showing a plain-text view."
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "div",
            {
              "data-t3-terminal-body": true,
              style: {
                display: "flex",
                flex: 1,
                minHeight: TERMINAL_BODY_MIN_HEIGHT,
                minWidth: 0,
                ...sessionSidebar ? { overflowX: "auto" } : {}
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "div",
                  {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      flex: "1 1 0",
                      minWidth: sessionSidebar ? TERMINAL_PANES_MIN_WIDTH : 0,
                      minHeight: 0
                    },
                    children: [
                      !textFallback && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "div",
                        {
                          "aria-label": "Terminal panes",
                          style: {
                            display: "flex",
                            flexDirection: splitDirection === "vertical" ? "column" : "row",
                            flex: 1,
                            minHeight: 0,
                            minWidth: 0
                          },
                          children: paneOrder.map((terminalId, index) => {
                            const shown = visibleSet.has(terminalId);
                            const focused = terminalId === activeId;
                            return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                              "div",
                              {
                                "data-t3-terminal-pane": terminalId,
                                onMouseDown: shown && !focused ? () => {
                                  panel.activate(terminalId);
                                } : void 0,
                                style: {
                                  display: shown ? "flex" : "none",
                                  flexDirection: "column",
                                  flex: "1 1 0",
                                  minWidth: 0,
                                  minHeight: 0,
                                  borderLeft: splitDirection === "horizontal" && index > 0 ? `1px solid ${focused ? "var(--t3-terminal-border, var(--border, #dfe3e8))" : "var(--t3-terminal-muted, var(--border, #dfe3e8))"}` : void 0,
                                  borderTop: splitDirection === "vertical" && index > 0 ? `1px solid ${focused ? "var(--t3-terminal-border, var(--border, #dfe3e8))" : "var(--t3-terminal-muted, var(--border, #dfe3e8))"}` : void 0
                                },
                                children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                                  TerminalPane,
                                  {
                                    host,
                                    session,
                                    panel,
                                    terminalId,
                                    streamKeyPrefix,
                                    active: focused,
                                    shown,
                                    visible,
                                    running: tabById.get(terminalId)?.status === "running",
                                    assets,
                                    themeVars,
                                    appearanceVars,
                                    editingBinding
                                  }
                                )
                              },
                              terminalId
                            );
                          })
                        }
                      ),
                      textFallback && activeId !== null && activeTab !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                        "div",
                        {
                          style: {
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            minHeight: 0,
                            borderTop: border
                          },
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                              "output",
                              {
                                "aria-label": "Output status",
                                style: { padding: "6px 10px", color: muted, fontSize: 12, flexShrink: 0 },
                                children: [
                                  activeId,
                                  ": ",
                                  activeTab.exitBanner ?? output?.statusText ?? "Connecting\u2026",
                                  activeTab.error ? ` \u2014 ${activeTab.error}` : ""
                                ]
                              }
                            ),
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                              "pre",
                              {
                                ref: outputRef,
                                "aria-label": "Terminal output",
                                "data-t3-terminal-output": true,
                                style: {
                                  flex: 1,
                                  minHeight: 0,
                                  margin: 0,
                                  padding: 12,
                                  overflow: "auto",
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "anywhere",
                                  color: "var(--t3-terminal-foreground, var(--terminal-foreground, inherit))",
                                  background: "var(--t3-terminal-background, var(--terminal-background, transparent))",
                                  fontFamily: "var(--t3-terminal-font-family, var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace))",
                                  fontSize: "var(--t3-terminal-font-size, 12px)",
                                  lineHeight: "var(--t3-terminal-line-height, normal)",
                                  fontVariantLigatures: "var(--t3-terminal-ligatures, normal)",
                                  colorScheme: "var(--t3-terminal-color-scheme, normal)"
                                },
                                children: plainOutput
                              }
                            ),
                            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                              "div",
                              {
                                style: {
                                  display: "flex",
                                  gap: 6,
                                  padding: 8,
                                  borderTop: border,
                                  flexShrink: 0
                                },
                                children: [
                                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                                    "input",
                                    {
                                      "aria-label": "Terminal input",
                                      placeholder: activeTab.starting ? "Starting\u2026 input is queued" : "Type a command",
                                      value: input,
                                      onChange: (event) => setInput(event.target.value),
                                      onKeyDown: (event) => {
                                        if (event.key === "Enter") send();
                                      },
                                      style: {
                                        ...control,
                                        flex: 1,
                                        minWidth: 0,
                                        cursor: "text",
                                        background: "var(--t3-terminal-input, var(--input, transparent))"
                                      }
                                    }
                                  ),
                                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: send, style: control, children: "Send" })
                                ]
                              }
                            )
                          ]
                        }
                      )
                    ]
                  }
                ),
                sessionSidebar && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "aside",
                  {
                    "aria-label": "Terminal session list",
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      width: SESSION_SIDEBAR_WIDTH,
                      flexShrink: 0,
                      minHeight: 0,
                      borderLeft: border
                    },
                    children: [
                      sessionActions,
                      sessionList
                    ]
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "output",
            {
              "aria-label": "Slice notice",
              style: { padding: "6px 10px", color: muted, fontSize: 12, flexShrink: 0 },
              children: "Ghostty VT rendering over the public control contract; theme, terminal appearance, and panel keybindings follow the host's t3.ui/* providers. Link activation is reported inline \u2014 there is no transient-toast path, so t3.ui/notifications is not adopted."
            }
          )
        ]
      }
    );
  }
  var authored = defineExtension({
    id: manifestId,
    version: "0.3.0",
    requires: [
      requireApi(terminalSessionsApi),
      requireApi(terminalOutputApi),
      requireApi(terminalOutputEventsApi),
      requireApi(terminalControlApi),
      // "Add to chat" (insertTerminalContext is 1.1.0). The host provider is
      // always registered; getCapabilities reports whether a composer is there.
      requireApi(composerContextApi),
      // Mandatory requirements — the broker only authorizes invocations for
      // declared APIs, so the t3.ui/* contracts must be declared even though
      // the panel degrades per-call. A host without these providers resolves
      // the package missing-api rather than mounting it; the degraded paths
      // cover denied or failing calls and dead streams on a capable host.
      requireApi(uiThemeApi),
      // 1.1.0 only adds the optional host.keybindings resolver, which the
      // panel feature-detects (default chords without it), so a 1.0.0 host
      // still loads the panel.
      requireApi(uiKeybindingsApi, "^1.0.0"),
      requireApi(uiPanelsApi),
      // Terminal 22 URL half: detected URLs open on the user's own client.
      requireApi(uiExternalApi),
      // Terminal 22 path half: path links open in the user's preferred editor.
      requireApi(uiEditorApi)
    ],
    assets: [
      { path: GHOSTTY_VT_ASSET, mediaType: "application/wasm" },
      { path: GHOSTTY_WRITE_PTY_ASSET, mediaType: "application/wasm" },
      { path: SYMBOLS_FONT_ASSET, mediaType: "font/woff2" },
      { path: "assets/SymbolsNerdFontMono-LICENSE.txt", mediaType: "application/octet-stream" },
      { path: "assets/libghostty-vt-LICENSE.txt", mediaType: "application/octet-stream" },
      { path: "assets/libghostty-vt-VERSION.txt", mediaType: "application/octet-stream" }
    ],
    surfaces: [
      {
        name: "view",
        title: "Terminal",
        scope: "thread",
        placements: ["side-panel", "bottom-dock"],
        clients: ["web", "desktop"],
        capabilities: [],
        // Owning focus-owner arbitration: the host tags the frame
        // `data-terminal-owner="extension"` and leaves the focused terminal
        // chords (split/splitVertical/new/close) to this view's keybindings.
        // The claim is only honest because the panel implements all four.
        claimsTerminalFocus: true,
        stateVersion: 1,
        validateRestore: restoreState,
        createView(host, session) {
          return { renderer: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TerminalView, { host, session }) };
        }
      }
    ]
  });
  var clientFactory = authored.client;
  var extension_default = {
    ...authored,
    ...clientFactory === void 0 ? {} : {
      client(host) {
        host.registerGlobalCommands?.(TERMINAL_GLOBAL_COMMANDS);
        return clientFactory(host);
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
