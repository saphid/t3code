// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Owns the server child started by the isolated perf launcher.
import type * as NodeChildProcess from "node:child_process";

/** Stop an unready server before its caller removes the throwaway home. */
export function waitForServerPairingUrl(child: NodeChildProcess.ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.removeListener("data", scan);
      child.stderr?.removeListener("data", scan);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const fail = (error: Error) => {
      cleanup();
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.once("close", () => reject(error));
        child.kill("SIGKILL");
      } else {
        reject(error);
      }
    };
    const scan = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /pairingUrl[=:"\s]+"?(https?:\/\/\S+?)["\s]/.exec(output);
      if (match?.[1] !== undefined) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = (code: number | null) => {
      fail(
        new Error(
          `Server exited with code ${code} before printing a pairing URL:\n${output.slice(-4000)}`,
        ),
      );
    };
    const onError = (error: Error) => fail(error);
    const timer = setTimeout(() => {
      fail(
        new Error(
          `Server did not print a pairing URL within 60s. Output so far:\n${output.slice(-4000)}`,
        ),
      );
    }, 60_000);
    timer.unref();
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

/** Reap only the direct child captured when this harness started its server. */
export async function stopServer(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 500);
    force.unref();
    child.once("close", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
