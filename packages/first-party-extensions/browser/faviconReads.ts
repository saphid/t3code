/**
 * The `getFavicon` read queue behind the Browser panel's captured tier. Views
 * request the refs their sessions carry; at most `maxInFlight` reads run at
 * once, and each finished read starts the next queued one, so demand never
 * waits for another session event. A ref is read once: a settled ref is not
 * read again even after the cache ages its result out, so a bounded cache can
 * never drive a re-read loop. A read cancelled with its view is not settled;
 * a later request (from any view) reads it again.
 */

/** Reads one ref: the image `data:` URL, or null when the server refused it. */
export type FaviconRead = (ref: string, signal: AbortSignal) => Promise<string | null>;

export type FaviconReadQueue = {
  /** Queue these refs for reading on behalf of the view that owns `signal`. */
  readonly request: (refs: readonly string[], read: FaviconRead, signal: AbortSignal) => void;
  readonly inFlight: () => number;
};

/** Settled refs remembered so they are never re-read; oldest forgotten past this. */
const SETTLED_REFS_MAX = 4096;

export function createFaviconReadQueue(options: {
  readonly maxInFlight: number;
  /** Records a read's result (null: refused or failed). */
  readonly settle: (ref: string, src: string | null) => void;
}): FaviconReadQueue {
  // Latest demand per ref, in request order; a newer request replaces a
  // cancelled one, including for a ref whose earlier read is still running.
  const queued = new Map<string, { read: FaviconRead; signal: AbortSignal }>();
  const running = new Set<string>();
  const settled = new Set<string>();

  const finish = (ref: string, src: string | null) => {
    settled.add(ref);
    if (settled.size > SETTLED_REFS_MAX) settled.delete(settled.values().next().value!);
    options.settle(ref, src);
  };

  const pump = () => {
    for (const [ref, demand] of queued) {
      if (running.size >= options.maxInFlight) return;
      if (demand.signal.aborted || settled.has(ref)) {
        queued.delete(ref);
        continue;
      }
      if (running.has(ref)) continue;
      queued.delete(ref);
      running.add(ref);
      demand
        .read(ref, demand.signal)
        .then(
          (src) => finish(ref, src),
          () => {
            if (!demand.signal.aborted) finish(ref, null);
          },
        )
        .finally(() => {
          running.delete(ref);
          pump();
        });
    }
  };

  return {
    request(refs, read, signal) {
      if (signal.aborted) return;
      for (const ref of refs) if (!settled.has(ref)) queued.set(ref, { read, signal });
      pump();
    },
    inFlight: () => running.size,
  };
}
