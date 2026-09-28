/**
 * The chrome-row profile badge over the REAL profileMenu.tsx, bundled by
 * esbuild into the system tmpdir and rendered with react-test-renderer
 * against a stubbed `t3.browser/profiles` list.
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

let ProfileBadge;

NodeTest.before(async () => {
  const built = await build({
    entryPoints: [NodePath.join(packageDir, "profileMenu.tsx")],
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
  const bundleDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-profile-badge-"));
  const bundlePath = NodePath.join(bundleDir, "bundle.mjs");
  try {
    await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
    ({ ProfileBadge } = await import(NodeURL.pathToFileURL(bundlePath).href));
  } finally {
    await NodeFSP.rm(bundleDir, { recursive: true, force: true });
  }
});

const LIST = {
  defaultProfileId: "default",
  profiles: [
    { id: "default", name: "Default" },
    { id: "work", name: "Work account" },
  ],
};

/** Renders the badge for a session in `profileId`, the list read settled. */
async function badgeFor(profileId, list = Promise.resolve(LIST)) {
  const api = {
    invoke: (method) => (method === "list" ? list : Promise.reject(new Error(method))),
  };
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(ProfileBadge, {
        host: { React },
        session: profileId === undefined ? {} : { profileId },
        api,
        signal: new AbortController().signal,
        visible: true,
      }),
    );
  });
  await act(async () => {
    await list.catch(() => {});
  });
  const badge = renderer.root.findAll(
    (node) => node.type === "span" && node.props["data-t3-browser-profile-badge"] === true,
  );
  return badge.length === 0 ? null : badge[0];
}

// The badge re-reads when the client window regains focus (Settings may be
// another window); node has no window, so stand one in.
globalThis.window ??= new EventTarget();

/**
 * Mounts one badge and keeps it mounted: `setList` changes what the next
 * read answers, `rerender` passes new props to the same instance.
 */
async function mountBadge(profileId, list) {
  let current = list;
  const reads = [];
  const api = {
    invoke: (method) => {
      reads.push(method);
      return method === "list" ? Promise.resolve(current) : Promise.reject(new Error(method));
    },
  };
  const signal = new AbortController().signal;
  const session = { profileId };
  let renderer;
  const element = (visible) =>
    React.createElement(ProfileBadge, { host: { React }, session, api, signal, visible });
  await act(async () => {
    renderer = create(element(true));
  });
  const badge = () => {
    const found = renderer.root.findAll(
      (node) => node.type === "span" && node.props["data-t3-browser-profile-badge"] === true,
    );
    return found.length === 0 ? null : text(found[0]);
  };
  return {
    reads,
    badge,
    setList(next) {
      current = next;
    },
    async focusWindow() {
      await act(async () => {
        globalThis.window.dispatchEvent(new Event("focus"));
      });
    },
    async rerender(visible) {
      await act(async () => {
        renderer.update(element(visible));
      });
    },
  };
}

const text = (node) =>
  node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");

NodeTest.describe("profile badge", () => {
  NodeTest.it("names a tab in another profile", async () => {
    const badge = await badgeFor("work");
    NodeAssert.ok(badge);
    NodeAssert.equal(text(badge), "Work account");
  });

  NodeTest.it("stays hidden for the default profile, set or implied", async () => {
    NodeAssert.equal(await badgeFor("default"), null);
    NodeAssert.equal(await badgeFor(undefined), null);
  });

  NodeTest.it("follows the configured default, not the built-in one", async () => {
    const badge = await badgeFor("default", Promise.resolve({ ...LIST, defaultProfileId: "work" }));
    NodeAssert.ok(badge);
    NodeAssert.equal(text(badge), "Default");
  });

  NodeTest.it("reads a deleted profile as Removed profile", async () => {
    const badge = await badgeFor("gone");
    NodeAssert.ok(badge);
    NodeAssert.equal(text(badge), "Removed profile");
  });

  NodeTest.it("shows nothing when the list is refused", async () => {
    NodeAssert.equal(
      await badgeFor(
        "work",
        Promise.reject(new Error("API capability denied: t3.browser/profiles")),
      ),
      null,
    );
  });

  NodeTest.describe("follows profile settings without a remount or a new profile", () => {
    NodeTest.it("renames the held profile when the window regains focus", async () => {
      const mounted = await mountBadge("work", LIST);
      NodeAssert.equal(mounted.badge(), "Work account");
      mounted.setList({
        ...LIST,
        profiles: [LIST.profiles[0], { id: "work", name: "Client work" }],
      });
      await mounted.focusWindow();
      NodeAssert.equal(mounted.badge(), "Client work");
    });

    NodeTest.it("reads a profile deleted in Settings as Removed profile", async () => {
      const mounted = await mountBadge("work", LIST);
      mounted.setList({ ...LIST, profiles: [LIST.profiles[0]] });
      await mounted.focusWindow();
      NodeAssert.equal(mounted.badge(), "Removed profile");
    });

    NodeTest.it("hides once the held profile becomes the default, and back", async () => {
      const mounted = await mountBadge("work", LIST);
      mounted.setList({ ...LIST, defaultProfileId: "work" });
      await mounted.focusWindow();
      NodeAssert.equal(mounted.badge(), null);
      mounted.setList(LIST);
      await mounted.focusWindow();
      NodeAssert.equal(mounted.badge(), "Work account");
    });

    NodeTest.it("re-reads when the panel is shown again, not while hidden", async () => {
      const mounted = await mountBadge("work", LIST);
      mounted.setList({ ...LIST, defaultProfileId: "work" });
      await mounted.rerender(false);
      const hiddenReads = mounted.reads.length;
      await mounted.rerender(true);
      NodeAssert.equal(mounted.reads.length, hiddenReads + 1);
      NodeAssert.equal(mounted.badge(), null);
    });
  });
});
