import { useAtomValue } from "@effect/atom-react";
import type { StaticScreenProps } from "@react-navigation/native";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import type { PluginViewCloseReason } from "@t3tools/client-runtime/plugin-views/bridge";
import { buildPluginViewDocument } from "@t3tools/client-runtime/plugin-views/document";
import { resolvePluginViewTarget, sessionEpoch } from "@t3tools/client-runtime/plugin-views/host";
import { callPluginView } from "@t3tools/client-runtime/state/pluginViews";
import type { EnvironmentId, PluginInstallationId, PluginView } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";

import { EmptyState } from "../../../components/EmptyState";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { pluginViewEnvironment, usePluginViews } from "../../../state/pluginViews";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsScreen } from "../../settings/components/SettingsScreen";
import { pluginViewHostPage } from "./pluginViewHostPage";
import { makePluginViewRelay, runPluginViewRelayMount } from "./pluginViewNativeMount";
import { pluginViewsHostedOn } from "./pluginViewSupport";

export const PLUGIN_VIEWS_HOSTED = pluginViewsHostedOn(Platform.OS);

/** The bootstrap posts `ready` as it parses, so a view silent this long never started. */
const READY_TIMEOUT_MS = 10_000;

/** The host page loads its own srcdoc frames; nothing else may load, and nothing opens elsewhere. */
const ANY_ORIGIN = ["*"];
const HOST_PAGE_URLS = new Set(["about:blank", "about:srcdoc"]);

type MountEnd = Exclude<PluginViewCloseReason, "closed"> | "not-started" | "unprotected";

const END_DESCRIPTIONS: Record<MountEnd, string> = {
  violations: "It sent too many messages T3 Code could not accept, so it was stopped.",
  unresponsive: "It stopped answering, so it was closed.",
  "not-started": "It did not start. It may have failed to load.",
  unprotected:
    "This build of T3 Code cannot keep plugin views isolated. Update the app to use them.",
};

export type PluginViewRouteParams = {
  readonly environmentId: EnvironmentId;
  readonly installationId: PluginInstallationId;
  readonly viewId: string;
  readonly title: string;
};

function Notice(props: {
  readonly title: string;
  readonly detail: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}) {
  return (
    <View className="flex-1 justify-center">
      <EmptyState
        variant="plain"
        title={props.title}
        detail={props.detail}
        actionLabel={props.action?.label}
        onAction={props.action?.onPress}
      />
    </View>
  );
}

/**
 * One plugin view from an environment, opened from its plugin's settings.
 * iOS mounts it in a dedicated WebView while the snapshot from the
 * environment's current session offers it; disable, remove, a byte change,
 * a re-enable, or a new session tears it down at once and the screen says
 * why. Android shows that views are unsupported and never mounts one.
 */
export function SettingsPluginViewRouteScreen({ route }: StaticScreenProps<PluginViewRouteParams>) {
  const { environmentId, installationId, viewId, title } = route.params;
  return (
    <SettingsScreen title={title}>
      {PLUGIN_VIEWS_HOSTED ? (
        <PluginViewHost
          key={`${environmentId}:${installationId}:${viewId}`}
          environmentId={environmentId}
          surface={{ installationId, viewId, title }}
        />
      ) : (
        <Notice
          title="Plugin views are not available on Android"
          detail="Open this view from T3 Code on iOS, the web, or the desktop app."
        />
      )}
    </SettingsScreen>
  );
}

function PluginViewHost(props: {
  readonly environmentId: EnvironmentId;
  readonly surface: {
    readonly installationId: string;
    readonly viewId: string;
    readonly title: string;
  };
}) {
  const { environmentId, surface } = props;
  const { session, views } = usePluginViews(environmentId);
  const target = resolvePluginViewTarget({ views, surface, session: sessionEpoch(session) });
  switch (target._tag) {
    case "waiting":
      return <Notice title={surface.title} detail="Waiting for the environment." />;
    case "unsupported":
      return (
        <Notice
          title="Plugin views are unavailable"
          detail="This environment's T3 Code server cannot show plugin views."
        />
      );
    case "unavailable":
      return (
        <Notice
          title={`${surface.title} is not available`}
          detail={
            target.problem ??
            "Its plugin is disabled, removed, still loading, or changed since it was approved."
          }
        />
      );
    case "mount":
      return <PluginViewMount key={target.key} environmentId={environmentId} view={target.view} />;
  }
}

