// F5 paired performance baseline harness.
// Measures: (a) resolver work (resolveCapabilities / providerGeneration) per invoke and
// per pulled stream event, (b) discoverApis incl. one unrelated slow provider,
// (c) host-side createView open path. Measurement only; no optimizations.
//
// Usage:
//   node perf/f5-baseline.mjs --out <dir> [--iterations N] [--events N] [--smoke]
//
// Resolution counting: broker's resolution() calls options.health(id) exactly once per
// installation, so healthCalls / installationCount is the exact number of full
// resolveCapabilities runs. installationsCalls are recorded as a cross-check.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApiBroker } from "../dist/broker.js";
import { resolveCapabilities } from "../dist/resolution.js";
import { createExtensionRuntime } from "../dist/index.js";
import { createExtensionHost } from "@t3tools/extension-sdk/host";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = arg("out", path.join(here, "out"));
const SMOKE = args.includes("--smoke");
const ITERATIONS = SMOKE ? 2 : Number(arg("iterations", 12));
const EVENTS = SMOKE ? 8 : Number(arg("events", 50));
const SAMPLES = SMOKE ? 20 : 200;

const context = {
  resource: { namespace: "perf.resource", id: "view", environmentId: "env", projectId: "project" },
  client: "web",
};
const grant = "t3.workspace/read-text";

// ---- Scale fixture: 6 first-party-panel-sized host APIs + 8 plugin installations ----
const panelMethod = (name) => ({
  name,
  inputSchema: { type: "object" },
  outputSchema: {},
  effect: "read",
  requiredGrants: [grant],
});
const panelStream = (name) => ({
  name,
  inputSchema: { type: "object" },
  eventSchema: {},
  requiredGrants: [grant],
});
const panelApi = (name) => ({
  id: "t3." + name + "/api",
  version: "1.0.0",
  methods: ["list", "read", "watch", "resolve", "stat", "close"].map((n) =>
    panelMethod(n + name[0].toUpperCase() + name.slice(1)),
  ),
  streams: [panelStream("events" + name[0].toUpperCase() + name.slice(1))],
});
const HOST_NAMES = ["files", "terminal", "browser", "vcs", "diff", "agents"];
const HOST_APIS = HOST_NAMES.map(panelApi);

const hostProviders = HOST_APIS.map((definition, i) => ({
  providerId: "host." + HOST_NAMES[i],
  definition,
  invoke: () => ({ ok: true }),
  subscribe: async function* () {
    for (let i = 0; i < EVENTS; i++) yield { type: "data", value: { i } };
  },
}));

const pluginInstallation = (id, { provides = [], requires = [], dependencies = [] } = {}) => ({
  id,
  contentHash: id
    .padEnd(64, "0")
    .slice(0, 64)
    .replace(/[^a-f0-9]/g, "a"),
  enabled: true,
  grants: { capabilities: [grant], projectIds: ["project"] },
  package: {
    manifest: { id, apiVersion: 1, version: "1.0.0", surfaces: [] },
    serverEntry: "server.mjs",
    tools: [],
    provides,
    requires,
    dependencies,
  },
});

const pluginApi = (id) => ({
  id: id + "/api",
  version: "1.0.0",
  methods: [panelMethod("value")],
});

const installations = [
  pluginInstallation("perf.alpha", { provides: [pluginApi("perf.alpha")] }),
  pluginInstallation("perf.beta", { provides: [pluginApi("perf.beta")] }),
  pluginInstallation("perf.gamma", {
    provides: [pluginApi("perf.gamma")],
    requires: [{ id: "t3.files/api", versionRange: "^1" }],
  }),
  pluginInstallation("perf.delta", {
    dependencies: [
      {
        pluginId: "perf.alpha",
        versionRange: "^1",
        apis: [{ id: "perf.alpha/api", versionRange: "^1" }],
      },
    ],
  }),
  pluginInstallation("perf.epsilon", {
    requires: [
      { id: "t3.terminal/api", versionRange: "^1" },
      { id: "perf.beta/api", versionRange: "^1" },
    ],
  }),
  pluginInstallation("perf.zeta", { provides: [pluginApi("perf.zeta")] }),
  pluginInstallation("perf.eta", {
    dependencies: [{ pluginId: "perf.zeta", versionRange: "^1", apis: [] }],
    requires: [{ id: "t3.vcs/api", versionRange: "^1" }],
  }),
  pluginInstallation("perf.theta"),
];
const INSTALL_COUNT = installations.length;
const selections = [{ id: "t3.files/api", providerId: "host.files", fallbackProviderIds: [] }];

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    n: samples.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    mean: sum / samples.length,
  };
};
const now = () => performance.now();

function makeBroker(counters) {
  return createApiBroker({
    installations: () => {
      counters.installationsCalls++;
      return installations;
    },
    providers: hostProviders,
    selections: () => selections,
    authorize: () => true,
    environmentId: "env",
    timeoutMs: 5000,
    health: (id) => {
      counters.healthCalls++;
      return counters.health.get(id) ?? "ready";
    },
    invokeWorker: async () => ({ ok: true }),
    subscribeWorker: async function* () {
      for (let i = 0; i < EVENTS; i++) yield { type: "data", value: { i } };
    },
  });
}
const resolutions = (counters) => counters.healthCalls / INSTALL_COUNT;

