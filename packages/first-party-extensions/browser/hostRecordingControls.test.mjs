import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(import.meta.url);
const React = require("react");
const { act, create } = require("react-test-renderer");
const { build } = require("esbuild");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {};
let ElectronBrowserHost;
const mocks = {
  "~/env": "export const isElectron = true;",
  "~/hooks/useTheme": "export const useTheme = () => ({resolvedTheme:'dark'});",
  "~/previewStateStore": "export const useActivePreviewSessions = () => ({});",
  "./BrowserEngineHostConnection": "export const BrowserEngineHostConnection = () => null;",
  "./browserPointerStore": "export const useBrowserPointerStore = {};",
  "./HostedBrowserWebview": "export const HostedBrowserWebview = () => null;",
  "~/components/ui/button":
    "import React from 'react'; export const Button = ({variant,size,...props}) => React.createElement('button',props);",
  "~/components/ui/tooltip":
    "import React from 'react'; export const Tooltip = ({children}) => children; export const TooltipPopup = () => null; export const TooltipTrigger = ({render,children}) => React.cloneElement(render,{},children);",
  "./browserRecording": `import {useSyncExternalStore} from 'react';
    export const useBridgeBrowserRecordingTabIds = () => useSyncExternalStore(globalThis.hostRecordingFixture.subscribe, () => globalThis.hostRecordingFixture.tabIds);
    export const stopBrowserRecording = (tabId) => globalThis.hostRecordingFixture.stop(tabId);`,
  "./browserRecordingToast":
    "export const showBrowserRecordingSavedToast = artifact => globalThis.hostRecordingFixture.saved.push(artifact);",
  "~/components/ui/toast":
    "export const toastManager = {add: value => globalThis.hostRecordingFixture.errors.push(value)};",
};
NodeTest.before(async () => {
  const result = await build({
    entryPoints: [
      NodeURL.fileURLToPath(
        new URL("../../../apps/web/src/browser/ElectronBrowserHost.tsx", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    banner: {
      js: "import {createRequire as nativeRequire} from 'node:module'; const require = nativeRequire(import.meta.url);",
    },
    plugins: [
      {
        name: "host-seams",
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: "host-mock" } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "host-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-host-recording-"));
  try {
    const file = NodePath.join(directory, "host.mjs");
    await NodeFSP.writeFile(file, result.outputFiles[0].text);
    ({ ElectronBrowserHost } = await import(NodeURL.pathToFileURL(file).href));
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

NodeTest.test(
  "the host shows bridge-owned stop controls even with no rendered pack or session",
  async () => {
    const listeners = new Set();
    const stops = [];
    const fixture = {
      tabIds: new Set(),
      saved: [],
      errors: [],
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(tabIds) {
        this.tabIds = new Set(tabIds);
        for (const listener of listeners) listener();
      },
      async stop(tabId) {
        stops.push(tabId);
        this.publish([...this.tabIds].filter((current) => current !== tabId));
        return { id: tabId, path: "/private/recording.webm" };
      },
    };
    globalThis.hostRecordingFixture = fixture;
    let renderer;
    await act(async () => {
      renderer = create(React.createElement(ElectronBrowserHost));
    });
    NodeAssert.equal(renderer.root.findAllByType("button").length, 0);
    await act(async () => {
      fixture.publish(["pack-tab-1", "pack-tab-2"]);
    });
    const stopControls = () =>
      renderer.root.findAll(
        (node) => node.type === "button" && node.props["aria-label"] === "Stop recording",
      );
    const controls = stopControls();
    NodeAssert.equal(controls.length, 2);
    NodeAssert.equal(
      renderer.root.findAll(
        (node) => node.type === "span" && node.props.className?.includes("animate-status-pulse"),
      ).length,
      2,
    );
    await act(async () => {
      controls[0].props.onClick({ shiftKey: false });
    });
    NodeAssert.deepEqual(stops, ["pack-tab-1"]);
    NodeAssert.equal(fixture.saved.length, 1);
    NodeAssert.equal(stopControls().length, 1);
    await act(async () => {
      renderer.unmount();
    });
    NodeAssert.equal(listeners.size, 0);
  },
);
