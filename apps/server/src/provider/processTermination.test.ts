import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";

import {
  processTerminationFromExit,
  processTerminationFromNodeExit,
  processTerminationLabel,
} from "./processTermination.ts";

describe("provider process termination", () => {
  it("preserves typed exit codes and signals", () => {
    expect(processTerminationFromNodeExit(null, "SIGKILL")).toEqual({
      kind: "signal",
      signal: "SIGKILL",
    });
    expect(processTerminationFromNodeExit(137, null)).toEqual({
      kind: "exit-code",
      exitCode: 137,
    });
    expect(processTerminationFromExit(Exit.succeed(0))).toEqual({
      kind: "exit-code",
      exitCode: 0,
    });
  });

  it("extracts only allow-listed Effect process signals", () => {
    const signal = processTerminationFromExit(
      Exit.fail("Process interrupted due to receipt of signal: 'SIGTERM'"),
    );
    expect(signal).toEqual({ kind: "signal", signal: "SIGTERM" });
    expect(processTerminationLabel(signal)).toBe("SIGTERM");
  });

  it("does not persist arbitrary process error text", () => {
    const secret = "token-super-secret";
    const termination = processTerminationFromExit(Exit.fail(`provider failed with ${secret}`));
    expect(termination).toEqual({ kind: "unknown" });
    expect(JSON.stringify(termination)).not.toContain(secret);
  });
});
