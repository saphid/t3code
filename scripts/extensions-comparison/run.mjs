import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import { analyze } from "./analyze.mjs";
import { digest, fixture, schedule, JOURNEYS } from "./protocol.mjs";

const LOCK = "/home/saphid/artifacts/t3-extensions-20260909/heavy-check.lock";
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath || !outputPath) throw new Error("Usage: node run.mjs plan.json NEW_OUTPUT_DIRECTORY");
if (process.env.T3_COMPARISON_LOCKED !== "1") {
  const result = NodeChildProcess.spawnSync(
    "flock",
    [
      "--exclusive",
      "--nonblock",
      LOCK,
      process.execPath,
      NodeURL.fileURLToPath(import.meta.url),
      planPath,
      outputPath,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "true",
        NODE_OPTIONS: "--max-old-space-size=4096",
        T3_COMPARISON_LOCKED: "1",
      },
    },
  );
  process.exit(result.status ?? 1);
}
const output = NodePath.resolve(outputPath);
if (NodeFS.existsSync(output))
  throw new Error("Output directory exists; never overwrite prior attempts");
NodeFS.mkdirSync(output, { recursive: true });
const run = { schema: 2, complete: false, samples: [], startedAt: new Date().toISOString() };
const persist = () =>
  NodeFS.writeFileSync(NodePath.resolve(output, "run.json"), JSON.stringify(run, null, 2) + "\n");
try {
  const plan = JSON.parse(NodeFS.readFileSync(planPath, "utf8"));
  if (
    !Number.isInteger(plan.seed) ||
    !Array.isArray(plan.adapterCommand) ||
    !plan.adapterCommand.length ||
    plan.adapterCommand.some((s) => typeof s !== "string") ||
    !Number.isInteger(plan.timeoutMs) ||
    plan.timeoutMs < 1 ||
    plan.timeoutMs > 600000
  )
    throw new Error("Invalid seed/adapterCommand/timeoutMs");
  // The driver is explicit executable code; recording its hash makes later review possible.
  const adapterSource = NodeFS.readFileSync(plan.adapterSource);
  run.adapterHash = NodeCrypto.createHash("sha256").update(adapterSource).digest("hex");
  run.command = plan.adapterCommand;
  run.seed = plan.seed;
  run.builds = {};
  for (const variant of ["baseline", "candidate"]) {
    const target = plan.targets?.[variant];
    if (
      !target?.worktree ||
      !/^[a-f0-9]{40}$/.test(target.sha) ||
      !target.webUrl ||
      !target.electronCdpUrl ||
      !target.disposableState
    )
      throw new Error(
        `Incomplete ${variant} target (URL, CDP endpoint and disposable state required)`,
      );
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", ["-C", target.worktree, ...args], {
        encoding: "utf8",
      }).trim();
    if (
      git("rev-parse", "HEAD") !== target.sha ||
      git("status", "--porcelain", "--untracked-files=normal")
    )
      throw new Error(`${variant} must be a clean exact-SHA worktree`);
    run.builds[variant] = target.sha;
  }
  if (run.builds.baseline === run.builds.candidate)
    throw new Error("Candidate must differ from baseline");
  run.harnessSha = NodeChildProcess.execFileSync(
    "git",
    ["-C", NodeURL.fileURLToPath(new URL(".", import.meta.url)), "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  run.environment = {
    host: NodeOS.hostname(),
    hardware: digest({
      cpu: NodeOS.cpus().map((c) => c.model),
      totalmem: NodeOS.totalmem(),
      // Standalone measurement CLI records actual host architecture; no Effect runtime.
      // oxlint-disable-next-line t3code/no-global-process-runtime
      arch: NodeOS.arch(),
    }),
    node: process.version,
    os: NodeOS.release(),
  };
  const data = fixture(plan.seed);
  run.fixtureHash = digest(data);
  NodeFS.writeFileSync(NodePath.resolve(output, "fixture.json"), JSON.stringify(data) + "\n");
  persist();
  for (const item of schedule(plan.seed)) {
    const variant = item.group === "candidate" ? "candidate" : "baseline";
    const request = {
      ...item,
      target: plan.targets[variant],
      fixture: data,
      fixtureHash: run.fixtureHash,
      environmentHash: digest(run.environment),
      journey: JOURNEYS.find((j) => j.id === item.journey),
    };
    const result = NodeChildProcess.spawnSync(
      plan.adapterCommand[0],
      plan.adapterCommand.slice(1),
      {
        input: JSON.stringify(request),
        encoding: "utf8",
        timeout: plan.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, CI: "true", NODE_OPTIONS: "--max-old-space-size=4096" },
      },
    );
    NodeFS.writeFileSync(NodePath.resolve(output, `${item.id}.stdout.log`), result.stdout ?? "");
    NodeFS.writeFileSync(NodePath.resolve(output, `${item.id}.stderr.log`), result.stderr ?? "");
    let observation;
    try {
      observation = JSON.parse(result.stdout);
    } catch {
      observation = { status: "failed", error: "Driver returned invalid/missing JSON" };
    }
    // Schedule and process status are runner-owned; drivers cannot rewrite either.
    run.samples.push({
      ...observation,
      ...item,
      ...(item.phase === "timing" ? { conformanceId: observation.conformanceId } : {}),
      exitCode: result.status,
      processSignal: result.signal,
      processError: result.error?.message,
    });
    persist();
    if (result.status !== 0 || observation.status !== "passed") {
      run.abortReason = `Attempt ${item.id} failed; remaining coverage is incomplete`;
      break;
    }
  }
  run.complete = run.samples.length === schedule(plan.seed).length;
} catch (error) {
  run.abortReason = String(error);
} finally {
  run.finishedAt = new Date().toISOString();
  persist();
  const analysis = analyze(run);
  NodeFS.writeFileSync(
    NodePath.resolve(output, "analysis.json"),
    JSON.stringify(analysis, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({ output, status: analysis.status, reason: run.abortReason }) + "\n",
  );
  process.exitCode = analysis.status === "passed" ? 0 : 1;
}
