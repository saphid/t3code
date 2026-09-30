import {
  prsReadApi,
  prsWriteApi,
  type PrsDetail,
  type PrsFilesViewedResult,
  type PrsRef,
  type PrsWriteOperationsSupport,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  prsFileViewed,
  prsFileViewedStates,
  prsRefKey,
  prsRevertViewedOverlay,
  prsSettleViewedOverlay,
  prsViewedFilesEnabled,
} from "./prsViewModel.js";

export function usePrsFilesViewed(
  host: ClientHost,
  session: ViewSession,
  reference: PrsRef | null,
  detail: PrsDetail | null,
  operations: PrsWriteOperationsSupport | null,
  onFailure: () => void,
) {
  const enabled = prsViewedFilesEnabled(detail?.capabilities.viewedFiles, operations);
  const scopeKey = reference === null ? "" : prsRefKey(reference);
  const scope = useMemo(
    () => ({
      queued: new Map<string, boolean>(),
      sentBy: new Map<string, number>(),
      answeredFrom: new Map<string, ReturnType<typeof prsFileViewedStates>>(),
      request: 0,
      read: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
      disposed: false,
    }),
    [host, session, scopeKey],
  );
  const [read, setRead] = useState<{
    scope: typeof scope;
    result: PrsFilesViewedResult | null;
    error: string | null;
  } | null>(null);
  const [pressed, setPressed] = useState<{
    scope: typeof scope;
    overlay: ReadonlyMap<string, boolean>;
  } | null>(null);
  const [failure, setFailure] = useState<{ scope: typeof scope; detail: string } | null>(null);
  const result = read?.scope === scope ? read.result : (detail?.filesViewed ?? null);
  const states = useMemo(() => prsFileViewedStates(result), [result]);
  const overlay = pressed?.scope === scope ? pressed.overlay : new Map<string, boolean>();
  const latest = useRef({ states, onFailure });
  latest.current = { states, onFailure };
  const changeOverlay = (
    change: (current: ReadonlyMap<string, boolean>) => ReadonlyMap<string, boolean>,
  ) =>
    setPressed((current) => ({
      scope,
      overlay: change(current?.scope === scope ? current.overlay : new Map()),
    }));

  const acceptRead = (next: PrsDetail) =>
    setRead((current) => ({
      scope,
      result: next.filesViewed ?? (current?.scope === scope ? current.result : null),
      error: next.filesViewedError ?? null,
    }));
  useEffect(() => {
    scope.read += 1;
    if (detail !== null) acceptRead(detail);
  }, [scope, detail?.filesViewed, detail?.filesViewedError]);

  useEffect(() => {
    const pending = new Set([...scope.queued.keys(), ...scope.sentBy.keys()]);
    const answered = new Set<string>();
    for (const [path, from] of scope.answeredFrom) {
      if (!pending.has(path) && from !== states) {
        answered.add(path);
        scope.answeredFrom.delete(path);
      }
    }
    changeOverlay((current) => prsSettleViewedOverlay(current, states, pending, answered));
  }, [scope, states]);

  const flush = () => {
    scope.timer = null;
    if (reference === null || scope.queued.size === 0 || session.signal.aborted) return;
    const files = [...scope.queued].map(([path, viewed]) => ({ path, viewed }));
    scope.queued.clear();
    const request = ++scope.request;
    for (const file of files) scope.sentBy.set(file.path, request);
    void bindApi(prsWriteApi, host, session.context, "^1.1.0")
      .invoke("setFilesViewed", { ...reference, files }, session.signal)
      .then(
        () => {
          if (scope.disposed || session.signal.aborted) return;
          for (const file of files) {
            if (scope.sentBy.get(file.path) !== request) continue;
            scope.sentBy.delete(file.path);
            if (!scope.queued.has(file.path))
              scope.answeredFrom.set(file.path, latest.current.states);
          }
          const readRequest = ++scope.read;
          void bindApi(prsReadApi, host, session.context)
            .invoke("detail", reference, session.signal)
            .then(
              (next) => {
                if (!scope.disposed && !session.signal.aborted && scope.read === readRequest)
                  acceptRead(next);
              },
              (error: unknown) => {
                if (!scope.disposed && !session.signal.aborted && scope.read === readRequest)
                  setRead((current) => ({
                    scope,
                    result: current?.scope === scope ? current.result : result,
                    error: error instanceof Error ? error.message : "Your ticks could not be read",
                  }));
              },
            );
        },
        (error: unknown) => {
          if (scope.disposed || session.signal.aborted) return;
          const owned = new Set<string>();
          for (const file of files) {
            if (scope.sentBy.get(file.path) !== request) continue;
            scope.sentBy.delete(file.path);
            if (!scope.queued.has(file.path)) owned.add(file.path);
          }
          if (owned.size === 0) return;
          changeOverlay((current) => prsRevertViewedOverlay(current, owned));
          setFailure({
            scope,
            detail: error instanceof Error ? error.message : "Could not update viewed files",
          });
          latest.current.onFailure();
        },
      );
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    scope.disposed = false;
    return () => {
      if (scope.timer !== null) {
        clearTimeout(scope.timer);
        flush();
      }
      scope.disposed = true;
    };
  }, [scope]);

  return {
    enabled,
    file: (path: string) => prsFileViewed(path, states, overlay),
    setViewed: (path: string, viewed: boolean) => {
      if (!enabled) return;
      changeOverlay((current) => new Map(current).set(path, viewed));
      setFailure(null);
      scope.queued.set(path, viewed);
      if (scope.timer !== null) clearTimeout(scope.timer);
      scope.timer = setTimeout(() => flushRef.current(), 400);
    },
    truncated: result?.truncated === true,
    error: read?.scope === scope ? read.error : (detail?.filesViewedError ?? null),
    failure: failure?.scope === scope ? failure.detail : null,
  };
}
