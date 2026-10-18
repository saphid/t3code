// @effect-diagnostics nodeBuiltinImport:off - Runs fake child scripts in a throwaway batch directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";

it.each(["healthy", "unresponsive"] as const)(
  "stops the queue after SIGTERM with %s telemetry",
  async (telemetry) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-perf-batch-stop-"));
    try {
      await NodeFSP.mkdir(NodePath.join(root, "src"));
      await NodeFSP.copyFile(
        NodeURL.fileURLToPath(new URL("./batchOrchestrator.ts", import.meta.url)),
        NodePath.join(root, "src/batchOrchestrator.ts"),
      );
      const invocations = NodePath.join(root, "invocations.jsonl");
      await NodeFSP.writeFile(
        NodePath.join(root, "src/cli.ts"),
        `import fs from "node:fs";
const version = process.argv[process.argv.indexOf("--label") + 1];
fs.appendFileSync(${JSON.stringify(invocations)}, JSON.stringify(version) + "\\n");
if (version === "1.0.0") {
  setInterval(() => {}, 1000);
  process.kill(process.ppid, "SIGTERM");
}
`,
      );
      await NodeFSP.writeFile(
        NodePath.join(root, "src/otlpBackfill.ts"),
        'throw new Error("must not export after cancellation");\n',
      );
      await NodeFSP.writeFile(
        NodePath.join(root, "fetch-stub.mjs"),
        telemetry === "healthy"
          ? "globalThis.fetch = async () => new Response(null, { status: 204 });\n"
          : `const timeout = AbortSignal.timeout;
AbortSignal.timeout = (milliseconds) => {
  if (milliseconds !== 5000) throw new Error("Expected a bounded telemetry request");
  return timeout(1);
};
globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
  const keepAlive = setInterval(() => {}, 1000);
  signal.addEventListener("abort", () => { clearInterval(keepAlive); reject(signal.reason); }, { once: true });
});
`,
      );
      for (const version of ["1.0.0", "2.0.0"]) {
        const dir = NodePath.join(root, "releases", version, "node_modules/t3/dist");
        await NodeFSP.mkdir(dir, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(dir, "bin.mjs"), "// Never executed.\n");
      }
      await NodeFSP.writeFile(
        NodePath.join(root, "versions.tsv"),
        "1.0.0\t2026-01-01T00:00:00Z\n2.0.0\t2026-01-02T00:00:00Z\n",
      );
      const child = NodeChildProcess.spawn(
        process.execPath,
        [
          "--import",
          NodePath.join(root, "fetch-stub.mjs"),
          NodePath.join(root, "src/batchOrchestrator.ts"),
          "--versions",
          NodePath.join(root, "versions.tsv"),
          "--releases",
          NodePath.join(root, "releases"),
          "--results",
          NodePath.join(root, "results"),
          "--otlp",
          "http://telemetry.invalid",
          "--loki",
          "http://telemetry.invalid",
        ],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, killSignal: "SIGKILL" },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(code, output).toBe(143);
      expect(output).toContain("STOPPED:");
      if (telemetry === "unresponsive") {
        expect(output).toContain("OTLP batch-metric push failed:");
        expect(output).toContain("Loki push failed:");
      }
      expect(
        (await NodeFSP.readFile(invocations, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(["1.0.0"]);
      expect(
        JSON.parse(
          await NodeFSP.readFile(NodePath.join(root, "results/orchestrator-state.json"), "utf8"),
        ),
      ).toEqual({});
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
