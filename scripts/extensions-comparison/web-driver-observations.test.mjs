import { test } from "node:test";
import assert from "node:assert/strict";
import { endpoint, selector, metricSnapshot, measuredDelta, webSocketPayloadBytes, validateRequest } from "./web-driver-observations.mjs";
import { observe } from "./web-driver.mjs";

const target = { webUrl: "http://127.0.0.1:8179/env/thread", webCdpUrl: "http://127.0.0.1:9222",
  ownedBrowser: true, disposable: true, artifactDir: "/tmp/owned-comparison" };
test("requests require explicit disposable browser ownership and credential-free endpoints", () => {
  assert.equal(validateRequest({ phase: "timing", journey: { id: "files" }, target }), "files");
  for (const bad of ["http://user:password@localhost/", "http://localhost/?token=secret", "http://localhost/#secret", "file:///tmp/a"])
    assert.throws(() => endpoint(bad, "test"));
  assert.throws(() => validateRequest({ phase: "timing", journey: "files", target: { ...target, ownedBrowser: false } }));
  assert.throws(() => validateRequest({ phase: "timing", journey: "files", target: { ...target, timeoutMs: 0 } }));
});
test("selectors cannot silently choose ambiguous fallback or substitute missing readiness", () => {
  assert.deepEqual(selector({ role: "button", name: "Refresh workspace files" }), { role: "button", name: "Refresh workspace files" });
  assert.deepEqual(selector({ css: "[data-terminal-owner] canvas" }), { css: "[data-terminal-owner] canvas" });
  for (const bad of [null, {}, { css: "" }, { role: "button" }, { css: "canvas", role: "button" }])
    assert.throws(() => selector(bad));
});
test("missing or reset CDP metrics fail instead of becoming zero or clamped", () => {
  const valid = { metrics: [{ name: "TaskDuration", value: 2 }, { name: "JSHeapUsedSize", value: 400 }, { name: "Timestamp", value: 10 }] };
  const before = metricSnapshot(valid, { jsEventListeners: 3, nodes: 8 });
  assert.throws(() => metricSnapshot({ metrics: [] }, { jsEventListeners: 0, nodes: 0 }));
  assert.throws(() => metricSnapshot(valid, {}));
  assert.throws(() => measuredDelta(before, { ...before, rendererTaskSeconds: 1, timestampSeconds: 11 }));
  assert.throws(() => measuredDelta(before, before));
  const measured = measuredDelta(before, { ...before, rendererTaskSeconds: 2.5, timestampSeconds: 12 });
  assert.equal(measured.rendererTaskMs, 500);
  assert.equal(measured.observationWindowMs, 2000);
  assert.equal("cpuMs" in measured, false);
  assert.equal("rssBytes" in measured, false);
});
test("wire payload accounting measures UTF-8 or decoded binary bytes without retaining payload", () => {
  assert.equal(webSocketPayloadBytes({ opcode: 1, payloadData: "🙂" }), 4);
  assert.equal(webSocketPayloadBytes({ opcode: 2, payloadData: "AP8=" }), 2);
  assert.throws(() => webSocketPayloadBytes({ opcode: 1 }));
});
test("unsupported native/browser journeys cannot pass from a requested schedule", async () => {
  for (const journey of ["browser", "agents", "version-control"]) {
    const result = await observe({ phase: "conformance", journey, target, fixtureHash: "expected", environmentHash: "expected" });
    assert.equal(result.status, "inconclusive");
    assert.deepEqual(result.observedChecks, []);
    assert.deepEqual(result.measurements, {});
    assert.equal("servedBuildSha" in result, false);
    assert.equal("fixtureHash" in result, false);
    assert.equal("soak" in result, false);
  }
});

test("strict CLI preserves unsupported status and nonzero process exit", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./web-driver.mjs", import.meta.url))], {
    input: JSON.stringify({ phase: "conformance", journey: "browser", target }), encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, "inconclusive");
  assert.equal(result.stderr, "");
});