// ---------- Scenario: direct resolveCapabilities ----------
function scenarioResolveDirect() {
  const input = {
    installations,
    providers: hostProviders,
    selections,
    pluginHealth: Object.fromEntries(installations.map((i) => [i.id, "ready"])),
  };
  for (let i = 0; i < 20; i++) resolveCapabilities(input);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = now();
    resolveCapabilities(input);
    samples.push(now() - t);
  }
  return { samples, counters: { providers: hostProviders.length, installations: INSTALL_COUNT } };
}

// ---------- Scenario: broker invoke of a host API ----------
async function scenarioInvoke() {
  const counters = { healthCalls: 0, installationsCalls: 0, health: new Map() };
  const broker = makeBroker(counters);
  const caller = installations.find((i) => i.id === "perf.gamma"); // requires t3.files/api
  const request = {
    id: "t3.files/api",
    versionRange: "^1",
    method: "listFiles",
    input: {},
    context,
  };
  // Warmup outside measurement.
  await broker.invoke(caller, request, new AbortController().signal);
  const samples = [];
  const resPerCall = [];
  for (let i = 0; i < SAMPLES; i++) {
    const before = counters.healthCalls;
    const t = now();
    await broker.invoke(caller, request, new AbortController().signal);
    samples.push(now() - t);
    resPerCall.push((counters.healthCalls - before) / INSTALL_COUNT);
  }
  return {
    samples,
    counters: {
      resolutionsPerInvoke: summarize(resPerCall),
      totalResolutions: resolutions(counters),
      totalInstallationsCalls: counters.installationsCalls,
    },
  };
}

// ---------- Scenario: broker stream, per pulled event ----------
async function scenarioStream() {
  const counters = { healthCalls: 0, installationsCalls: 0, health: new Map() };
  const broker = makeBroker(counters);
  const caller = installations.find((i) => i.id === "perf.gamma");
  const iterable = broker.subscribe(
    caller,
    {
      id: "t3.files/api",
      versionRange: "^1",
      name: "eventsFiles",
      input: {},
      context,
    },
    new AbortController().signal,
  );
  const it = iterable[Symbol.asyncIterator]();
  const samples = [];
  const resPerEvent = [];
  const t0 = now();
  const h0 = counters.healthCalls;
  const first = await it.next(); // admission + first event
  const admissionMs = now() - t0;
  const admissionResolutions = (counters.healthCalls - h0) / INSTALL_COUNT;
  if (first.done) throw new Error("stream ended early");
  for (let i = 1; i < EVENTS; i++) {
    const b = counters.healthCalls;
    const t = now();
    const r = await it.next();
    samples.push(now() - t);
    resPerEvent.push((counters.healthCalls - b) / INSTALL_COUNT);
    if (r.done) break;
  }
  await it.return?.();
  return {
    samples,
    counters: {
      events: resPerEvent.length,
      admissionMs,
      admissionResolutions,
      resolutionsPerEvent: summarize(resPerEvent),
      totalResolutions: resolutions(counters),
    },
  };
}

// ---------- Scenario: discovery on the real runtime ----------
const pkgJson = (id, provides = []) => ({
  format: 2,
  manifest: { id, apiVersion: 1, version: "1.0.0", surfaces: [] },
  serverEntry: "server.mjs",
  tools: [],
  provides,
  requires: [],
  dependencies: [],
});
const implFor = (pkg) =>
  "export default {tools:[],apis:[" +
  pkg.provides
    .map(
      (api) =>
        "{id:" +
        JSON.stringify(api.id) +
        ",methods:[{name:" +
        JSON.stringify(api.methods[0].name) +
        ",invoke:async()=>({ok:true})}]}",
    )
    .join(",") +
  "]};";

async function writeSource(dir, pkg, code) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "t3-extension.json"), JSON.stringify(pkg));
  await fs.writeFile(path.join(dir, "server.mjs"), code);
}

