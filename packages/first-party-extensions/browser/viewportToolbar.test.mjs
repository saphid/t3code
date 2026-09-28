/**
 * Component-level regressions over the REAL viewportToolbar.tsx, bundled by
 * esbuild into the system tmpdir (never into the package) and driven with
 * react-test-renderer. Events bubble through the rendered tree the way React
 * delivers them, and a mouse press that is not default-prevented moves focus
 * the way macOS Chromium does: clicked buttons do not take focus, so the
 * edited field blurs with no relatedTarget.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(new URL(".", import.meta.url));
const { build } = require("esbuild");
const React = require("react");
const { act, create } = require("react-test-renderer");

const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The toolbar's blur check tests `relatedTarget instanceof Node`.
class FakeNode {
  constructor(instance) {
    this.instance = instance;
  }

  /** Whether this node renders inside `ancestor`, like `Node.contains`. */
  isWithin(ancestor) {
    for (let cursor = this.instance; cursor; cursor = cursor.parent)
      if (cursor === ancestor) return true;
    return false;
  }
}
globalThis.Node = FakeNode;

let BrowserViewportToolbar;

NodeTest.before(async () => {
  const built = await build({
    entryPoints: [NodePath.join(packageDir, "viewportToolbar.tsx")],
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "external-react",
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
        },
      },
    ],
  });
  const bundleDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-viewport-toolbar-"));
  const bundlePath = NodePath.join(bundleDir, "bundle.mjs");
  try {
    await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
    ({ BrowserViewportToolbar } = await import(NodeURL.pathToFileURL(bundlePath).href));
  } finally {
    await NodeFSP.rm(bundleDir, { recursive: true, force: true });
  }
});

const IPHONE_SE = { _tag: "preset", presetId: "iphone-se", width: 375, height: 667 };

/**
 * Mounts the toolbar under a host that behaves like the panel: a commit
 * marks the toolbar pending until `land()` applies it as the new setting.
 */
function mountToolbar(setting) {
  const commits = [];
  let current = setting;
  let pending = false;
  let locked = false;
  let renderer;
  const render = () =>
    React.createElement(BrowserViewportToolbar, {
      // No host tooltip: controls render bare.
      host: { React },
      setting: current,
      pending,
      aspectLocked: locked,
      onAspectLockedChange: (next) => {
        locked = next;
        renderer.update(render());
      },
      onCommit: (next) => {
        commits.push(next);
        pending = true;
        renderer.update(render());
      },
    });
  act(() => {
    renderer = create(render());
  });
  return {
    commits,
    locked: () => locked,
    land() {
      const next = commits.at(-1);
      act(() => {
        pending = false;
        if (next._tag !== "fill") current = next;
        renderer.update(render());
      });
    },
    find: (label) => renderer.root.find((node) => node.props["aria-label"] === label),
  };
}

/** Delivers a React synthetic event from `target` up through its ancestors. */
function dispatch(target, handler, init = {}) {
  const event = {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    target: { value: init.value },
    ...init,
  };
  act(() => {
    for (let node = target; node && !event.propagationStopped; node = node.parent) {
      const listener = node.props?.[handler];
      if (typeof listener !== "function") continue;
      event.currentTarget = { contains: (other) => other?.isWithin(node) === true };
      listener(event);
    }
  });
  return event;
}

function typeInto(toolbar, label, value) {
  dispatch(toolbar.find(label), "onFocus");
  dispatch(toolbar.find(label), "onChange", { value });
}

/** Focus moves from `from` to `to` (null: a target that takes no focus). */
function moveFocus(toolbar, from, to) {
  dispatch(toolbar.find(from), "onBlur", {
    relatedTarget: to === null ? null : new FakeNode(toolbar.find(to)),
  });
}

/** A mouse click on a button while `focused` holds focus. */
function click(toolbar, label, focused) {
  const press = dispatch(toolbar.find(label), "onMouseDown");
  if (!press.defaultPrevented) moveFocus(toolbar, focused, null);
  const button = toolbar.find(label);
  if (!button.props.disabled) dispatch(button, "onClick");
}

