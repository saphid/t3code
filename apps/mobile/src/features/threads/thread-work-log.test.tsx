import {
  act,
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { buildThreadFeed } from "../../lib/threadActivity";
import { ThreadMediaVisibility, useThreadMediaVisible } from "./ThreadMediaVisibility";
import { ShimmeringWorkContent, ThreadThinkingRow, ThreadWorkLog } from "./thread-work-log";

const native = vi.hoisted(() => ({
  active: new Set<object>(),
  starts: 0,
  stops: 0,
  masks: 0,
  focused: true,
  appActive: true,
  reducedMotion: false,
  timings: [] as Array<{ duration: number; useNativeDriver: boolean }>,
  resets: [] as number[],
}));

const RowContext = createContext("outer");
const ListVisibilityContext = createContext(true);
const visibility = vi.hoisted(() => ({
  sizes: new Map<string, number>(),
  callbacks: new Map<string, (token: { sizeVisible: number }) => void>(),
}));

vi.mock("@legendapp/list/react-native", () => ({
  useViewabilityAmount(callback: (token: { sizeVisible: number }) => void) {
    const id = useContext(RowContext);
    const enabled = useContext(ListVisibilityContext);
    useLayoutEffect(() => {
      if (!enabled) return;
      // Model LegendList's single callback slot per row, including synchronous initial delivery.
      expect(visibility.callbacks.has(id)).toBe(false);
      visibility.callbacks.set(id, callback);
      callback({ sizeVisible: visibility.sizes.get(id) ?? 0 });
      return () => {
        visibility.callbacks.delete(id);
      };
    }, [callback, enabled, id]);
  },
}));
vi.mock("@legendapp/list/reanimated", () => ({
  AnimatedLegendList: (props: {
    data: ReadonlyArray<{ id: string }>;
    renderItem: (info: { item: { id: string }; index: number }) => ReactNode;
    viewabilityConfig?: unknown;
  }) =>
    props.data.map((item, index) => (
      <ListVisibilityContext key={item.id} value={props.viewabilityConfig !== undefined}>
        <RowContext value={item.id}>{props.renderItem({ item, index })}</RowContext>
      </ListVisibilityContext>
    )),
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => native.focused }));
vi.mock("../../lib/appState", () => ({
  useAppActive: () => native.appActive,
  useReduceMotionEnabled: () => native.reducedMotion,
}));

function MeasuredView(props: {
  children?: ReactNode;
  onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
}) {
  const { onLayout } = props;
  useLayoutEffect(() => onLayout?.({ nativeEvent: { layout: { width: 240 } } }), [onLayout]);
  return createElement("div", null, props.children);
}
function MeasuredText(props: {
  children?: ReactNode;
  onTextLayout?: (event: { nativeEvent: { lines: Array<{ width: number }> } }) => void;
}) {
  const { onTextLayout } = props;
  useLayoutEffect(
    () => onTextLayout?.({ nativeEvent: { lines: [{ width: 120 }] } }),
    [onTextLayout],
  );
  return createElement("span", null, props.children);
}
vi.mock("react-native", () => ({
  View: MeasuredView,
  Pressable: MeasuredView,
  StyleSheet: { absoluteFill: {} },
  Easing: { linear: (value: number) => value },
  useAnimatedValue: () =>
    useState(() => ({
      setValue: (value: number) => {
        native.resets.push(value);
      },
      interpolate: () => 0,
    }))[0],
  Animated: {
    View: MeasuredView,
    timing: (_value: unknown, options: { duration: number; useNativeDriver: boolean }) => {
      native.timings.push(options);
      return {};
    },
    loop: () => {
      const loop = {
        start: () => {
          native.starts++;
          native.active.add(loop);
        },
        stop: () => {
          native.stops++;
          native.active.delete(loop);
        },
      };
      return loop;
    },
  },
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: MeasuredText }));
vi.mock("@expo/ui/community/masked-view", () => ({
  MaskedView: (props: { children?: ReactNode }) => {
    useLayoutEffect(() => {
      native.masks++;
      return () => {
        native.masks--;
      };
    }, []);
    return props.children;
  },
}));
vi.mock("react-native-svg", () => ({
  default: () => null,
  Defs: () => null,
  LinearGradient: () => null,
  Rect: () => null,
  Stop: () => null,
}));
vi.mock("react-native-reanimated", () => {
  const transition = { duration: () => transition };
  return {
    default: { View: MeasuredView },
    FadeIn: transition,
    FadeOut: transition,
    LinearTransition: transition,
    useSharedValue: (value: number) => useState(() => ({ value }))[0],
    useAnimatedStyle: () => ({}),
    withTiming: (value: number) => value,
    ReduceMotion: { System: "system" },
  };
});
vi.mock("../../components/ui/Button", () => ({}));
vi.mock("./SubagentStatusDot", () => ({}));
vi.mock("./thread-subagent-group", () => ({}));
vi.mock("./ProposedPlanCard", () => ({}));
vi.mock("./QuestionAnswerHistory", () => ({}));
vi.mock("./thread-command-output", () => ({ useCommandOutputStreaming: () => false }));
vi.mock("expo-haptics", () => ({}));
vi.mock("expo-image", () => ({}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../state/threads", () => ({}));
vi.mock("../../state/use-atom-command", () => ({}));
vi.mock("./markdownCodeHighlightState", () => ({}));
vi.mock("../../components/T3Wordmark", () => ({}));
vi.mock("./BrowserAppIcon", () => ({}));
vi.mock("../../state/queries", () => ({ useTurnItemDetail: () => ({ data: null, error: null }) }));
vi.mock("../../components/FilePreviewGallery", () => ({}));
vi.mock("./ThreadMarkdownImage", () => ({}));
vi.mock("../../state/assets", () => ({}));
vi.mock("../pull-requests/pullRequestGlyphs", () => ({}));
vi.mock("./useOpenLinkedThread", () => ({ useOpenLinkedThread: () => () => {} }));

function setup() {
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(native, {
    starts: 0,
    stops: 0,
    masks: 0,
    focused: true,
    appActive: true,
    reducedMotion: false,
  });
  native.active.clear();
  native.timings.length = 0;
  native.resets.length = 0;
  visibility.sizes.clear();
  visibility.callbacks.clear();
  const container = document.createElement("div");
  const root = createRoot(container);
  return {
    container,
    render: (children: ReactNode) => act(() => root.render(children)),
    scroll(id: string, size: number) {
      visibility.sizes.set(id, size);
      act(() => visibility.callbacks.get(id)?.({ sizeVisible: size }));
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
      expect(native.active.size).toBe(0);
      expect(native.masks).toBe(0);
      expect(visibility.callbacks.size).toBe(0);
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    },
  };
}
const shimmer = (key = "live") => (
  <ShimmeringWorkContent
    key={key}
    icon="brain"
    iconSubtleColor="gray"
    label="Running tool"
    showIcon={false}
  />
);

it("stops retained offscreen loops and masks, preserving measured text and resuming for one visible pixel", () => {
  using screen = setup();
  const render = () => screen.render(<ThreadMediaVisibility>{shimmer()}</ThreadMediaVisibility>);
  render();
  expect(native.active.size).toBe(0);
  expect(screen.container.textContent).toBe("Running tool");
  expect(native.masks).toBe(0);
  screen.scroll("outer", 1);
  expect(native.active.size).toBe(1);
  expect(native.masks).toBe(1);
  expect(native.timings).toMatchObject([{ duration: 2800, useNativeDriver: true }]);
  screen.scroll("outer", 80);
  expect(native.starts).toBe(1);
  screen.scroll("outer", 0);
  expect(native.active.size).toBe(0);
  expect(native.masks).toBe(0);
  expect(screen.container.textContent).toBe("Running tool");
  expect(native.starts).toBe(1);
  expect(native.stops).toBe(1);
  screen.scroll("outer", 120);
  expect(native.active.size).toBe(1);
  expect(native.starts).toBe(2);
});

it("combines an inner clipped row with outer visibility", () => {
  using screen = setup();
  visibility.sizes.set("outer", 100);
  screen.render(
    <ThreadMediaVisibility>
      <RowContext value="inner">
        <ThreadMediaVisibility>{shimmer()}</ThreadMediaVisibility>
      </RowContext>
    </ThreadMediaVisibility>,
  );
  expect(native.active.size).toBe(0);
  screen.scroll("inner", 1);
  expect(native.active.size).toBe(1);
  screen.scroll("outer", 0);
  expect(native.active.size).toBe(0);
  screen.scroll("outer", 100);
  expect(native.active.size).toBe(1);
  screen.scroll("inner", 0);
  expect(native.active.size).toBe(0);
  expect(screen.container.textContent).toBe("Running tool");
});

it("starts on first visible presentation and handles label identity, focus, AppState, and Reduce Motion", () => {
  using screen = setup();
  visibility.sizes.set("outer", 100);
  const render = (key = "first") =>
    screen.render(<ThreadMediaVisibility>{shimmer(key)}</ThreadMediaVisibility>);
  render();
  expect(native.active.size).toBe(1);
  render("replacement");
  expect(native.active.size).toBe(1);
  expect(native.stops).toBeGreaterThanOrEqual(1);
  for (const field of ["focused", "appActive", "reducedMotion"] as const) {
    native[field] = field === "reducedMotion";
    render("replacement");
    expect(native.active.size).toBe(0);
    expect(native.masks).toBe(0);
    native[field] = field !== "reducedMotion";
    render("replacement");
    expect(native.active.size).toBe(1);
  }
  expect(native.resets.every((value) => value === 0)).toBe(true);
});

it("keeps a standalone shimmer active without a feed", () => {
  using screen = setup();
  screen.render(shimmer());
  expect(native.active.size).toBe(1);
  expect(visibility.callbacks.size).toBe(0);
});

it("gates the production Thinking row without unmounting its label", () => {
  using screen = setup();
  screen.render(
    <ThreadMediaVisibility>
      <ThreadThinkingRow
        rowSizing={{ estimatedRowHeight: 32, fixedRowHeight: 32, textSizeKey: "default" }}
        iconSubtleColor="gray"
      />
    </ThreadMediaVisibility>,
  );
  expect(native.active.size).toBe(0);
  expect(screen.container.textContent).toBe("Thinking");
  screen.scroll("outer", 1);
  expect(native.active.size).toBe(1);
});

function MediaConsumer() {
  useThreadMediaVisible();
  return null;
}

it("shares one observer for media and multiple shimmers and releases it after the last consumer", () => {
  using screen = setup();
  visibility.sizes.set("outer", 100);
  const render = (count: number, media: boolean) =>
    screen.render(
      <ThreadMediaVisibility>
        {Array.from({ length: count }, (_, index) => shimmer(String(index)))}
        {media ? <MediaConsumer /> : null}
      </ThreadMediaVisibility>,
    );
  render(2, true);
  expect(visibility.callbacks.size).toBe(1);
  expect(native.active.size).toBe(2);
  render(0, true);
  expect(native.active.size).toBe(0);
  expect(visibility.callbacks.size).toBe(1);
  render(0, false);
  expect(visibility.callbacks.size).toBe(0);
  render(1, false);
  expect(native.active.size).toBe(1);
  expect(visibility.callbacks.size).toBe(1);
});

it("does not observe text-only rows or explicit overlay visibility", () => {
  using screen = setup();
  screen.render(
    <>
      {Array.from({ length: 100 }, (_, index) => (
        <ThreadMediaVisibility key={index}>Text</ThreadMediaVisibility>
      ))}
    </>,
  );
  expect(visibility.callbacks.size).toBe(0);
  const render = (visible: boolean) =>
    screen.render(
      <ThreadMediaVisibility>
        <ShimmeringWorkContent
          visible={visible}
          icon="brain"
          iconSubtleColor="transparent"
          label="Preparing workspace"
          showIcon={false}
          compact
        />
      </ThreadMediaVisibility>,
    );
  render(true);
  expect(native.active.size).toBe(1);
  expect(visibility.callbacks.size).toBe(0);
  render(false);
  expect(native.active.size).toBe(0);
  expect(screen.container.textContent).toBe("Preparing workspace");
  expect(visibility.callbacks.size).toBe(0);
});

it("gates a running row through the production nested tool list", () => {
  using screen = setup();
  const timestamp = DateTime.makeUnsafe("2026-06-20T00:00:01.000Z");
  const threadId = ThreadId.make("thread");
  const item = {
    id: TurnItemId.make("tool"),
    threadId,
    runId: RunId.make("run"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "running" as const,
    title: null,
    startedAt: timestamp,
    completedAt: null,
    updatedAt: timestamp,
    type: "command_execution" as const,
    input: "long-running-tool",
    output: "",
  };
  const activities = buildThreadFeed([
    {
      position: 0,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    },
  ])
    .flatMap((entry) => (entry.type === "activity-group" ? entry.activities : []))
    .map((activity) => ({ ...activity, groupedToolDetail: true, live: true }));
  expect(activities).toHaveLength(1);
  visibility.sizes.set("outer", 100);
  screen.render(
    <ThreadMediaVisibility>
      <ThreadWorkLog
        activities={activities}
        anchorKey="group"
        environmentId={EnvironmentId.make("environment")}
        copiedRowId={null}
        expandedRows={{}}
        rowSizing={{ estimatedRowHeight: 32, fixedRowHeight: 32, textSizeKey: "default" }}
        scrollPositions={new Map()}
        iconSubtleColor="gray"
        edgeFadeColor="white"
        themeAppearance="light"
        onCopyRow={() => {}}
        onToggleRow={() => {}}
        renderImage={() => null}
        renderReasoning={() => null}
        onPressPreview={() => {}}
      />
    </ThreadMediaVisibility>,
  );
  expect(native.active.size).toBe(0);
  const id = activities[0]!.id;
  screen.scroll(id, 1);
  expect(native.active.size).toBe(1);
  screen.scroll("outer", 0);
  expect(native.active.size).toBe(0);
  screen.scroll("outer", 1);
  expect(native.active.size).toBe(1);
  screen.scroll(id, 0);
  expect(native.active.size).toBe(0);
  expect(screen.container.textContent).toContain("long-running-tool");
});
