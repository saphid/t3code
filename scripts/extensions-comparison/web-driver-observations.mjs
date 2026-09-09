import * as NodeBuffer from "node:buffer";

export function endpoint(value, label) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} must be an HTTP URL without credentials, query or fragment`);
  return url;
}
export function selector(value) {
  if (!value || typeof value !== "object") throw new Error("Selector descriptor required");
  if (typeof value.css === "string" && value.css.trim() && Object.keys(value).length === 1)
    return { css: value.css };
  if (
    typeof value.role === "string" &&
    typeof value.name === "string" &&
    value.name &&
    Object.keys(value).every((key) => ["role", "name"].includes(key))
  )
    return { role: value.role, name: value.name };
  throw new Error("Use a single CSS selector or exact role/name descriptor");
}
export function metricSnapshot(performance, dom) {
  const metrics = new Map(performance.metrics.map(({ name, value }) => [name, value]));
  const required = ["TaskDuration", "JSHeapUsedSize", "Timestamp"];
  for (const key of required) {
    if (!Number.isFinite(metrics.get(key)) || metrics.get(key) < 0)
      throw new Error(`CDP did not report valid ${key}`);
  }
  if (
    !Number.isInteger(dom.jsEventListeners) ||
    dom.jsEventListeners < 0 ||
    !Number.isInteger(dom.nodes) ||
    dom.nodes < 0
  )
    throw new Error("Missing DOM counters");
  return {
    rendererTaskSeconds: metrics.get("TaskDuration"),
    heapBytes: metrics.get("JSHeapUsedSize"),
    timestampSeconds: metrics.get("Timestamp"),
    domListeners: dom.jsEventListeners,
    domNodes: dom.nodes,
  };
}
export function measuredDelta(before, after) {
  const task = after.rendererTaskSeconds - before.rendererTaskSeconds;
  const elapsed = after.timestampSeconds - before.timestampSeconds;
  if (task < 0 || elapsed <= 0) throw new Error("CDP counters reset or clock did not advance");
  return {
    rendererTaskMs: task * 1000,
    observationWindowMs: elapsed * 1000,
    heapBytes: after.heapBytes,
    domListeners: after.domListeners,
    domNodes: after.domNodes,
  };
}
export function webSocketPayloadBytes(frame) {
  if (typeof frame.payloadData !== "string" || !Number.isInteger(frame.opcode))
    throw new Error("Invalid CDP WebSocket frame");
  return frame.opcode === 1
    ? NodeBuffer.Buffer.byteLength(frame.payloadData, "utf8")
    : NodeBuffer.Buffer.from(frame.payloadData, "base64").length;
}
export function validateRequest(request) {
  if (!request || !["timing", "conformance"].includes(request.phase))
    throw new Error("Invalid phase");
  const journey = typeof request.journey === "string" ? request.journey : request.journey?.id;
  if (
    !["files", "diff", "terminal", "sidebar", "browser", "agents", "version-control"].includes(
      journey,
    )
  )
    throw new Error("Unknown journey");
  const target = request.target;
  if (target?.ownedBrowser !== true || target?.disposable !== true)
    throw new Error("Explicit ownedBrowser and disposable declarations required");
  endpoint(target.webUrl, "webUrl");
  if (journey !== "browser") endpoint(target.webCdpUrl, "webCdpUrl");
  if (typeof target.artifactDir !== "string" || !target.artifactDir.startsWith("/"))
    throw new Error("Absolute artifactDir required");
  if (
    target.timeoutMs !== undefined &&
    (!Number.isInteger(target.timeoutMs) || target.timeoutMs < 1 || target.timeoutMs > 60000)
  )
    throw new Error("timeoutMs must be 1..60000");
  if (target.selectors?.[journey]) {
    for (const value of Object.values(target.selectors[journey])) selector(value);
  }
  if (target.pageMode !== undefined && !["fresh", "reuse"].includes(target.pageMode))
    throw new Error("Unknown pageMode");
  return journey;
}

export function contentFixture(request, journey) {
  if (!["files", "diff", "terminal"].includes(journey)) return null;
  const fixture = request.target.content?.[journey];
  const keys =
    journey === "files"
      ? ["filename", "text"]
      : journey === "diff"
        ? ["file", "before", "after"]
        : ["threadId", "terminalId"];
  if (
    !fixture ||
    keys.some(
      (key) =>
        typeof fixture[key] !== "string" || !fixture[key].trim() || fixture[key].length > 4096,
    )
  )
    throw new Error("Explicit deterministic content fixture required");
  if (journey === "terminal" && fixture.allowInput !== true)
    throw new Error("Terminal fixture must explicitly authorize input in its owned active shell");
  if (
    journey === "terminal" &&
    new URL(request.target.webUrl).pathname.split("/").at(-1) !== fixture.threadId
  )
    throw new Error("Terminal fixture thread differs from requested page");
  return fixture;
}
export function completeCycles(raw, expected, errors, requireContent = true) {
  if (errors.length) throw new Error("Page emitted errors during observation");
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length !== expected) throw new Error("Incomplete raw cycles");
  const samples = lines.map((line) => JSON.parse(line));
  samples.forEach((sample, index) => {
    if (
      sample.cycle !== index ||
      !Number.isFinite(sample.openMs) ||
      sample.openMs < 0 ||
      !Number.isFinite(sample.hideMs) ||
      sample.hideMs < 0
    )
      throw new Error("Invalid raw cycle sequence or timing");
    if (requireContent && sample.content?.matched !== true)
      throw new Error("Raw cycle lacks content evidence");
  });
  return samples;
}
export function reusablePage(pages, webUrl) {
  const expected = endpoint(webUrl, "webUrl");
  const matching = pages.filter((page) => {
    try {
      const actual = new URL(page.url());
      return actual.href === expected.href;
    } catch {
      return false;
    }
  });
  if (matching.length !== 1)
    throw new Error("Reuse requires exactly one existing page at the exact fixture URL");
  return matching[0];
}
export function terminalChunks(value, fixture) {
  if (!value || typeof value !== "object") return [];
  if (
    value.type === "output" &&
    value.threadId === fixture.threadId &&
    value.terminalId === fixture.terminalId &&
    typeof value.data === "string"
  )
    return [value.data];
  return Object.values(value).flatMap((child) => terminalChunks(child, fixture));
}
