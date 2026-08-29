import { ProviderProcessSignal, type ProviderProcessTermination } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const isProviderProcessSignal = Schema.is(ProviderProcessSignal);
const SIGNAL_MESSAGE = /receipt of signal:\s*'([A-Z0-9]+)'/;

function signalFromUnknown(cause: unknown): ProviderProcessTermination | undefined {
  const message = cause instanceof Error ? cause.message : String(cause);
  const signal = SIGNAL_MESSAGE.exec(message)?.[1];
  return isProviderProcessSignal(signal) ? { kind: "signal", signal } : undefined;
}

export function processTerminationFromNodeExit(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): ProviderProcessTermination {
  if (signal !== null && isProviderProcessSignal(signal)) {
    return { kind: "signal", signal };
  }
  return exitCode !== null ? { kind: "exit-code", exitCode } : { kind: "unknown" };
}

export function processTerminationFromExit(
  exit: Exit.Exit<number, unknown>,
): ProviderProcessTermination {
  if (Exit.isSuccess(exit)) {
    return { kind: "exit-code", exitCode: Number(exit.value) };
  }
  return signalFromUnknown(Cause.squash(exit.cause)) ?? { kind: "unknown" };
}

export function processTerminationLabel(termination: ProviderProcessTermination): string {
  switch (termination.kind) {
    case "exit-code":
      return `exit code ${termination.exitCode}`;
    case "signal":
      return termination.signal;
    case "unknown":
      return "unknown cause";
  }
}
