// Pane-level contract regression: the published `--t3-terminal-*`
// appearance vars must reach the real VT surface — font at creation via
// `options.font`, live updates through `setFont`, and a reset back to the
// packaged defaults when the feed clears. Bundles the real TerminalPane
// with a recording GhosttyTerminalSurface boundary (the reviewer's probe
// shape); no browser is involved. Also proves the local Ghostty editing
// intercepts exist: Ctrl+L writes U+000C to the PTY.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const packageDir = new URL("./", import.meta.url).pathname;
const require = createRequire(pathToFileURL(join(packageDir, "../../extension-sdk/package.json")));
const { build } = require("esbuild");
const React = require("react");
const { create, act } = require("react-test-renderer");
const { terminalAppearanceVars } = await import("./viewModel.ts");

const recorded = { options: [], themes: [], fonts: [], input: [] };
globalThis.__vtPaneContracts = recorded;

// The bundle must resolve workspace packages (`@t3tools/*`, react) — it has
// to live under the repo for node to walk up to the workspace node_modules.
const bundleDir = mkdtempSync(join(packageDir, ".pane-contracts-"));
const bundled = join(bundleDir, "pane.mjs");
await build({
  stdin: {
    contents:
      readFileSync(join(packageDir, "extension.tsx"), "utf8") +
      "\nexport { TerminalPane, handleBeforeKey };\n",
    resolveDir: packageDir,
    loader: "tsx",
  },
  outfile: bundled,
  jsx: "automatic",
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  plugins: [
    {
      name: "record-surface",
      setup(b) {
        b.onResolve({ filter: /^\.\/ghostty\/surface\.ts$/ }, () => ({
          path: "surface",
          namespace: "probe",
        }));
        b.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
          contents: `export class GhosttyTerminalSurface {
            static async create(mount, options) {
              globalThis.__vtPaneContracts.options.push(options);
              if (globalThis.__vtPaneContracts.delay)
                await new Promise((resolve) => {
                  globalThis.__vtPaneContracts.release = resolve;
                });
              return new this();
            }
            setTheme(theme) { globalThis.__vtPaneContracts.themes.push(theme); }
            async setFont(font) {
              globalThis.__vtPaneContracts.fonts.push(font);
              if (font.family === "Reject Mono") throw new Error("load rejection");
            }
            setVisible() {}
            focus() {}
            write() {}
            resetAndWrite() {}
            dispose() {}
          }`,
          loader: "js",
        }));
      },
    },
  ],
});

const { TerminalPane, handleBeforeKey } = await import(pathToFileURL(bundled).href);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
const style = {
  colorScheme: "dark",
  backgroundColor: "rgb(10, 20, 30)",
  color: "rgb(200, 210, 220)",
  getPropertyValue: () => "",
};
globalThis.getComputedStyle = () => style;
globalThis.document = {
  body: {},
  documentElement: { classList: { contains: () => true } },
  createElement: () => ({
    getContext: () => ({
      clearRect() {},
      fillRect() {},
      getImageData() {
        return { data: [10, 20, 30, 255] };
      },
    }),
  }),
};

const controller = new AbortController();
const host = {
  subscribeApi: (_request, signal) => ({
    async *[Symbol.asyncIterator]() {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    },
  }),
};
const session = {
  signal: controller.signal,
  context: { resource: { threadId: "thread-1" } },
};
const panel = {
  resetInput() {},
  resize() {},
  sendInput(id, data) {
    recorded.input.push({ id, data });
  },
};
const assets = { kind: "ready", runtime: {}, symbolsFontUrl: "fixture-font" };

function resetRecorded() {
  recorded.options.length = 0;
  recorded.themes.length = 0;
  recorded.fonts.length = 0;
  recorded.input.length = 0;
  recorded.delay = false;
  recorded.release = undefined;
}

const first = {
  appearance: "dark",
  theme: { background: "#123456", foreground: "#abcdef" },
  font: { family: "First Mono", size: 18 },
};
const second = { ...first, font: { family: "Second Mono", size: 24 } };

const props = {
  host,
  session,
  panel,
  terminalId: "terminal-1",
  active: true,
  visible: true,
  assets,
  themeVars: null,
  appearanceVars: terminalAppearanceVars(first),
};

