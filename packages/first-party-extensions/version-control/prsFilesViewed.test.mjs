import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeTest from "node:test";
import {
  React,
  REF,
  act,
  defaultHandlers,
  deferred,
  detailOf,
  flush,
  loadPrsPanel,
  mount,
} from "./prsPanelHarness.mjs";

let panel;
NodeTest.before(async () => {
  panel = await loadPrsPanel();
});

const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
const hash = NodeCrypto.createHash("sha256").update(patch).digest("hex");
const frames = [
  {
    kind: "manifest",
    ...REF,
    diffHash: hash,
    diffByteLength: Buffer.byteLength(patch),
    chunkCount: 1,
    truncated: false,
    nextCursor: null,
  },
  { kind: "chunk", chunkIndex: 0, data: patch },
  { kind: "complete", payloadSha256: hash },
];

function mountViewed({
  store = "host",
  support = true,
  files = [],
  truncated = false,
  write = () => ({}),
} = {}) {
  let snapshot = { filesViewed: { files, truncated } };
  const base = defaultHandlers();
  const handlers = {
    ...base,
    "t3.prs/read#getCapabilities": () => ({
      ...base["t3.prs/read#getCapabilities"](),
      operations: {
        ...base["t3.prs/read#getCapabilities"]().operations,
        "prs.streamDiff": true,
      },
    }),
    "t3.prs/write#getCapabilities": () => ({
      ...base["t3.prs/write#getCapabilities"](),
      operations: {
        ...base["t3.prs/write#getCapabilities"]().operations,
        ...(support === null ? {} : { "prs.setFilesViewed": support }),
      },
    }),
    "t3.prs/read#detail": () => {
      const detail = detailOf();
      return {
        ...detail,
        capabilities: { ...detail.capabilities, ...(store === null ? {} : { viewedFiles: store }) },
        ...snapshot,
      };
    },
    "t3.prs/write#setFilesViewed": write,
  };
  const view = mount(
    (host, session) =>
      React.createElement(panel.PullRequestsPanel, {
        host,
        session,
        visible: true,
        selected: REF,
        onSelect: () => {},
      }),
    handlers,
    {
      subscribeApi: (request, signal) =>
        (async function* () {
          if (request.name === "streamDiff") {
            for (const [sequence, value] of frames.entries())
              yield { streamId: "diff", sequence, type: "data", value };
          } else {
            await new Promise((resolve) =>
              signal.addEventListener("abort", resolve, { once: true }),
            );
          }
        })(),
    },
  );
  return {
    ...view,
    setSnapshot: (next) => {
      snapshot = next;
    },
  };
}

const checkbox = (view) =>
  view.renderer.root.findAll((node) => node.type === "input" && node.props.type === "checkbox")[0];
const setViewed = async (view, checked) => {
  await act(async () => {
    checkbox(view).props.onChange({ target: { checked } });
  });
};
const send = async (context) => {
  await act(async () => {
    context.mock.timers.tick(400);
  });
  await flush();
};

NodeTest.test(
  "file ticks toggle immediately, fold the file, and roll back failed writes",
  async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = deferred();
    const view = mountViewed({ write: () => pending.promise });
    try {
      await flush();
      NodeAssert.equal(checkbox(view).props.checked, false);
      await setViewed(view, true);
      NodeAssert.equal(checkbox(view).props.checked, true);
      NodeAssert.equal(view.has("Expand a.ts"), true);
      await send(context);
      NodeAssert.deepEqual(view.writes()[0].input, {
        ...REF,
        files: [{ path: "a.ts", viewed: true }],
      });
      NodeAssert.equal(view.writes()[0].versionRange, "^1.1.0");
      pending.reject(new Error("host refused"));
      await flush();
      NodeAssert.equal(checkbox(view).props.checked, false);
      NodeAssert.match(view.text(), /Could not update viewed files/);
      await setViewed(view, false);
      NodeAssert.equal(view.has("Collapse a.ts"), true);
    } finally {
      view.unmount();
    }
  },
);

NodeTest.test(
  "success stays optimistic until the re-read and reveals a file pushed since viewing",
  async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = deferred();
    const view = mountViewed({
      store: "environment",
      truncated: true,
      write: () => pending.promise,
    });
    try {
      await flush();
      NodeAssert.match(view.text(), /viewed in T3 Code/);
      NodeAssert.match(view.text(), /partial count/);
      await setViewed(view, true);
      await send(context);
      view.setSnapshot({
        filesViewed: { files: [{ path: "a.ts", state: "dismissed" }], truncated: false },
      });
      pending.resolve({});
      await flush();
      NodeAssert.equal(checkbox(view).props.checked, false);
      NodeAssert.equal(checkbox(view).props["aria-label"], "Changed");
      NodeAssert.match(view.text(), /Changed/);
    } finally {
      view.unmount();
    }
  },
);

NodeTest.test("a failed earlier request cannot roll back a later press", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred();
  const second = deferred();
  let requests = 0;
  const view = mountViewed({ write: () => (++requests === 1 ? first.promise : second.promise) });
  try {
    await flush();
    await setViewed(view, true);
    await send(context);
    await setViewed(view, false);
    first.reject(new Error("older write refused"));
    await flush();
    NodeAssert.equal(checkbox(view).props.checked, false);
    NodeAssert.doesNotMatch(view.text(), /Could not update viewed files/);
    await send(context);
    NodeAssert.equal(view.writes()[1].input.files[0].viewed, false);
    second.resolve({});
    await flush();
    NodeAssert.equal(checkbox(view).props.checked, false);
  } finally {
    view.unmount();
  }
});

NodeTest.test("old or unsupported hosts expose no viewed controls", async () => {
  for (const options of [{ store: null }, { support: false }, { support: null }]) {
    const view = mountViewed(options);
    try {
      await flush();
      NodeAssert.equal(checkbox(view), undefined);
      NodeAssert.doesNotMatch(view.text(), /viewed in T3 Code/);
      NodeAssert.equal(view.writes().length, 0);
    } finally {
      view.unmount();
    }
  }
});
