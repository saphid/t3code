/** React Native's AbortSignal polyfill has neither throwIfAborted nor static any. */
export function checkMobileUiAbort(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Mobile UI request cancelled");
}

/** Combines native lifetimes and releases their listeners when the operation ends. */
export function mobileUiLifetime(signals: readonly AbortSignal[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  };
}

export async function withMobileUiSignal<A>(
  signals: readonly AbortSignal[],
  run: (signal: AbortSignal) => Promise<A>,
): Promise<A> {
  const lifetime = mobileUiLifetime(signals);
  try {
    checkMobileUiAbort(lifetime.signal);
    return await run(lifetime.signal);
  } finally {
    lifetime.dispose();
  }
}
