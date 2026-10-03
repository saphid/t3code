// Misbehaves on request so PluginSupervisor.test.ts can exercise each failure path.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const IPC_FD = 3;

let holdDeactivate = false;
let log;

export function activate(context) {
  NodeFS.writeFileSync(NodePath.join(process.cwd(), "activated.marker"), String(process.pid));
  log = context.log;
  const handle = context.proposed.handle;
  handle("ping", (input) => ({ pid: process.pid, input }));
  // The next deactivation never finishes, so only a kill stops this process.
  handle("holdDeactivate", () => {
    holdDeactivate = true;
    return null;
  });
  handle("throws", () => {
    throw new Error("nope");
  });
  handle("spin", () => {
    for (;;) {}
  });
  handle(
    "cooperative",
    (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      }),
  );
  // Ignores cancellation and answers anyway, after the server stopped waiting.
  handle(
    "late",
    (_input, { signal }) =>
      new Promise((resolve) => {
        context.log.info("late-started");
        signal.addEventListener("abort", () => resolve("late value"));
      }),
  );
  handle("exit", () => process.exit(3));
  handle("oom", () => {
    const hog = [];
    for (;;) hog.push(Array.from({ length: 100_000 }, Math.random));
  });
  handle("bigResult", (input) => "x".repeat(input.bytes));
  handle("malformed", () => {
    NodeFS.writeSync(IPC_FD, "{not json}\n");
    return new Promise(() => {});
  });
  // fd 3 is non-blocking: keep writing one unterminated line until the server kills us.
  handle("oversizedFrame", (input) => {
    const data = Buffer.alloc(input.bytes, "x");
    for (let offset = 0; offset < data.length;) {
      try {
        offset += NodeFS.writeSync(IPC_FD, data, offset);
      } catch (error) {
        if (error.code !== "EAGAIN") throw error;
      }
    }
    return new Promise(() => {});
  });
}

export function deactivate() {
  if (!holdDeactivate) return;
  log.info("deactivate-held");
  return new Promise(() => {});
}
