/** React Native's AbortSignal polyfill has neither throwIfAborted nor static any. */
export function checkMobileUiAbort(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Mobile UI request cancelled");
}

export async function withMobileUiSignal<A>(
  signals: readonly AbortSignal[],
  run: (signal: AbortSignal) => Promise<A>,
): Promise<A> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }
  try {
    checkMobileUiAbort(controller.signal);
    return await run(controller.signal);
  } finally {
    for (const signal of signals) signal.removeEventListener("abort", abort);
  }
}
