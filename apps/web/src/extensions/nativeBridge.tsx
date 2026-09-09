import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ViewRecord } from "@t3tools/extension-sdk/contracts";
import {
  createExtensionHost,
  type Extension,
  type ExtensionHost,
} from "@t3tools/extension-sdk/host";
import { ExtensionSurface, type SurfaceRenderer } from "@t3tools/extension-sdk/react";

interface MountedView {
  readonly host: ExtensionHost<SurfaceRenderer>;
  readonly viewId: string;
  readonly recordKey: string;
}

/** Trusted bundled bindings stay in React; only the resource record enters the SDK. */
export function createNativeSurfaceBridge<Bindings>(
  createExtension: (useBindings: () => Bindings) => Extension<SurfaceRenderer>,
) {
  const BindingsContext = createContext<{ value: Bindings } | null>(null);
  const extension = createExtension(() => {
    const bindings = useContext(BindingsContext);
    if (!bindings) throw new Error("Native surface bindings are unavailable");
    return bindings.value;
  });

  function NativeSurface(props: {
    readonly bindings: Bindings;
    readonly record: ViewRecord;
    readonly visible: boolean;
    readonly retainHiddenPresentation?: boolean;
    readonly onRecordChange?: (record: ViewRecord) => void;
  }) {
    const { bindings, visible } = props;
    const recordKey = JSON.stringify({ ...props.record, restoreState: null });
    const currentRecord = useRef(props.record);
    const onRecordChange = useRef(props.onRecordChange);
    const visibility = useRef(visible);
    useLayoutEffect(() => {
      currentRecord.current = props.record;
      onRecordChange.current = props.onRecordChange;
      visibility.current = visible;
    }, [props.record, props.onRecordChange, visible]);
    const bindingValue = useMemo(() => ({ value: bindings }), [bindings]);
    const [mounted, setMounted] = useState<MountedView | null>(null);
    const [failure, setFailure] = useState<{ recordKey: string; text: string } | null>(null);
    useEffect(() => {
      const host = createExtensionHost<SurfaceRenderer>({ authorize: () => false });
      const persistRecord = onRecordChange.current;
      let closed = false;
      host.register(extension);
      let saved = JSON.stringify(currentRecord.current.restoreState);
      const unsubscribe = host.subscribe((next) => {
        if (!next || closed) return;
        const nextSaved = JSON.stringify(next.record.restoreState);
        if (saved === nextSaved) return;
        saved = nextSaved;
        persistRecord?.(next.record);
      });
      // Layout records reference resources already created by an explicit host command.
      void host.restore(currentRecord.current).then(
        (viewId) => {
          if (closed) return;
          if (!visibility.current) host.hide(viewId);
          setMounted({ host, viewId, recordKey });
        },
        (error: unknown) => {
          if (!closed)
            setFailure({
              recordKey,
              text: error instanceof Error ? error.message : "Surface unavailable",
            });
        },
      );
      return () => {
        const record = host.records()[0];
        if (record && JSON.stringify(record.restoreState) !== saved) persistRecord?.(record);
        closed = true;
        unsubscribe();
        host.dispose();
      };
    }, [recordKey]);
    useEffect(() => {
      if (!mounted || mounted.recordKey !== recordKey) return;
      if (visible) void mounted.host.show(mounted.viewId);
      else mounted.host.hide(mounted.viewId);
    }, [mounted, recordKey, visible]);
    return (
      <BindingsContext value={bindingValue}>
        {mounted?.recordKey === recordKey ? (
          <ExtensionSurface
            host={mounted.host}
            viewId={mounted.viewId}
            retainHiddenPresentation={props.retainHiddenPresentation ?? false}
            className={
              props.record.placement === "bottom-dock"
                ? "contents"
                : "flex h-full min-h-0 min-w-0 flex-col"
            }
          />
        ) : failure?.recordKey === recordKey ? (
          <div role="status">{failure.text}</div>
        ) : null}
      </BindingsContext>
    );
  }
  return { extension, Surface: NativeSurface };
}
