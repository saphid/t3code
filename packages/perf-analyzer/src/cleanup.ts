// @effect-diagnostics globalConsole:off - Shutdown owns only resources registered by this perf process.
/** Keep signal shutdown and ordinary teardown on the same idempotent path. */
export function createCleanupScope() {
  const cleanups: Array<() => Promise<void>> = [];
  const acquisitions = new Set<Promise<unknown>>();
  let closing: Promise<void> | null = null;
  let stopExitCode: number | null = null;
  const close = () => {
    closing ??= (async () => {
      // A browser can still be starting when the signal arrives. Wait for
      // its handle so it is registered and closed before removing its home.
      await Promise.allSettled(acquisitions);
      for (const cleanup of cleanups.toReversed()) {
        await cleanup().catch(() => undefined);
      }
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      if (stopExitCode !== null) process.exit(stopExitCode);
    })();
    return closing;
  };
  const stop = (exitCode: number) => {
    stopExitCode ??= exitCode;
    void close();
  };
  const onInterrupt = () => stop(130);
  const onTerminate = () => stop(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  const acquire = async <T>(create: () => Promise<T>, cleanup: (resource: T) => Promise<void>) => {
    if (closing !== null) throw new Error("Perf environment is closing.");
    const acquisition = Promise.resolve()
      .then(create)
      .then((resource) => {
        cleanups.push(() => cleanup(resource));
        return resource;
      });
    acquisitions.add(acquisition);
    try {
      const resource = await acquisition;
      if (closing !== null) {
        await close();
        throw new Error("Perf environment is closing.");
      }
      return resource;
    } finally {
      acquisitions.delete(acquisition);
    }
  };
  return { cleanups, close, acquire };
}
