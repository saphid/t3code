import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const sdkRequire = NodeModule.createRequire(
  new URL("../../extension-sdk/package.json", import.meta.url),
);
const React = sdkRequire("react");
const { act, create } = sdkRequire("react-test-renderer");
const { build } = sdkRequire("esbuild");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "agents-script-test-"));
await build({
  entryPoints: [NodeURL.fileURLToPath(new URL("./extension.tsx", import.meta.url))],
  outfile: NodePath.join(directory, "extension.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  plugins: [
    {
      name: "shared-react",
      setup(builder) {
        builder.onResolve({ filter: /^react(?:\/|$)/ }, ({ path }) => ({
          path: sdkRequire.resolve(path),
          external: true,
        }));
      },
    },
  ],
});
const { default: extension } = await import(
  NodeURL.pathToFileURL(NodePath.join(directory, "extension.mjs")).href
);
NodeTest.after(() => NodeFSP.rm(directory, { recursive: true, force: true }));

const rawError =
  "Failed to fetch remote environment endpoint http://localhost:5790/api/extensions/api/invoke (ExtensionOperationError: Script path is outside the workflow scripts root.).";
const textOf = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : (node?.children ?? []).map(textOf).join("");
const workflow = {
  id: "workflow",
  kind: "workflow",
  title: "Workflow",
  status: "completed",
  role: null,
  model: null,
  taskType: "local_workflow",
  detail: null,
  tokenUsage: null,
  result: null,
  error: null,
  outputFile: null,
  parentAgentId: null,
  agentIndex: null,
  phaseIndex: null,
  phaseTitle: null,
  attempt: null,
  workflowName: null,
  phases: [],
  runHandles: { scriptPath: "/home/.claude/projects/proof/workflow.js" },
  recentActivity: [],
  firstSeenAt: "2026-09-30T00:00:00.000Z",
  startedAt: "2026-09-30T00:00:00.000Z",
  completedAt: "2026-09-30T00:00:01.000Z",
  updatedAt: "2026-09-30T00:00:01.000Z",
};

async function renderPanel({
  contents = "export default 1;",
  failure = false,
  failuresBeforeSuccess = 0,
  pending = null,
  capabilityFailure = false,
  client = "mobile",
  navigationSupported = true,
} = {}) {
  let scriptReads = 0;
  const calls = [];
  const controller = new AbortController();
  const host = {
    React,
    async invokeApi(request) {
      calls.push(request);
      if (request.method === "openAgentSession") return { status: "opened" };
      if (request.method === "getCapabilities") {
        if (capabilityFailure) throw new Error(rawError);
        return {
          operations: { readWorkflowScript: true, openAgentSession: navigationSupported },
          streamEpoch: "epoch",
          revision: 1,
        };
      }
      if (request.method === "readText")
        return {
          contents: JSON.stringify({ scripts: [{ name: "Desktop dev", command: "vp run dev" }] }),
          truncated: false,
        };
      throw new Error("Unavailable in fixture");
    },
    async *subscribeApi(request, signal) {
      if (request.name === "readWorkflowScript") {
        scriptReads += 1;
        if (failure || scriptReads <= failuresBeforeSuccess) throw new Error(rawError);
        if (pending) await pending;
        const chunks = contents.match(/[\s\S]{1,8192}/gu) ?? [];
        yield {
          type: "snapshot",
          value: {
            kind: "manifest",
            chunkCount: chunks.length,
            truncated: false,
          },
        };
        for (const [chunkIndex, data] of chunks.entries())
          yield { type: "data", value: { kind: "chunk", chunkIndex, data } };
        yield {
          type: "closed",
          value: {
            kind: "complete",
            sha256: NodeCrypto.createHash("sha256").update(contents).digest("hex"),
          },
        };
        return;
      }
      if (request.name !== "subscribeAgents") return;
      yield {
        type: "snapshot",
        value: {
          kind: "snapshot",
          streamEpoch: "epoch",
          revision: 1,
          agents: [
            {
              ...workflow,
              id: "agent",
              kind: "agent",
              outputFile: null,
              runHandles: { sessionUrl: "https://session.example/agent" },
            },
          ],
          pendingApprovals: [],
          pendingUserInputs: [],
          checkpoints: [],
          session: null,
          turn: null,
          receipts: [],
          retention: { agentsCap: 100, receiptsCap: 100 },
        },
      };
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    },
  };
  const session = {
    context: {
      client,
      workspaceRevision: "revision",
      resource: { threadId: "thread", projectId: "project" },
    },
    visible: true,
    signal: controller.signal,
    onVisibility: () => () => {},
    setTabIndicators: () => {},
  };
  let root;
  await act(async () => {
    root = create(
      React.createElement(extension.client(host).surfaces[0].createView(session).renderer),
    );
  });
  const toggle = () =>
    root.root
      .findAllByType("button")
      .find((button) => textOf(button).toLowerCase().includes("script"));
  return {
    root,
    toggle,
    reads: () => scriptReads,
    calls,
    async clickToggle() {
      NodeAssert.ok(toggle(), textOf(root.toJSON()));
      await act(async () => toggle().props.onClick());
    },
    async close() {
      await act(async () => {
        controller.abort();
        root.unmount();
      });
    },
  };
}

