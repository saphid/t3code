import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analyze.mjs";
import { digest, fixture, schedule, METRICS, JOURNEYS } from "./protocol.mjs";

function valid() {
  const seed = 20260909;
  const environment = { host: "isolated-test", hardware: "cpu", node: "v24", os: "linux" };
  const builds = { baseline: "a".repeat(40), candidate: "b".repeat(40) };
  const fixtureHash = digest(fixture(seed));
  return { schema: 2, complete: true, seed, fixtureHash, builds, environment,
    harnessSha: "c".repeat(40), adapterHash: "d".repeat(64),
    samples: schedule(seed).map((item) => ({
      ...item, status: "passed", exitCode: 0, fixtureHash,
      servedBuildSha: item.group === "candidate" ? builds.candidate : builds.baseline,
      environmentHash: digest(environment), clientVersion: "test-only-1", realClient: item.client,
      ...(item.phase === "timing" ? {
        metrics: Object.fromEntries(Object.keys(METRICS).map((name) => [name, 100])),
      } : {
      checks: JOURNEYS.find((j) => j.id === item.journey).checks.map((id) => ({
        id, passed: true, evidence: "Synthetic analyzer unit test; never UI proof",
      })),
      soak: { cycles: 100, eventCount: 10000, durationMs: 1000, lostEvents: 0,
        unrelatedSessionAlive: true, faults: fixture(seed).faults,
        before: { listeners: 2, handles: 3, resources: 1 }, after: { listeners: 2, handles: 3, resources: 1 } },
      }),
    })),
  };
}
const edit = (run, group, metric, value, batches = [0, 1, 2]) => {
  for (const sample of run.samples)
    if (sample.phase === "timing" && sample.group === group && batches.includes(sample.batch)) sample.metrics[metric] = value;
};
test("equal complete synthetic data passes the analyzer only", () => {
  const result = analyze(valid());
  assert.equal(result.status, "passed");
  assert.equal(result.comparisons.length, 60);
});
test("reproducible latency regression fails and reports raw batch statistics", () => {
  const run = valid(); edit(run, "candidate", "openMs", 120);
  const result = analyze(run);
  assert.equal(result.status, "failed");
  const row = result.comparisons.find((r) => r.metric === "openMs");
  assert.equal(row.status, "regressed");
  assert.equal(row.batches[0].groups.candidate.p95, 120);
  assert.equal(row.batches[0].investigation, true);
});
test("material 6 percent regression cannot hide below the 10 percent investigation threshold", () => {
  const run = valid(); edit(run, "candidate", "rssBytes", 106);
  assert.equal(analyze(run).status, "failed");
});
test("throughput has the opposite direction", () => {
  const run = valid(); edit(run, "candidate", "throughput", 80);
  assert.equal(analyze(run).status, "failed");
  edit(run, "candidate", "throughput", 120);
  assert.equal(analyze(run).status, "passed");
});
test("baseline noise and a single bad batch are inconclusive, never passed", () => {
  for (const [group, batches] of [["calibrationB", [0, 1, 2]], ["candidate", [1]]]) {
    const run = valid(); edit(run, group, "openMs", 140, batches);
    const result = analyze(run);
    assert.equal(result.status, "failed");
    assert.ok(result.comparisons.some((r) => r.status === "inconclusive"));
  }
});
test("missing, extra, duplicate and reordered samples fail closed", () => {
  for (const mutate of [
    (r) => r.samples.pop(), (r) => r.samples.push(r.samples[0]),
    (r) => { r.samples[1] = r.samples[0]; },
    (r) => { [r.samples[0], r.samples[1]] = [r.samples[1], r.samples[0]]; },
  ]) { const run = valid(); mutate(run); assert.equal(analyze(run).status, "failed"); }
});
test("identity, missing coverage, failures and leaked resources cannot false-pass", () => {
  for (const mutate of [
    (r) => { r.fixtureHash = "wrong"; },
    (r) => { r.builds.candidate = r.builds.baseline; },
    (r) => { r.samples[0].servedBuildSha = "e".repeat(40); },
    (r) => { r.samples[0].environmentHash = "other"; },
    (r) => { r.samples[0].fixtureHash = "other"; },
    (r) => { r.samples[0].checks.pop(); },
    (r) => { r.samples[0].checks[0].passed = false; },
    (r) => { r.samples.find((s) => s.phase === "timing").metrics.openMs = NaN; },
    (r) => { delete r.samples.find((s) => s.phase === "timing").metrics.handles; },
    (r) => { r.samples[0].status = "failed"; },
    (r) => { r.samples[0].exitCode = null; },
    (r) => { r.samples[0].soak.after.resources++; },
    (r) => { r.samples[0].soak.lostEvents = 1; },
    (r) => { r.samples[0].soak.faults.pop(); },
    (r) => { r.samples[0].realClient = "jsdom"; },
    (r) => { r.samples[0].clientVersion = "other-version"; },
    (r) => { r.complete = false; },
  ]) { const run = valid(); mutate(run); assert.equal(analyze(run).status, "failed"); }
});
test("empty and malformed inputs never pass", () => {
  for (const run of [undefined, null, {}, { samples: [] }]) assert.equal(analyze(run).status, "failed");
});
test("fixture and interleaving are reproducible but seed-sensitive", () => {
  assert.deepEqual(schedule(7), schedule(7));
  assert.notDeepEqual(schedule(7), schedule(8));
  assert.equal(digest(fixture(7)), digest(fixture(7)));
  assert.notEqual(digest(fixture(7)), digest(fixture(8)));
  const timings = schedule(7).filter((r) => r.phase === "timing");
  for (let offset = 0; offset < timings.length; offset += 4) {
    assert.equal(new Set(timings.slice(offset, offset + 4).map((r) => r.group)).size, 4);
  }
});