test("published font vars reach the surface: create, update, reset", async () => {
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(TerminalPane, props), {
      createNodeMock: () => ({}),
    });
  });
  // Creation carries the already-published font — none of it waits for an
  // update cycle.
  assert.equal(recorded.options.length, 1);
  assert.deepEqual(recorded.options[0].font, { family: "First Mono", size: 18 });

  // A republished appearance drives setFont with the new family/size.
  await act(async () => {
    renderer.update(
      React.createElement(TerminalPane, {
        ...props,
        appearanceVars: terminalAppearanceVars(second),
      }),
    );
  });
  assert.deepEqual(recorded.fonts.at(-1), { family: "Second Mono", size: 24 });

  // A cleared feed resets the surface to its packaged defaults.
  await act(async () => {
    renderer.update(React.createElement(TerminalPane, { ...props, appearanceVars: null }));
  });
  assert.deepEqual(recorded.fonts.at(-1), {});

  // The same effect keeps the color pipeline live.
  assert.ok(recorded.themes.length >= 2);

  await act(async () => {
    renderer.unmount();
    controller.abort();
  });
  rmSync(bundleDir, { recursive: true, force: true });
});

// A publication that lands while `GhosttyTerminalSurface.create` is still
// pending must reconcile onto the new surface — the update effect sees
// surfaceRef null and its setFont is skipped, so the create continuation
// re-reads the latest vars after the await resolves.
test("republish during pending async create lands on the new surface", async () => {
  resetRecorded();
  recorded.delay = true;
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(TerminalPane, props), {
      createNodeMock: () => ({}),
    });
  });
  // Create is still pending; the republish's setFont is skipped.
  await act(async () => {
    renderer.update(
      React.createElement(TerminalPane, {
        ...props,
        appearanceVars: terminalAppearanceVars(second),
      }),
    );
  });
  assert.equal(recorded.fonts.length, 0);
  await act(async () => {
    recorded.release();
  });
  // The new surface was created with the pre-republish font, then
  // reconciled to the latest publication.
  assert.deepEqual(recorded.options[0].font, { family: "First Mono", size: 18 });
  assert.deepEqual(recorded.fonts.at(-1), { family: "Second Mono", size: 24 });
  await act(async () => {
    renderer.unmount();
  });
});

test("clear during pending async create resets the new surface", async () => {
  resetRecorded();
  recorded.delay = true;
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(TerminalPane, props), {
      createNodeMock: () => ({}),
    });
  });
  await act(async () => {
    renderer.update(React.createElement(TerminalPane, { ...props, appearanceVars: null }));
  });
  assert.equal(recorded.fonts.length, 0);
  await act(async () => {
    recorded.release();
  });
  assert.deepEqual(recorded.options[0].font, { family: "First Mono", size: 18 });
  assert.deepEqual(recorded.fonts.at(-1), {});
  await act(async () => {
    renderer.unmount();
  });
});

// A rejected setFont keeps current metrics and must not wedge the
// reconciliation — the next publication still reaches the surface.
test("a rejected setFont does not wedge later updates", async () => {
  resetRecorded();
  recorded.delay = true;
  const rejected = {
    ...first,
    font: { family: "Reject Mono", size: 20 },
  };
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(TerminalPane, props), {
      createNodeMock: () => ({}),
    });
  });
  await act(async () => {
    renderer.update(
      React.createElement(TerminalPane, {
        ...props,
        appearanceVars: terminalAppearanceVars(rejected),
      }),
    );
  });
  await act(async () => {
    recorded.release();
  });
  // The reconciling setFont rejected — swallowed like the settled path.
  assert.deepEqual(recorded.fonts.at(-1), { family: "Reject Mono", size: 20 });
  await act(async () => {
    renderer.update(
      React.createElement(TerminalPane, {
        ...props,
        appearanceVars: terminalAppearanceVars(second),
      }),
    );
  });
  assert.deepEqual(recorded.fonts.at(-1), { family: "Second Mono", size: 24 });
  await act(async () => {
    renderer.unmount();
  });
});

test("local Ghostty editing intercepts exist: Ctrl+L writes FF to the PTY", () => {
  let prevented = false;
  let stopped = false;
  const result = handleBeforeKey(
    {
      type: "keydown",
      key: "l",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    },
    panel,
    "terminal-1",
  );
  assert.equal(result, false);
  assert.ok(prevented && stopped);
  assert.deepEqual(recorded.input.at(-1), { id: "terminal-1", data: "\f" });
});
