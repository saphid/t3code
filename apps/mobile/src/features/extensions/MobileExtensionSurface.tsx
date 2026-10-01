import * as React from "react";
import { AppState, Keyboard, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import pageSource from "../../../.generated/mobile-extension/page";
import { createNativeBridge } from "./mobileExtensionBridge";
import {
  createMobileExtensionHost,
  mobileExtensionCache,
  type MobileHostSnapshot,
} from "./mobileExtensionHost";
import { mobileExtensionTransport } from "./mobileExtensionTransport";
import { buildMobileHostHtml } from "./mobileHostProtocol";
import type { MobilePageBootstrap } from "./mobileHostPage";

type Host = ReturnType<typeof createMobileExtensionHost>;
type SurfaceProps = {
  environmentId: string;
  installationId: string;
  surfaceId: string;
  context: ViewContext;
  environmentLabel: string;
  cssVars: Record<string, string>;
  onMounted?: () => void;
};
export function MobileExtensionSurface(props: SurfaceProps) {
  return (
    <SurfaceSession
      key={JSON.stringify([
        props.environmentId,
        props.installationId,
        props.surfaceId,
        props.context,
      ])}
      {...props}
    />
  );
}
function SurfaceSession(props: SurfaceProps) {
  const [binding] = React.useState(() => ({
    environmentId: props.environmentId,
    installationId: props.installationId,
    surfaceId: props.surfaceId,
    context: props.context,
  }));
  const [snapshot, setSnapshot] = React.useState<MobileHostSnapshot>({
    phase: "loading",
    generation: "0",
  });
  const [host, setHost] = React.useState<Host | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    let owned: Host | undefined;
    void mobileExtensionTransport(
      binding.environmentId,
      binding.installationId,
      () => owned?.snapshot().installation?.contentHash ?? "",
      controller.signal,
    )
      .then((transport) => {
        if (controller.signal.aborted) return;
        owned = createMobileExtensionHost({
          ...binding,
          transport,
          cache: mobileExtensionCache,
          onChange: () => {
            if (!controller.signal.aborted && owned) setSnapshot(owned.snapshot());
          },
        });
        setHost(owned);
        owned.setAppState(AppState.currentState);
        void owned.refresh();
      })
      .catch(() => {
        if (!controller.signal.aborted) setSnapshot({ phase: "offline", generation: "0" });
      });
    const subscription = AppState.addEventListener("change", (state) => owned?.setAppState(state));
    return () => {
      controller.abort();
      subscription.remove();
      owned?.dispose();
    };
  }, [binding]);
  if (snapshot.phase === "ready" && host && snapshot.code)
    return <MountedSurface key={snapshot.generation} host={host} snapshot={snapshot} {...props} />;
  const label =
    snapshot.phase === "offline"
      ? "Connection unavailable"
      : snapshot.phase === "unavailable"
        ? "Extension unavailable. Check installation grants."
        : snapshot.phase === "suspended"
          ? "Extension paused"
          : "Opening extension…";
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text accessibilityRole="alert">{label}</Text>
      {snapshot.phase === "offline" && host ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void host.recover();
          }}
        >
          <Text>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
function MountedSurface(props: {
  host: Host;
  snapshot: MobileHostSnapshot;
  surfaceId: string;
  context: ViewContext;
  environmentLabel: string;
  cssVars: Record<string, string>;
  onMounted?: () => void;
}) {
  const webview = React.useRef<WebView>(null);
  const bridge = React.useRef<ReturnType<typeof createNativeBridge> | null>(null);
  const insets = useSafeAreaInsets();
  const [keyboardInset, setKeyboardInset] = React.useState(0);
  const [bootstrap] = React.useState<MobilePageBootstrap>(() => ({
    generation: props.snapshot.generation,
    code: props.snapshot.code!,
    surfaceId: props.surfaceId,
    context: props.context,
    environmentLabel: props.environmentLabel,
    cssVars: props.cssVars,
    insets,
    keyboardInset: 0,
  }));
  const html = React.useMemo(() => buildMobileHostHtml(pageSource, bootstrap), [bootstrap]);
  const send = React.useCallback((message: string) => {
    webview.current?.injectJavaScript(
      `window.__t3MobileReceive?.(${JSON.stringify(message)});true;`,
    );
  }, []);
  React.useEffect(() => {
    const owned = createNativeBridge({
      generation: bootstrap.generation,
      send,
      invoke: props.host.invoke,
      subscribe: props.host.subscribe,
    });
    bridge.current = owned;
    const abort = () => owned.dispose();
    props.snapshot.signal?.addEventListener("abort", abort, { once: true });
    if (props.snapshot.signal?.aborted) abort();
    return () => {
      props.snapshot.signal?.removeEventListener("abort", abort);
      send(JSON.stringify({ generation: bootstrap.generation, kind: "dispose" }));
      owned.dispose();
      if (bridge.current === owned) bridge.current = null;
    };
  }, [bootstrap.generation, props.host, props.snapshot.signal, send]);
  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboardInset(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const presentation = () =>
    send(
      JSON.stringify({
        generation: bootstrap.generation,
        kind: "presentation",
        payload: { cssVars: props.cssVars, insets, keyboardInset, visible: true },
      }),
    );
  React.useEffect(presentation, [bootstrap.generation, props.cssVars, insets, keyboardInset, send]);
  const receive = (event: WebViewMessageEvent) => {
    const message = event.nativeEvent.data;
    if (bridge.current?.receive(message) || message.length > 4096) return;
    try {
      const value = JSON.parse(message) as { generation: string; kind: string };
      if (value.generation !== bootstrap.generation) return;
      if (value.kind === "ready") presentation();
      if (value.kind === "mounted") props.onMounted?.();
      if (value.kind === "failure") props.host.fail();
    } catch {
      return;
    }
  };
  return (
    <WebView
      ref={webview}
      source={{ html }}
      onMessage={receive}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      onContentProcessDidTerminate={() => {
        void props.host.processTerminated();
      }}
      onRenderProcessGone={() => {
        void props.host.processTerminated();
      }}
      onError={() => props.host.fail()}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      style={{ flex: 1, backgroundColor: props.cssVars["--background"] }}
    />
  );
}
