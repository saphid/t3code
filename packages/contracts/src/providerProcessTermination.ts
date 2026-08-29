import * as Schema from "effect/Schema";

export const ProviderProcessSignal = Schema.Literals([
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGBREAK",
  "SIGCHLD",
  "SIGCONT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINFO",
  "SIGINT",
  "SIGIO",
  "SIGIOT",
  "SIGKILL",
  "SIGLOST",
  "SIGPIPE",
  "SIGPOLL",
  "SIGPROF",
  "SIGPWR",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTKFLT",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGUNUSED",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGWINCH",
  "SIGXCPU",
  "SIGXFSZ",
]);
export type ProviderProcessSignal = typeof ProviderProcessSignal.Type;

export const ProviderProcessTermination = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("exit-code"),
    exitCode: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("signal"),
    signal: ProviderProcessSignal,
  }),
  Schema.Struct({
    kind: Schema.Literal("unknown"),
  }),
]);
export type ProviderProcessTermination = typeof ProviderProcessTermination.Type;

export const ProviderProcessTerminationAttribution = Schema.Literals([
  "unknown",
  "t3-runtime",
  "user",
]);
export type ProviderProcessTerminationAttribution =
  typeof ProviderProcessTerminationAttribution.Type;