async function scenarioDiscovery({ slowProvider }) {
  const runs = [];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "t3-f5-discovery-"));
    const runtime = await createExtensionRuntime({
      rootDir: path.join(directory, "state"),
      environmentId: "env",
      services: [],
      authorize: () => true,
      timeoutMs: 2000,
    });
    try {
      // 4 fast worker plugins providing APIs, 1 host-less plugin, optionally 1 hung provider.
      const records = [];
      for (const id of ["d.one", "d.two", "d.three", "d.four"]) {
        const pkg = pkgJson("perf." + id, [pluginApi("perf." + id)]);
        const src = path.join(directory, "src-" + id);
        await writeSource(src, pkg, implFor(pkg));
        records.push(
          await runtime.install(src, { capabilities: [grant], projectIds: ["project"] }),
        );
      }
      if (slowProvider) {
        // Readies once (install handshake), then hangs on later starts so the
        // worker startup deadline (runtime timeoutMs) bounds discovery.
        const marker = path.join(directory, "slow-staged");
        const pkg = pkgJson("perf.d.slow", [pluginApi("perf.d.slow")]);
        const src = path.join(directory, "src-slow");
        await writeSource(
          src,
          pkg,
          'import fs from "node:fs";\n' +
            "if (fs.existsSync(" +
            JSON.stringify(marker) +
            ")) await new Promise(()=>{});\n" +
            "else fs.writeFileSync(" +
            JSON.stringify(marker) +
            ', "staged");\n' +
            implFor(pkg),
        );
        records.push(
          await runtime.install(src, { capabilities: [grant], projectIds: ["project"] }),
        );
      }
      const caller = records[0];
      const t = now();
      const discovery = await runtime.discoverApis(
        caller.id,
        caller.contentHash,
        context,
        new AbortController().signal,
      );
      const coldMs = now() - t;
      const t2 = now();
      await runtime.discoverApis(
        caller.id,
        caller.contentHash,
        context,
        new AbortController().signal,
      );
      const warmMs = now() - t2;
      runs.push({ coldMs, warmMs, discovered: discovery.length });
    } finally {
      await runtime.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  return {
    samples: runs.map((r) => r.coldMs),
    counters: {
      runs,
      warmMs: summarize(runs.map((r) => r.warmMs)),
      providersPerRun: slowProvider ? 5 : 4,
    },
  };
}

// ---------- Scenario: host-side createView open path ----------
async function scenarioCreateView() {
  const runs = [];
  const surfaceId = "perf.panel/view";
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const host = createExtensionHost({ authorize: () => true, timeoutMs: 5000 });
    host.register({
      manifest: {
        id: "perf.panel",
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: surfaceId,
            title: "Panel",
            placements: ["side-panel"],
            clients: ["web"],
            scope: "project",
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: surfaceId,
          validateRestore: () => true,
          createView: () => ({ renderer: () => null, dispose() {} }),
        },
      ],
    });
    const ready = new Promise((resolve, reject) => {
      host.subscribe((view) => {
        if (view?.status === "ready") resolve(view);
        if (view?.status === "error" || view?.status === "unavailable")
          reject(new Error(view.reason ?? "view failed"));
      });
    });
    const record = {
      version: 1,
      surfaceId,
      placement: "side-panel",
      stateVersion: 1,
      restoreState: null,
      fallback: "loading",
      context,
    };
    const t = now();
    const id = await host.open(record);
    await ready;
    const coldMs = now() - t;
    // warm open/close on the same registered host
    const warm = [];
    for (let i = 0; i < 10; i++) {
      const w = new Promise((resolve, reject) => {
        const un = host.subscribe((view) => {
          if (view?.status === "ready") {
            un();
            resolve(view);
          }
          if (view?.status === "error" || view?.status === "unavailable") {
            un();
            reject(new Error(view.reason ?? "view failed"));
          }
        });
      });
      const t2 = now();
      const vid = await host.open(record);
      await w;
      warm.push(now() - t2);
      host.close(vid);
    }
    runs.push({ coldMs, warm });
    host.dispose();
  }
  return {
    samples: runs.map((r) => r.coldMs),
    counters: { warmOpenMs: summarize(runs.flatMap((r) => r.warm)) },
  };
}

// ---------- Driver ----------
const meta = () => ({
  machine: "macbook-pro",
  node: process.version,
  platform: process.platform + " " + process.arch,
  sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: here }).toString().trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { cwd: here }).toString().trim(),
  startedAt: new Date().toISOString(),
  iterations: ITERATIONS,
  events: EVENTS,
  scale: { hostProviders: HOST_APIS.length, installations: INSTALL_COUNT },
});

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const results = {};
  const write = async (name, data) => {
    const payload = { scenario: name, ...meta(), ...data };
    results[name] = payload;
    await fs.writeFile(path.join(OUT, name + ".json"), JSON.stringify(payload, null, 2));
    console.log(
      name.padEnd(24),
      "p50=" + payload.summary.p50.toFixed(3) + "ms",
      "p95=" + payload.summary.p95.toFixed(3) + "ms",
      "max=" + payload.summary.max.toFixed(3) + "ms",
    );
  };

  {
    const r = scenarioResolveDirect();
    await write("resolve-direct", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  {
    const r = await scenarioInvoke();
    await write("broker-invoke", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  {
    const r = await scenarioStream();
    await write("broker-stream", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  {
    const r = await scenarioDiscovery({ slowProvider: false });
    await write("discovery-all-ready", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  {
    const r = await scenarioDiscovery({ slowProvider: true });
    await write("discovery-slow-provider", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  {
    const r = await scenarioCreateView();
    await write("createview-open", {
      summary: summarize(r.samples),
      samples: r.samples,
      counters: r.counters,
    });
  }
  await fs.writeFile(
    path.join(OUT, "index.json"),
    JSON.stringify({ ...meta(), scenarios: Object.keys(results) }, null, 2),
  );
  if (SMOKE) {
    for (const name of Object.keys(results))
      JSON.parse(await fs.readFile(path.join(OUT, name + ".json"), "utf8"));
    console.log("smoke: all outputs parse");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
