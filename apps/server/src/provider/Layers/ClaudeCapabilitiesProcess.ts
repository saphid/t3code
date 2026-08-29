// @effect-diagnostics nodeBuiltinImport:off - The Claude SDK custom spawn hook requires Node process handles and streams.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import type {
  SpawnedProcess as ClaudeSpawnedProcess,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

const TASKKILL_TIMEOUT_MS = 2_000;

type ProcessHandle = NodeChildProcess.ChildProcess;

export interface ClaudeCapabilitiesProcessDependencies {
  readonly spawnClaude: (options: ClaudeSpawnOptions) => ProcessHandle;
  readonly spawnTaskkill: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly environment: NodeJS.ProcessEnv;
  }) => ProcessHandle;
}

interface OwnedProcess {
  readonly child: ProcessHandle;
  readonly environment: NodeJS.ProcessEnv;
  reapPromise: Promise<void> | undefined;
}

export interface ClaudeCapabilitiesProcessController {
  readonly spawn: (options: ClaudeSpawnOptions) => ClaudeSpawnedProcess;
  readonly reap: () => Promise<void>;
}

const defaultDependencies: ClaudeCapabilitiesProcessDependencies = {
  spawnClaude: (options) =>
    NodeChildProcess.spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "ignore"],
      // The caller-owned controller starts exact tree cleanup immediately.
      // Passing the SDK's delayed forwarded signal would kill only the root.
      windowsHide: true,
    }),
  spawnTaskkill: ({ command, args, environment }) =>
    NodeChildProcess.spawn(command, [...args], {
      env: environment,
      stdio: "ignore",
      timeout: TASKKILL_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    }),
};

function taskkillCommand(environment: NodeJS.ProcessEnv): string {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  return systemRoot ? NodePath.win32.join(systemRoot, "System32", "taskkill.exe") : "taskkill.exe";
}

function waitForProcess(process: ProcessHandle): Promise<number | null> {
  if (process.exitCode !== null) {
    return Promise.resolve(process.exitCode);
  }

  return new Promise((resolve) => {
    const onExit = (code: number | null) => {
      process.off("error", onError);
      resolve(code);
    };
    const onError = () => {
      process.off("exit", onExit);
      resolve(null);
    };
    process.once("exit", onExit);
    process.once("error", onError);
  });
}

function asClaudeSpawnedProcess(
  owned: OwnedProcess,
  startReap: (owned: OwnedProcess) => Promise<void>,
): ClaudeSpawnedProcess {
  const { child } = owned;
  if (!child.stdin || !child.stdout) {
    child.kill("SIGKILL");
    throw new Error("Claude capability probe requires piped stdin and stdout.");
  }

  return {
    stdin: child.stdin,
    stdout: child.stdout,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    kill: (_signal) => {
      void startReap(owned);
      return true;
    },
    on: child.on.bind(child),
    once: child.once.bind(child),
    off: child.off.bind(child),
  };
}

/**
 * Own the Windows subprocess created by one Claude capability refresh.
 *
 * `taskkill /T` is bounded to the exact PID returned by `spawn`. Keeping the
 * root handle lets cancellation reap Claude's `cmd`, `tasklist`, and `findstr`
 * descendants without searching for, or touching, unrelated processes.
 */
export function makeClaudeCapabilitiesProcessController(input: {
  readonly abortController: AbortController;
  readonly dependencies?: ClaudeCapabilitiesProcessDependencies;
}): ClaudeCapabilitiesProcessController {
  const dependencies = input.dependencies ?? defaultDependencies;
  const ownedProcesses: Array<OwnedProcess> = [];

  const startReap = (owned: OwnedProcess): Promise<void> => {
    if (owned.reapPromise) {
      return owned.reapPromise;
    }

    owned.reapPromise = (async () => {
      const pid = owned.child.pid;
      if (pid === undefined || owned.child.exitCode !== null) {
        return;
      }

      let taskkillExitCode: number | null = null;
      try {
        const taskkill = dependencies.spawnTaskkill({
          command: taskkillCommand(owned.environment),
          args: ["/PID", String(pid), "/T", "/F"],
          environment: owned.environment,
        });
        taskkillExitCode = await waitForProcess(taskkill);
      } catch {
        // Fall through to the exact root handle. Probe-only IDE discovery is
        // disabled separately, so a missing taskkill utility cannot leave the
        // known tasklist/findstr branch behind.
      }

      if (taskkillExitCode !== 0 && owned.child.exitCode === null && !owned.child.killed) {
        owned.child.kill("SIGKILL");
      }
    })();

    return owned.reapPromise;
  };

  const reap = async () => {
    await Promise.all(ownedProcesses.map(startReap));
  };

  input.abortController.signal.addEventListener(
    "abort",
    () => {
      void reap();
    },
    { once: true },
  );

  return {
    spawn: (options) => {
      const owned: OwnedProcess = {
        child: dependencies.spawnClaude(options),
        environment: options.env,
        reapPromise: undefined,
      };
      ownedProcesses.push(owned);
      return asClaudeSpawnedProcess(owned, startReap);
    },
    reap,
  };
}
