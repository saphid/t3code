import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  endpoint,
  selector,
  metricSnapshot,
  measuredDelta,
  webSocketPayloadBytes,
  validateRequest,
} from "./web-driver-observations.mjs";
import { observe } from "./web-driver.mjs";

const target = {
  webUrl: "http://127.0.0.1:8179/env/thread",
  webCdpUrl: "http://127.0.0.1:9222",
  ownedBrowser: true,
  disposable: true,
  artifactDir: "/tmp/owned-comparison",
};
NodeTest.test(
  "requests require explicit disposable browser ownership and credential-free endpoints",
  () => {
    NodeAssert.equal(
      validateRequest({ phase: "timing", journey: { id: "files" }, target }),
      "files",
    );
    for (const bad of [
      "http://user:password@localhost/",
      "http://localhost/?token=secret",
      "http://localhost/#secret",
      "file:///tmp/a",
    ])
      NodeAssert.throws(() => endpoint(bad, "test"));
    NodeAssert.throws(() =>
      validateRequest({
        phase: "timing",
        journey: "files",
        target: { ...target, ownedBrowser: false },
      }),
    );
    NodeAssert.throws(() =>
      validateRequest({ phase: "timing", journey: "files", target: { ...target, timeoutMs: 0 } }),
    );
  },
);
NodeTest.test(
  "selectors cannot silently choose ambiguous fallback or substitute missing readiness",
  () => {
    NodeAssert.deepEqual(selector({ role: "button", name: "Refresh workspace files" }), {
      role: "button",
      name: "Refresh workspace files",
    });
    NodeAssert.deepEqual(selector({ css: "[data-terminal-owner] canvas" }), {
      css: "[data-terminal-owner] canvas",
    });
    for (const bad of [
      null,
      {},
      { css: "" },
      { role: "button" },
      { css: "canvas", role: "button" },
    ])
      NodeAssert.throws(() => selector(bad));
  },
);
NodeTest.test("missing or reset CDP metrics fail instead of becoming zero or clamped", () => {
  const valid = {
    metrics: [
      { name: "TaskDuration", value: 2 },
      { name: "JSHeapUsedSize", value: 400 },
      { name: "Timestamp", value: 10 },
    ],
  };
  const before = metricSnapshot(valid, { jsEventListeners: 3, nodes: 8 });
  NodeAssert.throws(() => metricSnapshot({ metrics: [] }, { jsEventListeners: 0, nodes: 0 }));
  NodeAssert.throws(() => metricSnapshot(valid, {}));
  NodeAssert.throws(() =>
    measuredDelta(before, { ...before, rendererTaskSeconds: 1, timestampSeconds: 11 }),
  );
  NodeAssert.throws(() => measuredDelta(before, before));
  const measured = measuredDelta(before, {
    ...before,
    rendererTaskSeconds: 2.5,
    timestampSeconds: 12,
  });
  NodeAssert.equal(measured.rendererTaskMs, 500);
  NodeAssert.equal(measured.observationWindowMs, 2000);
  NodeAssert.equal("cpuMs" in measured, false);
  NodeAssert.equal("rssBytes" in measured, false);
});
NodeTest.test(
  "wire payload accounting measures UTF-8 or decoded binary bytes without retaining payload",
  () => {
    NodeAssert.equal(webSocketPayloadBytes({ opcode: 1, payloadData: "🙂" }), 4);
    NodeAssert.equal(webSocketPayloadBytes({ opcode: 2, payloadData: "AP8=" }), 2);
    NodeAssert.throws(() => webSocketPayloadBytes({ opcode: 1 }));
  },
);
NodeTest.test(
  "unsupported native/browser journeys cannot pass from a requested schedule",
  async () => {
    for (const journey of ["browser", "agents", "version-control"]) {
      const result = await observe({
        phase: "conformance",
        journey,
        target,
        fixtureHash: "expected",
        environmentHash: "expected",
      });
      NodeAssert.equal(result.status, "inconclusive");
      NodeAssert.deepEqual(result.observedChecks, []);
      NodeAssert.deepEqual(result.measurements, {});
      NodeAssert.equal("servedBuildSha" in result, false);
      NodeAssert.equal("fixtureHash" in result, false);
      NodeAssert.equal("soak" in result, false);
    }
  },
);

NodeTest.test("strict CLI preserves unsupported status and nonzero process exit", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./web-driver.mjs", import.meta.url))],
    {
      input: JSON.stringify({ phase: "conformance", journey: "browser", target }),
      encoding: "utf8",
    },
  );
  NodeAssert.equal(result.status, 2);
  NodeAssert.equal(JSON.parse(result.stdout).status, "inconclusive");
  NodeAssert.equal(result.stderr, "");
});
