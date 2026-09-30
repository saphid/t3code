import { bindApi } from "@t3tools/extension-sdk/capabilities";
import { uiPanelsApi } from "@t3tools/extension-sdk/catalogue";
import { Tooltip } from "@t3tools/extension-sdk/authoring";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CaptureSessionRef } from "./capture.js";

export async function readBrowserMiniPlayer(
  host: Pick<ClientHost, "invokeApi" | "discoverApis">,
  session: Pick<ViewSession, "context">,
  signal: AbortSignal,
): Promise<string | null> {
  const apis = await host.discoverApis(session.context, signal);
  if (
    !apis.some(
      (api) => api.id === uiPanelsApi.definition.id && satisfiesSemverRange(api.version, "^1.1.0"),
    )
  )
    throw new Error("Floating previews require a newer T3 Code host.");
  const api = bindApi(uiPanelsApi, host, session.context, "^1.1.0");
  const capabilities = await api.invoke("getCapabilities", {}, signal);
  if (
    !capabilities.operations.getBrowserMiniPlayer ||
    !capabilities.operations.setBrowserMiniPlayer
  )
    throw new Error("This client cannot show a floating preview.");
  return (await api.invoke("getBrowserMiniPlayer", {}, signal)).tabId;
}

export async function setBrowserMiniPlayer(
  host: Pick<ClientHost, "invokeApi">,
  session: Pick<ViewSession, "context">,
  held: CaptureSessionRef,
  open: boolean,
  signal: AbortSignal,
): Promise<string | null> {
  return (
    await bindApi(uiPanelsApi, host, session.context, "^1.1.0").invoke(
      "setBrowserMiniPlayer",
      { ...held, open },
      signal,
    )
  ).tabId;
}

export function MiniPlayerButton(props: {
  readonly host: ClientHost;
  readonly session: ViewSession;
  readonly held: CaptureSessionRef | null;
  readonly visible: boolean;
  readonly style: CSSProperties;
  readonly report: (message: string) => void;
}) {
  const { host, session, held, visible, style, report } = props;
  const tabId = held?.tabId;
  const serverEpoch = held?.serverEpoch;
  const identity = JSON.stringify([
    session.context.resource.environmentId,
    session.context.resource.threadId,
    tabId,
    serverEpoch,
  ]);
  const lifetime = useRef<AbortSignal | null>(null);
  const [state, setState] = useState<{
    identity: string;
    signal: AbortSignal;
    open: boolean;
    reason: string | null;
  } | null>(null);
  const [pendingSignal, setPendingSignal] = useState<AbortSignal | null>(null);
  const pending = pendingSignal !== null && !pendingSignal.aborted;
  useEffect(() => {
    if (!visible || !tabId || !serverEpoch) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([session.signal, controller.signal]);
    lifetime.current = signal;
    void readBrowserMiniPlayer(host, session, signal).then(
      (current) => {
        if (!signal.aborted) setState({ identity, signal, open: current === tabId, reason: null });
      },
      (error: unknown) => {
        if (!signal.aborted)
          setState({
            identity,
            signal,
            open: false,
            reason: error instanceof Error ? error.message : "Floating preview unavailable.",
          });
      },
    );
    return () => controller.abort();
  }, [host, session, visible, tabId, serverEpoch, identity]);
  const current = state?.identity === identity && !state.signal.aborted && visible ? state : null;
  const label = current?.open ? "Close floating preview" : "Float preview over chat";
  return (
    <Tooltip host={host} label={current?.reason ?? label}>
      <button
        type="button"
        aria-label={label}
        disabled={!held || !current || current.reason !== null || pending}
        style={style}
        onClick={() => {
          const signal = lifetime.current;
          if (!held || !current || !signal || signal.aborted || pending || current.reason) return;
          setPendingSignal(signal);
          void setBrowserMiniPlayer(host, session, held, !current.open, signal)
            .then(
              (active) => {
                if (!signal.aborted) setState({ ...current, open: active === held.tabId });
              },
              (error: unknown) => {
                if (!signal.aborted)
                  report(error instanceof Error ? error.message : "Floating preview unavailable.");
              },
            )
            .finally(() => {
              if (!signal.aborted) setPendingSignal(null);
            });
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
          <rect width="10" height="7" x="12" y="13" rx="2" />
        </svg>
      </button>
    </Tooltip>
  );
}