test("material degradation obscured by calibration noise is inconclusive", () => {
  const run = valid();
  edit(run, "calibrationB", "rssBytes", 104);
  edit(run, "candidate", "rssBytes", 107);
  const result = analyze(run);
  assert.equal(result.status, "failed");
  assert.ok(result.comparisons.some((r) => r.metric === "rssBytes" && r.status === "inconclusive"));
});

test("conformance runs once per target and journey per batch, independently of timing", () => {
  const run = valid();
  const conformance = run.samples.filter((s) => s.phase === "conformance");
  const timing = run.samples.filter((s) => s.phase === "timing");
  assert.equal(conformance.length, 36);
  assert.equal(timing.length, 936);
  assert.ok(conformance.every((s) => !s.metrics && !s.warmup));
  assert.ok(timing.every((s) => !s.soak && !s.checks));
  assert.equal(conformance.reduce((n, s) => n + s.soak.cycles, 0), 3600);
  for (const sample of timing) {
    const evidence = conformance.find((s) => s.id === sample.conformanceId);
    assert.equal(evidence.group, sample.group === "candidate" ? "candidate" : "baseline");
    assert.equal(evidence.batch, sample.batch);
    assert.equal(evidence.journey, sample.journey);
    assert.ok(evidence.id < sample.id);
  }
  assert.equal(analyze(run).status, "passed");
});
test("missing conformance and broken links fail even with complete healthy timing data", () => {
  for (const mutate of [
    (r, s) => { r.samples = r.samples.filter((row) => row.id !== s.conformanceId); },
    (_, s) => { delete s.conformanceId; },
    (_, s) => { s.conformanceId = -1; },
    (r, s) => { s.conformanceId = r.samples.find((row) => row.phase === "conformance" && row.group === "candidate").id; },
    (r, s) => { s.conformanceId = r.samples.find((row) => row.phase === "conformance" && row.batch === 1).id; },
    (r, s) => { s.conformanceId = r.samples.find((row) => row.phase === "conformance" && row.journey === "diff").id; },
    (r, s) => { r.samples.find((row) => row.id === s.conformanceId).fixtureHash = "wrong"; },
    (r, s) => { r.samples.find((row) => row.id === s.conformanceId).servedBuildSha = r.builds.candidate; },
    (r, s) => { r.samples.find((row) => row.id === s.conformanceId).environmentHash = "wrong"; },
    (r, s) => { r.samples.find((row) => row.id === s.conformanceId).checks = []; },
    (r, s) => { r.samples.find((row) => row.id === s.conformanceId).soak = undefined; },
  ]) {
    const run = valid();
    mutate(run, run.samples.find((s) => s.phase === "timing" && s.group === "baseline"));
    assert.equal(analyze(run).status, "failed");
  }
});