function PluginViewMount(props: {
  readonly environmentId: EnvironmentId;
  readonly view: PluginView;
}) {
  // The key fixes installation, generation and view, and a generation's manifest never changes.
  const [view] = useState(props.view);
  const { environmentId } = props;
  const bundle = useEnvironmentQuery(
    pluginViewEnvironment.bundle({
      environmentId,
      input: {
        installationId: view.installationId,
        generation: view.generation,
        viewId: view.viewId,
      },
    }),
  );
  const page = useMemo(() => {
    if (bundle.data === null) return null;
    return Result.map(buildPluginViewDocument(bundle.data, view.title), (document) =>
      pluginViewHostPage({ document, title: view.title }),
    );
  }, [bundle.data, view.title]);
  const [ended, setEnded] = useState<MountEnd | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (bundle.error !== null && bundle.data === null)
    return (
      <Notice
        title={`${view.title} could not load`}
        detail={bundle.error}
        action={{ label: "Try again", onPress: bundle.refresh }}
      />
    );
  if (page === null) return <Notice title={view.title} detail="Loading the view." />;
  if (Result.isFailure(page))
    return <Notice title={`${view.title} could not load`} detail={page.failure.message} />;
  if (ended !== null)
    return (
      <Notice
        title={`${view.title} stopped`}
        detail={END_DESCRIPTIONS[ended]}
        action={
          ended === "unprotected"
            ? undefined
            : {
                label: "Reload",
                onPress: () => {
                  setEnded(null);
                  setAttempt((current) => current + 1);
                },
              }
        }
      />
    );
  return (
    <PluginViewWebView
      key={attempt}
      environmentId={environmentId}
      view={view}
      html={page.success}
      onEnd={setEnded}
    />
  );
}

/**
 * The dedicated WebView. Its main frame is the trusted host page; the view
 * runs two sandboxed frames down and reaches native only through the
 * page's relay. Unmounting it ends the mount: the bridge fiber is
 * interrupted and the WebView, with every frame in it, goes away.
 */
function PluginViewWebView(props: {
  readonly environmentId: EnvironmentId;
  readonly view: PluginView;
  readonly html: string;
  readonly onEnd: (end: MountEnd) => void;
}) {
  const { environmentId, view, html, onEnd } = props;
  const webView = useRef<WebView<object>>(null);
  const runtime = useAtomValue(connectionAtomRuntime);
  const services = AsyncResult.isSuccess(runtime) ? runtime.value : null;
  const source = useMemo(() => ({ html }), [html]);
  const mount = useRef<{
    readonly receive: (data: string) => void;
    readonly end: (reason: MountEnd) => void;
  } | null>(null);

  useEffect(() => {
    if (services === null) return;
    let live = true;
    let bridge: Fiber.Fiber<never, unknown> | null = null;
    const end = (reason: MountEnd) => {
      if (!live) return;
      live = false;
      onEnd(reason);
    };
    // The host fixes the target; nothing the view sends can name another one.
    const call = (handler: string, input: Schema.Json) =>
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) =>
          registry.run(
            environmentId,
            callPluginView({
              installationId: view.installationId,
              generation: view.generation,
              viewId: view.viewId,
              handler,
              input,
            }),
          ),
        ),
        Effect.map((result) => result.value),
      );
    const relay = makePluginViewRelay({
      inject: (script) => webView.current?.injectJavaScript(script),
      onConnect: (restricted) => {
        clearTimeout(readyTimeout);
        // Without the native patch a subframe could message native; refuse to serve it.
        if (!restricted) return end("unprotected");
        bridge = Effect.runForkWith(services)(
          Effect.scoped(
            runPluginViewRelayMount({
              relay,
              view,
              call,
              onClose: (reason) => {
                if (reason !== "closed") end(reason);
              },
            }),
          ),
        );
      },
    });
    const readyTimeout = setTimeout(() => end("not-started"), READY_TIMEOUT_MS);
    mount.current = { receive: relay.receive, end };
    return () => {
      live = false;
      mount.current = null;
      clearTimeout(readyTimeout);
      if (bridge !== null) Effect.runFork(Fiber.interrupt(bridge));
    };
  }, [environmentId, view, services, onEnd]);

  // The relay must exist before the page can connect.
  if (services === null) return null;
  return (
    <WebView
      ref={webView}
      source={source}
      t3RestrictSubframes
      originWhitelist={ANY_ORIGIN}
      onShouldStartLoadWithRequest={(request) => HOST_PAGE_URLS.has(request.url)}
      onMessage={(event) => mount.current?.receive(event.nativeEvent.data)}
      onContentProcessDidTerminate={() => mount.current?.end("unresponsive")}
      incognito
      cacheEnabled={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      webviewDebuggingEnabled={__DEV__}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
}