NodeTest.describe("device toolbar dimension edits", () => {
  NodeTest.it("commits a typed width on Enter", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "420");
    const enter = dispatch(toolbar.find("Viewport width"), "onKeyDown", { key: "Enter" });
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "freeform", width: 420, height: 667 }]);
    NodeAssert.equal(enter.defaultPrevented, true);
  });

  NodeTest.it("keeps an edit open while Tab moves within the toolbar, like native", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "420");
    dispatch(toolbar.find("Viewport width"), "onKeyDown", { key: "Tab" });
    moveFocus(toolbar, "Viewport width", "Viewport height");
    NodeAssert.deepEqual(toolbar.commits, []);
    // Leaving the toolbar is the finished edit.
    moveFocus(toolbar, "Viewport height", null);
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "freeform", width: 420, height: 667 }]);
  });

  NodeTest.it("does not commit an unchanged or invalid size on Enter", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "375");
    dispatch(toolbar.find("Viewport width"), "onKeyDown", { key: "Enter" });
    typeInto(toolbar, "Viewport width", "12");
    dispatch(toolbar.find("Viewport width"), "onKeyDown", { key: "Enter" });
    NodeAssert.deepEqual(toolbar.commits, []);
  });

  NodeTest.it("closes in one click while an edit is pending", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "420");
    click(toolbar, "Close device toolbar", "Viewport width");
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "fill" }]);
  });

  NodeTest.it("rotates the pending edit in one click", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "420");
    click(toolbar, "Rotate viewport", "Viewport width");
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "freeform", width: 667, height: 420 }]);
  });

  NodeTest.it("retires the edit once the committed size lands", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "420");
    dispatch(toolbar.find("Viewport width"), "onKeyDown", { key: "Enter" });
    toolbar.land();
    NodeAssert.equal(toolbar.find("Viewport width").props.value, "420");
    NodeAssert.equal(toolbar.find("Viewport width").props.disabled, false);
  });
});

NodeTest.describe("device toolbar aspect-ratio lock", () => {
  const LOCK = "Lock viewport aspect ratio";
  const UNLOCK = "Unlock viewport aspect ratio";

  NodeTest.it("toggles like native: pressed while locked, relabelled to unlock", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    NodeAssert.equal(toolbar.find(LOCK).props["aria-pressed"], false);
    click(toolbar, LOCK, "Viewport width");
    NodeAssert.equal(toolbar.locked(), true);
    NodeAssert.equal(toolbar.find(UNLOCK).props["aria-pressed"], true);
    click(toolbar, UNLOCK, "Viewport width");
    NodeAssert.equal(toolbar.locked(), false);
    // Toggling commits nothing: the lock is view state.
    NodeAssert.deepEqual(toolbar.commits, []);
  });

  NodeTest.it("derives the other dimension from a typed one while locked", () => {
    const toolbar = mountToolbar({ _tag: "freeform", width: 1280, height: 800 });
    click(toolbar, LOCK, "Viewport width");
    typeInto(toolbar, "Viewport height", "1000");
    NodeAssert.equal(toolbar.find("Viewport width").props.value, "1600");
    dispatch(toolbar.find("Viewport height"), "onKeyDown", { key: "Enter" });
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "freeform", width: 1600, height: 1000 }]);
  });

  NodeTest.it("leaves the other dimension alone while unlocked", () => {
    const toolbar = mountToolbar({ _tag: "freeform", width: 1280, height: 800 });
    typeInto(toolbar, "Viewport height", "1000");
    NodeAssert.equal(toolbar.find("Viewport width").props.value, "1280");
  });

  NodeTest.it("is unavailable for an invalid pending size", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    typeInto(toolbar, "Viewport width", "12");
    NodeAssert.equal(toolbar.find(LOCK).props.disabled, true);
  });

  NodeTest.it("releases when the device toolbar closes", () => {
    const toolbar = mountToolbar(IPHONE_SE);
    click(toolbar, LOCK, "Viewport width");
    click(toolbar, "Close device toolbar", "Viewport width");
    NodeAssert.equal(toolbar.locked(), false);
    NodeAssert.deepEqual(toolbar.commits, [{ _tag: "fill" }]);
  });
});