NodeTest.test(
  "mobile policy removes Terminal script actions and avoids their workspace read",
  async () => {
    const panel = await renderPanel();
    try {
      NodeAssert.equal(
        panel.root.root
          .findAllByType("button")
          .some((b) => b.props["aria-label"] === "Run Desktop dev"),
        false,
      );
      NodeAssert.equal(
        panel.calls.some((c) => c.method === "readText"),
        false,
      );
      NodeAssert.match(
        textOf(panel.root.toJSON()),
        /Project scripts require the desktop Terminal surface/,
      );
    } finally {
      await panel.close();
    }
  },
);
NodeTest.test("web and desktop retain the checked-in script entry", async () => {
  for (const client of ["web", "desktop"]) {
    const panel = await renderPanel({ client });
    try {
      NodeAssert.ok(
        panel.root.root
          .findAllByType("button")
          .some((b) => b.props["aria-label"] === "Run Desktop dev"),
      );
      NodeAssert.equal(panel.calls.filter((c) => c.method === "readText").length, 1);
    } finally {
      await panel.close();
    }
  }
});
NodeTest.test(
  "mobile session navigation stays supported and unsupported capability makes it inert",
  async () => {
    for (const navigationSupported of [true, false]) {
      const panel = await renderPanel({ navigationSupported });
      try {
        const button = panel.root.root
          .findAllByType("button")
          .find((b) => textOf(b) === "Open session");
        NodeAssert.ok(button);
        NodeAssert.equal(button.props.disabled, !navigationSupported);
        if (navigationSupported) await act(async () => button.props.onClick());
        else
          NodeAssert.match(
            textOf(panel.root.toJSON()),
            /Session pages are not available on this client/,
          );
        NodeAssert.equal(
          panel.calls.filter((c) => c.method === "openAgentSession").length,
          navigationSupported ? 1 : 0,
        );
      } finally {
        await panel.close();
      }
    }
  },
);
NodeTest.test("shared surface is eligible on mobile without losing desktop clients", () => {
  NodeAssert.deepEqual(extension.client({ React }).manifest.surfaces[0].clients, [
    "web",
    "desktop",
    "mobile",
  ]);
});
NodeTest.test(
  "presentation contract has scoped touch, container reflow, keyboard and reduced-motion rules",
  async () => {
    const panel = await renderPanel();
    try {
      const css = panel.root.root.findAllByType("style").map(textOf).join("\n");
      NodeAssert.match(css, /container-type:\s*inline-size/);
      NodeAssert.match(css, /@container agents \(max-width:\s*600px\)/);
      NodeAssert.match(css, /min-height:\s*44px/);
      NodeAssert.match(css, /min-width:\s*44px/);
      NodeAssert.match(css, /prefers-reduced-motion/);
      NodeAssert.match(css, /:focus-visible/);
      const container = css.slice(css.indexOf("@container"), css.indexOf("@media"));
      const selectors = [...container.matchAll(/([^{}]+)\{/g)]
        .slice(1)
        .map((match) => match[1].trim());
      NodeAssert.ok(selectors.length > 0);
      for (const selector of selectors)
        NodeAssert.match(
          selector,
          /\[data-client="mobile"\]/,
          "desktop rails retain their original layout",
        );
      const mobileOnlyRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
        /(?:container(?:-type)?|outline(?:-offset)?|scroll-padding-block):/.test(match[2]),
      );
      NodeAssert.equal(mobileOnlyRules.length, 3);
      for (const [_, selector] of mobileOnlyRules)
        NodeAssert.match(
          selector,
          /\[data-client="mobile"\]/,
          "web and desktop retain their original containment, focus outline and scroll padding",
        );
      const { transform } = sdkRequire("esbuild");
      const parsed = await transform(css, { loader: "css", target: "safari18" });
      NodeAssert.equal(parsed.warnings.length, 0);
    } finally {
      await panel.close();
    }
  },
);

NodeTest.test("eligible shared bundle does not claim it is web/desktop only", async () => {
  const panel = await renderPanel();
  try {
    NodeAssert.doesNotMatch(textOf(panel.root.toJSON()), /web\/desktop only/);
  } finally {
    await panel.close();
  }
});

NodeTest.test(
  "mobile focus scroll spacing leaves keyboard and safe-area insets to the host",
  async () => {
    const panel = await renderPanel();
    try {
      const css = panel.root.root.findAllByType("style").map(textOf).join("\n");
      const spacing = [...css.matchAll(/scroll-(?:margin|padding)(?:-[a-z]+)*:\s*([^;{}]+);/g)];
      NodeAssert.equal(spacing.length, 2);
      for (const [_, value] of spacing) {
        NodeAssert.doesNotMatch(value, /--t3-keyboard-inset|safe-area/);
        NodeAssert.equal(value.trim(), "12px");
      }
    } finally {
      await panel.close();
    }
  },
);
